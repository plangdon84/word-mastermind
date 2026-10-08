import { describe, expect, it } from 'vitest';
import {
  createRun, endRun, giveUpWord, pauseRun, pickRunWords, replayRun, resumeRun, runDeadline, runElapsedMs,
  scoreSoloRun, setRunDifficulty, submitRunGuess, summarizeSoloRun, toRunRecord, toWordResult, wordSeconds,
  type RunGame, type RunResult,
} from './run';
import { parseRunRecord } from './records';
import { SECRET_WORDS } from './wordLists';

/** The run starts at T; times below are T plus seconds. */
const T = 1_000_000;
const at = (seconds: number) => T + seconds * 1000;

function ok(result: RunResult): RunGame {
  if (!result.ok) throw new Error(result.error);
  return result.game;
}

const newRun = (timeLimitMs: number | null = null) => ok(createRun(['beach', 'crane', 'storm'], T, { timeLimitMs }));
/** A solo Rush: a stopwatch that can pause. */
const soloRun = () => ok(createRun(['beach', 'crane', 'storm'], T, { pausable: true }));

/** Plays [guess, seconds] pairs in order. */
function play(run: RunGame, ...moves: [string, number][]): RunGame {
  for (const [guess, seconds] of moves) run = ok(submitRunGuess(run, guess, at(seconds)));
  return run;
}

describe('createRun', () => {
  it('starts on the first word, with the others not reached', () => {
    const run = newRun();
    expect(run.current).toBe(0);
    expect(run.status).toBe('playing');
    expect(run.results.map((r) => r.startedAt)).toEqual([T, null, null]);
  });

  it('normalizes the words and rejects any that is not a valid secret', () => {
    expect(ok(createRun([' Beach'], T)).words).toEqual(['beach']);
    expect(createRun(['beach', 'bunny'], T)).toEqual({ ok: false, error: 'repeated-letters' });
    expect(createRun([], T)).toEqual({ ok: false, error: 'no-words' });
  });

  it('cannot both pause and have a time limit', () => {
    expect(() => createRun(['beach'], T, { timeLimitMs: 60_000, pausable: true })).toThrow();
  });
});

describe('submitRunGuess', () => {
  it('scores guesses against the word being played', () => {
    const run = play(newRun(), ['bunny', 5]);
    expect(run.results[0].guesses).toEqual([{ guess: 'bunny', score: 1, isWin: false }]);
    expect(run.current).toBe(0);
  });

  it('moves on when the word is found, timing each word from the end of the last', () => {
    const run = play(newRun(), ['bunny', 5], ['beach', 20], ['crane', 50]);
    expect(run.current).toBe(2);
    expect(run.results[0]).toMatchObject({ outcome: 'solved', startedAt: T, endedAt: at(20) });
    expect(run.results[1]).toMatchObject({ outcome: 'solved', startedAt: at(20), endedAt: at(50) });
    expect(run.results[2]).toMatchObject({ outcome: null, startedAt: at(50), endedAt: null });
    expect(run.results.map(wordSeconds)).toEqual([20, 30, null]);
  });

  it('is over when the last word is found', () => {
    const run = play(newRun(), ['beach', 10], ['crane', 20], ['storm', 30]);
    expect(run.status).toBe('over');
    expect(run.current).toBe(3);
    expect(submitRunGuess(run, 'plots', at(40))).toEqual({ ok: false, error: 'game-over' });
  });

  it('does not count an anagram as finding the word', () => {
    const run = play(newRun(), ['beach', 10], ['nacre', 20]);
    expect(run.current).toBe(1);
  });

  it('rejects an invalid guess', () => {
    expect(submitRunGuess(newRun(), 'zzzzz', at(1))).toEqual({ ok: false, error: 'not-in-word-list' });
  });

  it('refuses guesses after the deadline', () => {
    const run = newRun(60_000);
    expect(runDeadline(run)).toBe(at(60));
    expect(submitRunGuess(run, 'bunny', at(60)).ok).toBe(true);
    expect(submitRunGuess(run, 'bunny', at(61))).toEqual({ ok: false, error: 'time-up' });
  });
});

describe('giveUpWord', () => {
  it('gives up the word being played and moves on', () => {
    const run = ok(giveUpWord(play(newRun(), ['bunny', 5]), at(12)));
    expect(run.results[0]).toMatchObject({ outcome: 'gave-up', endedAt: at(12) });
    expect(run.results[0].guesses).toHaveLength(1);
    expect(run.results[1].startedAt).toBe(at(12));
    expect(run.current).toBe(1);
  });
});

describe('endRun', () => {
  it('leaves the word being played and those after it unsolved', () => {
    const run = ok(endRun(play(newRun(), ['beach', 10], ['bunny', 15]), at(30)));
    expect(run.status).toBe('over');
    expect(run.results.map((r) => r.outcome)).toEqual(['solved', 'unsolved', 'unsolved']);
    expect(run.results.map(wordSeconds)).toEqual([10, 20, null]);
  });

  it('stops the clock at the deadline', () => {
    const run = ok(endRun(newRun(60_000), at(90)));
    expect(run.results[0].endedAt).toBe(at(60));
  });

  it('is refused once the run is over', () => {
    expect(endRun(ok(endRun(newRun(), at(1))), at(2))).toEqual({ ok: false, error: 'game-over' });
  });
});

describe('replayRun', () => {
  it('rebuilds a run from its record', () => {
    const runs = [
      newRun(),
      play(newRun(), ['bunny', 5], ['beach', 20]),
      ok(giveUpWord(play(newRun(60_000), ['beach', 10]), at(30))),
      ok(endRun(play(newRun(), ['beach', 10], ['bunny', 15]), at(30))),
      play(newRun(), ['beach', 10], ['crane', 20], ['storm', 30]),
      ok(resumeRun(ok(pauseRun(play(soloRun(), ['beach', 10]), at(15))), at(60))),
      ok(endRun(ok(pauseRun(soloRun(), at(5))), at(9))),
      ok(setRunDifficulty(ok(createRun(['beach'], T, { difficulty: 'extreme' })), 'hard', at(3))),
    ];
    for (const run of runs) expect(replayRun(toRunRecord(run))).toEqual({ ok: true, game: run });
  });

  it('fails on a move the rules refuse', () => {
    const record = { words: ['beach'], startedAt: T, timeLimitMs: 60_000, pausable: false, difficulty: 'medium' as const };
    expect(replayRun({ ...record, moves: [{ kind: 'guess', word: 'bunny', at: at(61) }] }))
      .toEqual({ ok: false, error: 'time-up' });
    expect(replayRun({ ...record, moves: [{ kind: 'end', at: at(1) }, { kind: 'end', at: at(2) }] }))
      .toEqual({ ok: false, error: 'game-over' });
  });
});

describe('pausing', () => {
  it("leaves paused time out of the word's time and the run's", () => {
    let run = play(soloRun(), ['beach', 10]);
    run = ok(pauseRun(run, at(15)));
    expect(runElapsedMs(run, at(500))).toBe(15_000);
    run = ok(resumeRun(run, at(100)));
    run = play(run, ['crane', 110]);
    expect(run.results[1]).toMatchObject({ pausedMs: 85_000 });
    expect(wordSeconds(run.results[1])).toBe(15);
    expect(runElapsedMs(run, at(120))).toBe(35_000);
  });

  it('refuses guesses and giving up a word while paused', () => {
    const paused = ok(pauseRun(soloRun(), at(5)));
    expect(submitRunGuess(paused, 'beach', at(6))).toEqual({ ok: false, error: 'paused' });
    expect(giveUpWord(paused, at(6))).toEqual({ ok: false, error: 'paused' });
    expect(pauseRun(paused, at(7))).toEqual({ ok: false, error: 'paused' });
  });

  it('stops counting when a paused run ends', () => {
    const run = ok(endRun(ok(pauseRun(play(soloRun(), ['beach', 10]), at(15))), at(90)));
    expect(run.results.map(wordSeconds)).toEqual([10, 5, null]);
    expect(runElapsedMs(run, at(200))).toBe(15_000);
  });

  it('is only allowed in a pausable run', () => {
    expect(pauseRun(newRun(), at(1))).toEqual({ ok: false, error: 'not-pausable' });
    expect(resumeRun(soloRun(), at(1))).toEqual({ ok: false, error: 'not-paused' });
  });
});

describe('scoreSoloRun', () => {
  it('scores a finished run as played', () => {
    const run = play(soloRun(), ['bunny', 5], ['beach', 20], ['crane', 50], ['storm', 60]);
    expect(scoreSoloRun(run)).toEqual([
      { guesses: 2, seconds: 20 }, { guesses: 1, seconds: 30 }, { guesses: 1, seconds: 10 },
    ]);
  });

  it('scores a word given up as the worst word found, plus 10 guesses', () => {
    let run = play(soloRun(), ['bunny', 5], ['plots', 8], ['beach', 20]);
    run = ok(giveUpWord(play(run, ['moist', 25]), at(26)));
    run = play(run, ['storm', 50]);
    expect(scoreSoloRun(run)).toEqual([
      { guesses: 3, seconds: 20 }, { guesses: 13, seconds: 24 }, { guesses: 1, seconds: 24 },
    ]);
  });

  it('has no score until the run is over, once it is ended early, or if no word was found', () => {
    expect(scoreSoloRun(play(soloRun(), ['beach', 10]))).toBeNull();
    expect(scoreSoloRun(ok(endRun(play(soloRun(), ['beach', 10]), at(20))))).toBeNull();
    let run = soloRun();
    for (const s of [1, 2, 3]) run = ok(giveUpWord(run, at(s)));
    expect(scoreSoloRun(run)).toBeNull();
  });

  it('scores words left when the time ran out as given up, from this run alone, but not a run given up early', () => {
    const run = play(newRun(60_000), ['beach', 10]);
    expect(scoreSoloRun(ok(endRun(run, at(100))))).toEqual([
      { guesses: 1, seconds: 10 }, { guesses: 11, seconds: 50 }, { guesses: 11, seconds: 10 },
    ]);
    expect(scoreSoloRun(ok(endRun(run, at(30))))).toBeNull();
  });
});

describe('difficulty', () => {
  it('takes any level before the first guess, then only easier ones, scored at the easiest used', () => {
    let run = ok(createRun(['beach', 'crane'], T, { pausable: true, difficulty: 'extreme' }));
    expect(run.scoredDifficulty).toBe('extreme');
    run = ok(setRunDifficulty(run, 'medium', at(5)));
    run = ok(setRunDifficulty(run, 'extreme', at(6)));
    expect(run).toMatchObject({ playingDifficulty: 'extreme', scoredDifficulty: 'extreme' });
    // A guess at the first word holds the whole run to easier levels, the next word too.
    run = play(run, ['beach', 10]);
    run = ok(setRunDifficulty(run, 'hard', at(12)));
    expect(setRunDifficulty(run, 'extreme', at(13))).toEqual({ ok: false, error: 'difficulty-harder' });
    expect(run).toMatchObject({ playingDifficulty: 'hard', scoredDifficulty: 'hard' });
  });

  it('still replays a harder level after a guess, from before that was refused', () => {
    const run = play(ok(createRun(['beach', 'crane'], T, { pausable: true, difficulty: 'medium' })), ['bunny', 10]);
    const record = { ...toRunRecord(run), moves: [...run.moves, { kind: 'difficulty' as const, difficulty: 'extreme' as const, at: at(11) }] };
    const replayed = ok(replayRun(record));
    expect(replayed).toMatchObject({ playingDifficulty: 'extreme', scoredDifficulty: 'medium' });
  });

  it('cannot change once the run is over', () => {
    const over = ok(endRun(soloRun(), at(1)));
    expect(setRunDifficulty(over, 'hard', at(2))).toEqual({ ok: false, error: 'game-over' });
  });
});

describe('summarizeSoloRun', () => {
  /** Plays 15 guesses at each of 4 words, 60 seconds a word. */
  function played(difficulty: 'medium' | 'extreme') {
    const words = ['beach', 'crane', 'storm', 'plots'];
    let run = ok(createRun(words, T, { pausable: true, difficulty }));
    words.forEach((word, i) => {
      for (let g = 0; g < 14; g++) run = ok(submitRunGuess(run, 'bunny', at(i * 60 + g)));
      run = ok(submitRunGuess(run, word, at((i + 1) * 60)));
    });
    return run;
  }

  it('averages guesses and time per word, and ranks the average', () => {
    expect(summarizeSoloRun(played('medium'))).toMatchObject({
      average: { guesses: 15, seconds: 60 }, totalSeconds: 240,
      difficulty: 'medium', factor: 1, score: 15, level: 'skilled',
    });
  });

  it('counts guesses for less at a harder difficulty', () => {
    const summary = summarizeSoloRun(played('extreme'));
    expect(summary).toMatchObject({ difficulty: 'extreme', factor: 0.8, level: 'expert' });
    expect(summary?.score).toBeCloseTo(12);
  });

  it('has no summary when the run has no score', () => {
    expect(summarizeSoloRun(soloRun())).toBeNull();
  });

  it('scores a Rush by average time a word, × the factor, and ranks the time', () => {
    const rush = (difficulty: 'medium' | 'extreme') => {
      const record = { ...toRunRecord(played(difficulty)), rankBy: 'rush' as const };
      return ok(replayRun(record));
    };
    // 60 seconds a word: under 2 minutes is Mastermind.
    expect(summarizeSoloRun(rush('medium'))).toMatchObject({ rankBy: 'rush', score: 60, level: 'mastermind' });
    expect(summarizeSoloRun(rush('extreme'))?.score).toBeCloseTo(48);
    // A Crush's level is by guesses, and a run can be summarized either way (the Daily Set is on both boards).
    expect(summarizeSoloRun(played('medium'))).toMatchObject({ rankBy: 'crush', score: 15, level: 'skilled' });
    expect(summarizeSoloRun(played('medium'), 'rush')).toMatchObject({ rankBy: 'rush', score: 60 });
  });
});

describe('Rush and Crush', () => {
  it('keeps a Rush in its record, and leaves a Crush out as runs from before did', () => {
    const rush = ok(createRun(['beach'], T, { pausable: true, rankBy: 'rush' }));
    expect(toRunRecord(rush).rankBy).toBe('rush');
    expect(ok(replayRun(toRunRecord(rush))).rankBy).toBe('rush');
    expect('rankBy' in toRunRecord(soloRun())).toBe(false);
    // Read back from storage: a Rush stays one, "crush" is the same as left out, and anything else is refused.
    const stored = JSON.parse(JSON.stringify(toRunRecord(rush)));
    expect(parseRunRecord(stored)?.rankBy).toBe('rush');
    expect(parseRunRecord({ ...stored, rankBy: 'crush' })).not.toHaveProperty('rankBy');
    expect(parseRunRecord({ ...stored, rankBy: 'fast' })).toBeNull();
  });

  it('adds 2 minutes to a word given up in a Rush, but nothing to its time in a Crush', () => {
    const giveUp = (rankBy: 'rush' | 'crush') => {
      let run = ok(createRun(['beach', 'crane', 'storm'], T, { pausable: true, rankBy }));
      run = play(run, ['beach', 20]);
      run = ok(giveUpWord(play(run, ['moist', 25]), at(26)));
      return scoreSoloRun(play(run, ['storm', 50]));
    };
    // Its time is the slowest word found (24 seconds), and in a Rush 2 minutes more.
    expect(giveUp('crush')?.[1]).toEqual({ guesses: 11, seconds: 24 });
    expect(giveUp('rush')?.[1]).toEqual({ guesses: 11, seconds: 144 });
  });
});

describe('toWordResult', () => {
  it("gives each finished word's guesses, seconds and whether it was solved", () => {
    const run = ok(endRun(play(newRun(), ['bunny', 5], ['beach', 20], ['plots', 25]), at(32)));
    expect(run.results.map(toWordResult)).toEqual([
      { solved: true, guesses: 2, seconds: 20 },
      { solved: false, guesses: 1, seconds: 12 },
      { solved: false, guesses: 0, seconds: 0 },
    ]);
  });

  it('is null for the word being played', () => {
    expect(toWordResult(newRun().results[0])).toBeNull();
  });
});

describe('pickRunWords', () => {
  it('picks different words from the list', () => {
    const words = pickRunWords(SECRET_WORDS, 5);
    expect(new Set(words).size).toBe(5);
    for (const word of words) expect(SECRET_WORDS).toContain(word);
  });

  it('never repeats a word, even with a stuck random source', () => {
    expect(pickRunWords(['beach', 'crane', 'storm'], 3, () => 0)).toEqual(['beach', 'crane', 'storm']);
  });

  it('throws when there are not enough words', () => {
    expect(() => pickRunWords(['beach'], 2)).toThrow();
  });
});
