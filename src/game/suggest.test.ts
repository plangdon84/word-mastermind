import { describe, expect, it } from 'vitest';
import { createRun, replayRun, submitRunGuess, suggestRun, toRunRecord, type RunResult } from './run';
import { createSoloGame, replaySolo, setSoloDifficulty, submitGuess, suggestSolo, toSoloRecord, type SoloGameResult } from './solo';
import { createPvpGame, replayPvp, suggestPvp, toPvpRecord, pvpView, type PvpResult } from './pvp';
import { createTwoPlayerGame, replayTwoPlayer, suggestTwoPlayer, toTwoPlayerRecord } from './twoPlayer';
import { parseRunRecord, parseSoloRecord } from './records';
import { fitsEveryScore, SUGGEST_LIMIT, suggestionCandidates, suggestWord } from './suggest';

const T = 1_000_000;
const g = (guess: string, score: number) => ({ guess, score });
const SECRETS = ['beach', 'crane', 'chase', 'peach', 'storm', 'light'];

function ok<T>(result: { ok: true; game: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.game;
}

describe('fitsEveryScore', () => {
  it('checks each score, and never offers a word already guessed', () => {
    expect(fitsEveryScore('beach', [g('crane', 3)])).toBe(true);
    expect(fitsEveryScore('beach', [g('crane', 2)])).toBe(false);
    expect(fitsEveryScore('crane', [g('crane', 5)])).toBe(false);
  });
});

describe('suggestionCandidates', () => {
  it('offers secret-list words that could be the secret, given every score', () => {
    // storm 0 rules out s, t, o, r, m; crane 3 needs 3 of c, r, a, n, e.
    expect(suggestionCandidates([g('storm', 0), g('crane', 3)], SECRETS)).toEqual(['beach', 'peach']);
    expect(suggestionCandidates([], SECRETS)).toEqual(SECRETS);
  });

  it('picks at random among them, or none', () => {
    expect(suggestWord([g('storm', 0), g('crane', 3)], () => 0.99, SECRETS)).toBe('peach');
    expect(suggestWord([g('crane', 5), g('beach', 5)], () => 0, SECRETS)).toBeNull();
  });
});

describe('suggestions in a game', () => {
  const easy = () => ok(createSoloGame('beach', T, 'easy') as SoloGameResult);

  it(`are for Easy only, ${SUGGEST_LIMIT} a game, and never a guess`, () => {
    expect(suggestSolo(ok(createSoloGame('beach', T)), 'crane', T)).toEqual({ ok: false, error: 'not-easy' });
    let game = easy();
    for (let i = 0; i < SUGGEST_LIMIT; i++) game = ok(suggestSolo(game, 'crane', T + i));
    expect(game.suggested).toBe(SUGGEST_LIMIT);
    expect(game.guesses).toEqual([]);
    expect(suggestSolo(game, 'crane', T)).toEqual({ ok: false, error: 'no-suggestions' });
    expect(suggestSolo(easy(), 'zzzzz', T)).toEqual({ ok: false, error: 'not-in-word-list' });
  });

  it('are recorded, so a game replays and parses with them', () => {
    let game = ok(suggestSolo(easy(), 'peach', T + 1));
    game = ok(setSoloDifficulty(game, 'medium', T + 2));
    game = ok(submitGuess(game, 'peach', T + 3));
    const record = toSoloRecord(game);
    expect(record.moves[0]).toEqual({ kind: 'suggest', word: 'peach', at: T + 1 });
    expect(replaySolo(parseSoloRecord(JSON.parse(JSON.stringify(record)))!)).toEqual({ ok: true, game });
    // Not at Medium, even with some left.
    expect(suggestSolo(game, 'crane', T + 4)).toEqual({ ok: false, error: 'not-easy' });
  });

  it('count per word in a Rush', () => {
    let run = ok(createRun(['beach', 'crane'], T, { difficulty: 'easy' }) as RunResult);
    for (let i = 0; i < SUGGEST_LIMIT; i++) run = ok(suggestRun(run, 'peach', T));
    expect(suggestRun(run, 'peach', T)).toEqual({ ok: false, error: 'no-suggestions' });
    run = ok(submitRunGuess(run, 'beach', T + 1));
    run = ok(suggestRun(run, 'chase', T + 2));
    expect(run.results.map((r) => r.suggested)).toEqual([SUGGEST_LIMIT, 1]);
    const record = parseRunRecord(JSON.parse(JSON.stringify(toRunRecord(run))))!;
    expect(replayRun(record)).toEqual({ ok: true, game: run });
  });

  it('count per player against the computer or a friend', () => {
    const cpu = ok(createTwoPlayerGame('storm', 'beach', 'computer', T, { difficulty: 'easy' }));
    const suggested = ok(suggestTwoPlayer(cpu, 'crane', T));
    expect(suggested.suggested).toBe(1);
    expect(replayTwoPlayer(toTwoPlayerRecord(suggested))).toEqual({ ok: true, game: suggested });

    const pvp = ok(createPvpGame({ host: 'storm', guest: 'beach' }, 'host', T, '1d', { host: 'easy', guest: 'medium' }) as PvpResult);
    expect(suggestPvp(pvp, 'guest', 'crane', T)).toEqual({ ok: false, error: 'not-easy' });
    const hosted = ok(suggestPvp(pvp, 'host', 'crane', T));
    expect(pvpView(hosted, 'host').suggested).toBe(1);
    expect(pvpView(hosted, 'guest').suggested).toBe(0);
    expect(replayPvp(toPvpRecord(hosted))).toEqual({ ok: true, game: hosted });
  });
});
