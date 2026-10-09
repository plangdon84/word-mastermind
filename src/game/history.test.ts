import { describe, expect, it } from 'vitest';
import {
  matchesFilter, parseHistoryEntry, replayEntry, summarizeGame, type HistoryEntry,
} from './history';
import { dailyEntry, dailyWordEntry, friendEntry, lobbyEntry } from './testGames';
import { GUESS_WORDS } from './wordLists';

const T = 1_000_000;
const guess = (word: string, at = T) => ({ kind: 'guess', word, at });

const single = (moves: object[], extra: object = {}) => ({
  id: 'g1', version: 1, mode: 'single',
  record: { secret: 'beach', startedAt: T, difficulty: 'hard', moves },
  marks: { b: 'in' }, ...extra,
});

const computer = (moves: object[]) => ({
  id: 'g2', version: 1, mode: 'computer',
  record: {
    humanSecret: 'storm', computerSecret: 'beach', first: 'computer', startedAt: T,
    difficulty: 'medium', strength: 'expert', moves,
  },
  marks: {},
});

const rush = (moves: object[], marks: unknown = [{ a: 'in' }]) => ({
  id: 'g3', version: 1, mode: 'rush',
  record: { words: ['beach', 'crane'], startedAt: T, timeLimitMs: null, pausable: true, difficulty: 'extreme', moves },
  marks,
});

const summary = (value: object) => {
  const entry = parseHistoryEntry(value);
  const replayed = entry && replayEntry(entry);
  if (!replayed) throw new Error('did not replay');
  return summarizeGame(replayed);
};

describe('parseHistoryEntry', () => {
  it('keeps a finished game', () => {
    expect(parseHistoryEntry(single([guess('bunny'), guess('beach', T + 5_000)]))).toEqual(
      single([guess('bunny'), guess('beach', T + 5_000)]),
    );
  });

  it('refuses a game still being played', () => {
    expect(parseHistoryEntry(single([guess('bunny')]))).toBeNull();
    expect(parseHistoryEntry(computer([{ side: 'computer', kind: 'guess', word: 'storm', at: T }]))).toBeNull();
    expect(parseHistoryEntry(rush([guess('beach')]))).toBeNull();
  });

  it('refuses a game that does not replay, or an unknown mode, version or ID', () => {
    expect(parseHistoryEntry(single([guess('zzzzz'), guess('beach')]))).toBeNull();
    expect(parseHistoryEntry(single([guess('beach')], { mode: 'chess' }))).toBeNull();
    expect(parseHistoryEntry(single([guess('beach')], { version: 2 }))).toBeNull();
    expect(parseHistoryEntry(single([guess('beach')], { version: '1' }))).toBeNull();
    expect(parseHistoryEntry(single([guess('beach')], { id: '' }))).toBeNull();
    expect(parseHistoryEntry(single([guess('beach')], { id: 7 }))).toBeNull();
    expect(parseHistoryEntry(null)).toBeNull();
  });

  it("gives a Rush one set of marks per word, dropping ones that don't parse", () => {
    const moves = [guess('beach'), { kind: 'give-up-word', at: T }];
    expect(parseHistoryEntry(rush(moves))?.marks).toEqual([{ a: 'in' }, {}]);
    expect(parseHistoryEntry(rush(moves, 'x'))?.marks).toEqual([{}, {}]);
    expect(parseHistoryEntry(single([guess('beach')], { marks: { 1: 'in', c: 'maybe' } }))?.marks).toEqual({});
  });
});

describe('summarizeGame', () => {
  it('counts solving a single-player game as a win, and giving up as a loss', () => {
    const won = summary(single([guess('bunny'), { kind: 'difficulty', difficulty: 'medium', at: T }, guess('beach', T + 9)]));
    expect(won).toMatchObject({
      mode: 'single', result: 'won', gaveUp: false, difficulty: 'medium', yourGuesses: 2, opponentGuesses: null,
      endedAt: T + 9, rush: null,
    });
    expect([...won.words].sort()).toEqual(['beach', 'bunny']);
    expect(summary(single([{ kind: 'give-up', at: T }]))).toMatchObject({ result: 'lost', gaveUp: true });
  });

  it('gives a game against the computer its result and both guess counts', () => {
    const c = (word: string) => ({ side: 'computer', kind: 'guess', word, at: T });
    const h = (word: string) => ({ side: 'human', kind: 'guess', word, at: T });
    expect(summary(computer([c('storm'), h('beach')]))).toMatchObject({
      mode: 'computer', result: 'drawn', strength: 'expert', yourGuesses: 1, opponentGuesses: 1,
    });
    expect(summary(computer([c('crane'), h('beach')]))).toMatchObject({ result: 'won', gaveUp: false });
    expect(summary(computer([c('storm'), h('crane')]))).toMatchObject({ result: 'lost', gaveUp: false });
    expect(summary(computer([{ side: 'human', kind: 'concede', at: T }]))).toMatchObject({ result: 'lost', gaveUp: true });
  });

  it("gives a Rush its score and level but no result", () => {
    const done = summary(rush([guess('bunny'), guess('beach'), guess('crane')]));
    expect(done).toMatchObject({ mode: 'rush', result: null, gaveUp: false, difficulty: 'extreme', yourGuesses: 3 });
    expect(done.rush).toMatchObject({ score: 1.5 * 0.8, level: 'mastermind' });
    const ended = summary(rush([guess('beach'), { kind: 'end', at: T }]));
    expect(ended).toMatchObject({ gaveUp: true, rush: null });
  });
});

describe('matchesFilter', () => {
  const won = summary(single([guess('bunny'), guess('beach')]));
  const drawn = (() => {
    const entry = parseHistoryEntry(computer([
      { side: 'computer', kind: 'guess', word: 'storm', at: T }, { side: 'human', kind: 'guess', word: 'beach', at: T },
    ])) as HistoryEntry;
    return summarizeGame(replayEntry(entry)!);
  })();

  it('matches everything without a filter', () => {
    expect(matchesFilter(won, {})).toBe(true);
  });

  it('filters by mode, result and difficulty', () => {
    expect(matchesFilter(won, { mode: 'single', result: 'won', difficulty: 'hard' })).toBe(true);
    expect(matchesFilter(won, { mode: 'rush' })).toBe(false);
    expect(matchesFilter(won, { result: 'drawn' })).toBe(false);
    expect(matchesFilter(drawn, { result: 'drawn' })).toBe(true);
    expect(matchesFilter(won, { difficulty: 'medium' })).toBe(false);
  });

  it('searches secret words and guesses by how they start, ignoring case', () => {
    expect(matchesFilter(won, { search: 'BUN' })).toBe(true);
    expect(matchesFilter(won, { search: ' beach ' })).toBe(true);
    expect(matchesFilter(won, { search: 'each' })).toBe(false);
    expect(matchesFilter(drawn, { search: 'sto' })).toBe(true);
  });
});

describe("the server's games", () => {
  it('read back a game against a friend from your side, and refuse one without a name or seat', () => {
    // You go first and find it; their final guess misses.
    const entry = friendEntry('f1', T, { you: ['crane', 'beach'], them: ['house', 'crane'], opponent: 'Bob' });
    const parsed = parseHistoryEntry(JSON.parse(JSON.stringify(entry)));
    expect(parsed).toEqual(entry);
    expect(summarizeGame(replayEntry(parsed!)!)).toMatchObject({
      mode: 'friend', result: 'won', opponent: 'Bob', yourGuesses: 2, opponentGuesses: 2, gaveUp: false,
    });
    expect(parseHistoryEntry({ ...entry, opponent: '' })).toBeNull();
    expect(parseHistoryEntry({ ...entry, seat: 'human' })).toBeNull();
    expect(parseHistoryEntry({ ...entry, rating: { before: 'x', after: 1 } })).toBeNull();
  });

  it('count a friend game you conceded as given up and lost', () => {
    const entry = friendEntry('f2', T, { seat: 'guest', you: ['crane'], them: ['house'], concede: true });
    expect(summarizeGame(replayEntry(entry)!)).toMatchObject({ result: 'lost', gaveUp: true });
  });

  it('read back a Daily Rush with its day, and a lobby with exactly one of the places yours', () => {
    const d = dailyEntry('d1', '2026-10-31', T, [['beach'], ['crane'], ['storm'], ['house']]);
    expect(parseHistoryEntry(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(parseHistoryEntry({ ...d, day: '31/10/2026' })).toBeNull();
    const l = lobbyEntry('l1', T, [['beach'], ['crane'], ['storm'], ['house']], { rank: 1, of: 3 });
    expect(parseHistoryEntry(JSON.parse(JSON.stringify(l)))).toEqual(l);
    expect(summarizeGame(replayEntry(l)!)).toMatchObject({ mode: 'lobby', place: { rank: 1, of: 3 }, result: null });
    if (l.mode !== 'lobby') throw new Error('not a lobby');
    expect(parseHistoryEntry({ ...l, places: l.places.map((p) => ({ ...p, you: false })) })).toBeNull();
    expect(parseHistoryEntry({ ...l, kind: 'solo' })).toBeNull();
  });

  it('read back a Daily Word with its day, and refuse one of more than one word', () => {
    const w = dailyWordEntry('w1', '2026-10-31', T, ['crane', 'beach']);
    expect(parseHistoryEntry(JSON.parse(JSON.stringify(w)))).toEqual(w);
    expect(summarizeGame(replayEntry(w)!)).toMatchObject({ mode: 'dailyWord', yourGuesses: 2, gaveUp: false, result: null });
    const d = dailyEntry('d1', '2026-10-31', T, [['beach'], ['crane'], ['storm'], ['house']]);
    expect(parseHistoryEntry({ ...d, mode: 'dailyWord' })).toBeNull();
  });
});

describe('the longest games', () => {
  // Wrong guesses for `beach` (and `storm`), from the guess list.
  const misses = GUESS_WORDS.filter((w) => w !== 'beach' && w !== 'storm').slice(0, 199);
  const step = 30_000;

  it('save, parse and replay: 200 guesses in single player and against the computer, 100 on one Rush word', () => {
    const single: HistoryEntry = {
      id: 'long-single', version: 1, mode: 'single', marks: {},
      record: {
        secret: 'beach', startedAt: T, difficulty: 'hard',
        moves: [...misses, 'beach'].map((word, i) => ({ kind: 'guess', word, at: T + (i + 1) * step })),
      },
    };
    const computer: HistoryEntry = {
      id: 'long-computer', version: 1, mode: 'computer', marks: {},
      record: {
        humanSecret: 'storm', computerSecret: 'beach', first: 'human', startedAt: T, difficulty: 'medium', strength: 'casual',
        moves: [...misses, 'beach'].flatMap((word, i) => [
          { side: 'human' as const, kind: 'guess' as const, word, at: T + (2 * i + 1) * step },
          { side: 'computer' as const, kind: 'guess' as const, word: misses[i] ?? 'crane', at: T + (2 * i + 2) * step },
        ]),
      },
    };
    const rush: HistoryEntry = {
      id: 'long-rush', version: 1, mode: 'rush', marks: [{}, {}, {}, {}],
      record: {
        words: ['beach', 'crane', 'storm', 'house'], startedAt: T, timeLimitMs: null, pausable: true, difficulty: 'medium',
        moves: [...misses.slice(0, 99), 'beach', 'crane', 'storm', 'house'].map((word, i) => ({ kind: 'guess', word, at: T + (i + 1) * step })),
      },
    };
    for (const entry of [single, computer, rush]) {
      const json = JSON.stringify(entry);
      // Under the server's limit for one synced game (MAX_ENTRY_CHARS in worker/src/sync.ts).
      expect(json.length).toBeLessThan(200_000);
      const parsed = parseHistoryEntry(JSON.parse(json));
      expect(parsed).toEqual(entry);
      expect(replayEntry(parsed!)).not.toBeNull();
    }
    const replayed = replayEntry(single);
    expect(replayed?.mode === 'single' && replayed.game.guesses).toHaveLength(200);
  });
});
