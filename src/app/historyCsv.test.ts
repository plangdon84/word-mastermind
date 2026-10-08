import { describe, expect, it } from 'vitest';
import { parseHistoryEntry } from '../game';
import { toHistoryGame, type HistoryGame } from './historyDb';
import { csvCell, csvRowCount, historyCsv } from './historyCsv';
import { friendEntry, lobbyEntry } from '../game/testGames';

const T = Date.UTC(2026, 8, 28, 12, 0, 0);
const at = (s: number) => T + s * 1000;

const load = (value: object): HistoryGame => {
  const entry = parseHistoryEntry(value);
  const game = entry && toHistoryGame(entry);
  if (!game) throw new Error('did not load');
  return game;
};

const single = load({
  id: 'g1', version: 1, mode: 'single', marks: {},
  record: {
    secret: 'beach', startedAt: T, difficulty: 'hard', moves: [
      { kind: 'guess', word: 'bunny', at: at(10) },
      { kind: 'difficulty', difficulty: 'medium', at: at(20) },
      { kind: 'guess', word: 'beach', at: at(30) },
    ],
  },
});

const computer = load({
  id: 'g2', version: 1, mode: 'computer', marks: {},
  record: {
    humanSecret: 'storm', computerSecret: 'beach', first: 'computer', startedAt: T, difficulty: 'medium',
    strength: 'expert', moves: [
      { side: 'computer', kind: 'guess', word: 'moist', at: at(1) },
      { side: 'human', kind: 'concede', at: at(2) },
    ],
  },
});

const rush = load({
  id: 'g3', version: 1, mode: 'rush', marks: [],
  record: {
    words: ['beach', 'crane'], startedAt: T, timeLimitMs: null, pausable: true, difficulty: 'extreme', moves: [
      { kind: 'guess', word: 'beach', at: at(5) },
      { kind: 'pause', at: at(6) },
      { kind: 'resume', at: at(9) },
      { kind: 'give-up-word', at: at(12) },
    ],
  },
});

describe('historyCsv', () => {
  it('writes one row per move, each with its game details', () => {
    expect(historyCsv([single, computer, rush]).split('\r\n')).toEqual([
      'game_id,mode,started_at,difficulty,scored_difficulty,strength,first,your_word,secret_words,result,rush_score,move,side,kind,word_no,word,score,time',
      'g1,single,2026-09-28T12:00:00.000Z,hard,medium,,,,beach,won,,1,you,guess,,bunny,1,2026-09-28T12:00:10.000Z',
      'g1,single,2026-09-28T12:00:00.000Z,hard,medium,,,,beach,won,,2,you,difficulty,,medium,,2026-09-28T12:00:20.000Z',
      'g1,single,2026-09-28T12:00:00.000Z,hard,medium,,,,beach,won,,3,you,guess,,beach,win,2026-09-28T12:00:30.000Z',
      'g2,computer,2026-09-28T12:00:00.000Z,medium,medium,expert,computer,storm,beach,gave up,,1,computer,guess,,moist,4,2026-09-28T12:00:01.000Z',
      'g2,computer,2026-09-28T12:00:00.000Z,medium,medium,expert,computer,storm,beach,gave up,,2,you,concede,,,,2026-09-28T12:00:02.000Z',
      'g3,rush,2026-09-28T12:00:00.000Z,extreme,extreme,,,,beach crane,mastermind,4.8,1,you,guess,1,beach,win,2026-09-28T12:00:05.000Z',
      'g3,rush,2026-09-28T12:00:00.000Z,extreme,extreme,,,,beach crane,mastermind,4.8,2,you,pause,2,,,2026-09-28T12:00:06.000Z',
      'g3,rush,2026-09-28T12:00:00.000Z,extreme,extreme,,,,beach crane,mastermind,4.8,3,you,resume,2,,,2026-09-28T12:00:09.000Z',
      'g3,rush,2026-09-28T12:00:00.000Z,extreme,extreme,,,,beach crane,mastermind,4.8,4,you,give-up-word,2,,,2026-09-28T12:00:12.000Z',
      '',
    ]);
  });

  it("gives Easy's suggestions the word offered", () => {
    const easy = load({
      id: 'g4', version: 1, mode: 'single', marks: {},
      record: {
        secret: 'beach', startedAt: T, difficulty: 'easy', moves: [
          { kind: 'suggest', word: 'peach', at: at(5) },
          { kind: 'guess', word: 'beach', at: at(10) },
        ],
      },
    });
    expect(historyCsv([easy]).split('\r\n')[1]).toContain(',1,you,suggest,,peach,,');
  });

  it('counts the rows it would write', () => {
    expect(csvRowCount([single, computer, rush])).toBe(9);
  });
});

describe('csvCell', () => {
  it('quotes cells with commas, quotes or line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(-3)).toBe('-3');
  });

  it('stops text being run as a formula', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-x')).toBe("'-x");
    expect(csvCell('@me')).toBe("'@me");
  });
});

describe("the server's games in the CSV", () => {
  it('name the opponent as such, and give a lobby its place', () => {
    const friend = load(friendEntry('f1', T, { seat: 'guest', first: 'them', them: ['crane', 'storm'], you: ['house', 'beach'] }));
    const lines = historyCsv([friend]).trim().split('\r\n');
    expect(lines[1]).toContain(',opponent,guess,,crane,');
    expect(lines[2]).toContain(',you,guess,,house,');
    expect(lines[1]).toContain('f1,friend,');
    // Your word, then theirs; they found yours first and your last guess matched it.
    expect(lines[1]).toContain(',opponent,storm,beach,drawn,');
    const place = load(lobbyEntry('l1', T, [['beach'], ['crane'], ['storm'], ['house']], { rank: 2, of: 4 }));
    expect(historyCsv([place]).split('\r\n')[1]).toContain(',2nd of 4,');
  });
});
