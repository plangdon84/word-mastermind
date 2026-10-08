import { describe, expect, it } from 'vitest';
import {
  clockMinutesOf, concedePvp, createPvpGame, DAY_MS, isTimeControl, MINUTE_MS, pickFirstSeat, pvpClocks, pvpDeadline,
  pvpTurn, pvpView, replayPvp, setPvpDifficulty, submitPvpGuess, timeControlOf, timeControlText, timeOutPvp, toPvpRecord,
  turnDaysOf, type PvpGame, type Seat, type TimeControl,
} from './pvp';

const T = 1_000;

// The host's word is `storm`; the guest's is `beach`.
function newGame(first: Seat, control: TimeControl = '1d'): PvpGame {
  const result = createPvpGame({ host: 'storm', guest: 'beach' }, first, T, control, { host: 'medium', guest: 'hard' });
  if (!result.ok) throw new Error(`could not create game: ${result.error}`);
  return result.game;
}

/** Plays guesses in order, from whoever's turn it is. */
function play(game: PvpGame, ...guesses: string[]): PvpGame {
  for (const guess of guesses) {
    const seat = pvpTurn(game);
    if (!seat) throw new Error(`game over before ${guess}`);
    const result = submitPvpGuess(game, seat, guess, T);
    if (!result.ok) throw new Error(`${guess} rejected: ${result.error}`);
    game = result.game;
  }
  return game;
}

describe('createPvpGame', () => {
  it('normalizes both words and rejects an invalid one', () => {
    const created = createPvpGame({ host: ' Storm', guest: 'BEACH' }, 'guest', T, '3d', { host: 'medium', guest: 'medium' });
    expect(created.ok && created.game.secrets).toEqual({ host: 'storm', guest: 'beach' });
    expect(createPvpGame({ host: 'storm', guest: 'bunny' }, 'host', T, '1d', { host: 'medium', guest: 'medium' }))
      .toEqual({ ok: false, error: 'repeated-letters' });
  });
});

describe('turns', () => {
  it('alternate from the first player, and refuse a guess out of turn', () => {
    let game = newGame('guest');
    expect(pvpTurn(game)).toBe('guest');
    expect(submitPvpGuess(game, 'host', 'crane', T)).toEqual({ ok: false, error: 'not-your-turn' });
    game = play(game, 'crane');
    expect(pvpTurn(game)).toBe('host');
  });

  it("score each player against the other's word", () => {
    const game = play(newGame('host'), 'bunny', 'moist');
    expect(game.guesses.host).toEqual([{ guess: 'bunny', score: 1, isWin: false }]);
    expect(game.guesses.guest).toEqual([{ guess: 'moist', score: 4, isWin: false }]);
  });

  it("don't use up a turn on a word that isn't on the list", () => {
    const game = newGame('host');
    expect(submitPvpGuess(game, 'host', 'qzxvj', T)).toEqual({ ok: false, error: 'not-in-word-list' });
    expect(pvpTurn(game)).toBe('host');
  });
});

describe('the final guess', () => {
  it('gives the second player one more guess, and a hit is a draw', () => {
    let game = play(newGame('host'), 'beach');
    expect(game.status).toBe('final-guess');
    expect(pvpTurn(game)).toBe('guest');
    game = play(game, 'storm');
    expect(game.outcome).toEqual({ winner: null, reason: 'draw' });
  });

  it('is lost by a miss', () => {
    const game = play(newGame('host'), 'beach', 'crane');
    expect(game.outcome).toEqual({ winner: 'host', reason: 'found' });
  });

  it("isn't given when the second player finds the word first", () => {
    const game = play(newGame('host'), 'crane', 'storm');
    expect(game.outcome).toEqual({ winner: 'guest', reason: 'found' });
    expect(pvpTurn(game)).toBeNull();
  });
});

describe('conceding', () => {
  it('is open to either player, even out of turn, and loses', () => {
    const result = concedePvp(newGame('host'), 'guest', T);
    expect(result.ok && result.game.outcome).toEqual({ winner: 'host', reason: 'conceded' });
    expect(result.ok && concedePvp(result.game, 'host', T)).toEqual({ ok: false, error: 'game-over' });
  });
});

describe('the time per guess', () => {
  it('runs from the start for the first player, then from each guess', () => {
    const game = newGame('host');
    expect(pvpDeadline(game)).toBe(T + DAY_MS);
    const guessed = submitPvpGuess(game, 'host', 'crane', T + 5_000);
    expect(guessed.ok && pvpDeadline(guessed.game)).toBe(T + 5_000 + DAY_MS);
  });

  it("isn't reset by a change of difficulty", () => {
    const changed = setPvpDifficulty(newGame('host'), 'host', 'hard', T + 5_000);
    expect(changed.ok && pvpDeadline(changed.game)).toBe(T + DAY_MS);
  });

  it('is 3 days when the game says so', () => {
    const created = createPvpGame({ host: 'storm', guest: 'beach' }, 'host', T, '3d', { host: 'medium', guest: 'medium' });
    expect(created.ok && pvpDeadline(created.game)).toBe(T + 3 * DAY_MS);
  });

  it('accepts a guess in the last millisecond, of 1 day or 3', () => {
    const one = submitPvpGuess(newGame('host'), 'host', 'crane', T + DAY_MS - 1);
    expect(one.ok && one.game.moves).toHaveLength(1);
    const three = newGame('host', '3d');
    const last = submitPvpGuess(three, 'host', 'crane', T + 3 * DAY_MS - 1);
    expect(last.ok && last.game.moves).toHaveLength(1);
    expect(submitPvpGuess(three, 'host', 'crane', T + 3 * DAY_MS)).toEqual({ ok: false, error: 'time-up' });
  });

  it('refuses a guess once it has run out', () => {
    expect(submitPvpGuess(newGame('host'), 'host', 'crane', T + DAY_MS)).toEqual({ ok: false, error: 'time-up' });
  });

  it('loses the game for the player to move when it runs out, at the deadline', () => {
    const game = play(newGame('host'), 'crane');
    expect(timeOutPvp(game, T + DAY_MS - 1)).toEqual({ ok: false, error: 'time-left' });
    const late = timeOutPvp(game, T + DAY_MS + 60_000);
    expect(late.ok && late.game.outcome).toEqual({ winner: 'host', reason: 'timed-out' });
    expect(late.ok && late.game.moves.at(-1)).toEqual({ seat: 'guest', kind: 'timeout', at: T + DAY_MS });
    expect(late.ok && pvpDeadline(late.game)).toBeNull();
  });

  it('applies to the final guess too', () => {
    const game = play(newGame('host'), 'beach');
    const late = timeOutPvp(game, T + DAY_MS);
    expect(late.ok && late.game.outcome).toEqual({ winner: 'host', reason: 'timed-out' });
  });

  it('replays, and a timeout before the deadline fails to replay', () => {
    const late = timeOutPvp(newGame('guest'), T + DAY_MS);
    if (!late.ok) throw new Error(late.error);
    expect(replayPvp(toPvpRecord(late.game))).toEqual(late);
    const early = { ...toPvpRecord(late.game), moves: [{ seat: 'guest' as const, kind: 'timeout' as const, at: T }] };
    expect(replayPvp(early)).toEqual({ ok: false, error: 'time-left' });
    const wrongSeat = { ...toPvpRecord(late.game), moves: [{ seat: 'host' as const, kind: 'timeout' as const, at: T + DAY_MS }] };
    expect(replayPvp(wrongSeat)).toEqual({ ok: false, error: 'not-your-turn' });
  });
});

describe('time controls', () => {
  it('are 15, 10 or 5 minutes each, or 1 or 3 days per guess', () => {
    expect(['15m', '10m', '5m', '1d', '3d'].every(isTimeControl)).toBe(true);
    expect(isTimeControl('2d')).toBe(false);
    expect(clockMinutesOf('5m')).toBe(5);
    expect(clockMinutesOf('3d')).toBeNull();
    expect(turnDaysOf('3d')).toBe(3);
    expect(turnDaysOf('15m')).toBeNull();
    expect(timeControlText('10m')).toBe('10 minutes each');
    expect(timeControlText('1d')).toBe('1 day per guess');
  });

  it('are kept in the record, which old correspondence records already match', () => {
    expect(toPvpRecord(newGame('host', '5m'))).toMatchObject({ clockMinutes: 5 });
    expect(toPvpRecord(newGame('host', '5m'))).not.toHaveProperty('turnDays');
    expect(toPvpRecord(newGame('host', '3d'))).toMatchObject({ turnDays: 3 });
    expect(timeControlOf({ turnDays: 3 })).toBe('3d');
    expect(timeControlOf({ clockMinutes: 15 })).toBe('15m');
  });
});

describe('the chess clock', () => {
  const guessAt = (game: PvpGame, word: string, at: number) => {
    const result = submitPvpGuess(game, pvpTurn(game)!, word, at);
    if (!result.ok) throw new Error(result.error);
    return result.game;
  };

  it("runs only on each player's own turn", () => {
    let game = newGame('host', '5m');
    expect(pvpClocks(game)).toEqual({ host: 5 * MINUTE_MS, guest: 5 * MINUTE_MS });
    expect(pvpDeadline(game)).toBe(T + 5 * MINUTE_MS);
    game = guessAt(game, 'crane', T + 20_000);
    expect(pvpClocks(game)).toEqual({ host: 5 * MINUTE_MS - 20_000, guest: 5 * MINUTE_MS });
    expect(pvpDeadline(game)).toBe(T + 20_000 + 5 * MINUTE_MS);
    game = guessAt(game, 'moist', T + 50_000);
    expect(pvpClocks(game)).toEqual({ host: 5 * MINUTE_MS - 20_000, guest: 5 * MINUTE_MS - 30_000 });
    expect(pvpDeadline(game)).toBe(T + 50_000 + 5 * MINUTE_MS - 20_000);
  });

  it("isn't reset by a difficulty change", () => {
    const game = guessAt(newGame('host', '10m'), 'crane', T + 60_000);
    const changed = setPvpDifficulty(game, 'guest', 'extreme', T + 90_000);
    expect(changed.ok && pvpDeadline(changed.game)).toBe(T + 60_000 + 10 * MINUTE_MS);
  });

  it('loses the game for a player whose clock runs out, even on the final guess', () => {
    let game = guessAt(newGame('host', '5m'), 'beach', T + 10_000);
    expect(game.status).toBe('final-guess');
    const deadline = T + 10_000 + 5 * MINUTE_MS;
    expect(submitPvpGuess(game, 'guest', 'storm', deadline)).toEqual({ ok: false, error: 'time-up' });
    const out = timeOutPvp(game, deadline + 3_000);
    if (!out.ok) throw new Error(out.error);
    game = out.game;
    expect(game.outcome).toEqual({ winner: 'host', reason: 'timed-out' });
    expect(game.moves.at(-1)).toEqual({ seat: 'guest', kind: 'timeout', at: deadline });
    expect(replayPvp(toPvpRecord(game))).toEqual({ ok: true, game });
  });

  it('shows each player both clocks from their side', () => {
    const game = guessAt(newGame('guest', '15m'), 'storm', T + 45_000);
    expect(pvpView(game, 'host')).toMatchObject({
      timeControl: '15m', clocks: { you: 15 * MINUTE_MS, opponent: 15 * MINUTE_MS - 45_000 }, deadline: T + 45_000 + 15 * MINUTE_MS,
    });
    expect(pvpView(newGame('host'), 'host')).toMatchObject({ timeControl: '1d', clocks: null });
  });
});

describe('difficulty', () => {
  it('is per player: any level before your first guess, then only easier ones, scored at the easiest used', () => {
    const result = setPvpDifficulty(newGame('host'), 'guest', 'medium', T);
    expect(result.ok && result.game.playingDifficulty).toEqual({ host: 'medium', guest: 'medium' });
    // No guess yet: back up to Extreme, and that's the level it counts at.
    const back = result.ok ? setPvpDifficulty(result.game, 'guest', 'extreme', T) : result;
    expect(back.ok && back.game.scoredDifficulty).toEqual({ host: 'medium', guest: 'extreme' });
    if (!back.ok) throw new Error(back.error);
    // The host has guessed; the guest hasn't, so only the host is held to easier levels.
    const guessed = play(back.game, 'crane');
    expect(setPvpDifficulty(guessed, 'host', 'hard', T)).toEqual({ ok: false, error: 'difficulty-harder' });
    expect(setPvpDifficulty(guessed, 'guest', 'easy', T).ok).toBe(true);
    const down = setPvpDifficulty(guessed, 'host', 'easy', T);
    expect(down.ok && down.game.scoredDifficulty).toEqual({ host: 'easy', guest: 'extreme' });
  });
});

describe('rated games', () => {
  it("fix each player's difficulty, and say so in the record and view", () => {
    const created = createPvpGame({ host: 'storm', guest: 'beach' }, 'host', T, '10m', { host: 'hard', guest: 'hard' }, true);
    if (!created.ok) throw new Error(created.error);
    expect(setPvpDifficulty(created.game, 'host', 'medium', T)).toEqual({ ok: false, error: 'difficulty-fixed' });
    expect(toPvpRecord(created.game).rated).toBe(true);
    expect(replayPvp(toPvpRecord(created.game))).toEqual(created);
    expect(pvpView(created.game, 'guest').rated).toBe(true);
    expect(toPvpRecord(newGame('host'))).not.toHaveProperty('rated');
  });

  it('refuse Easy for either player', () => {
    const words = { host: 'storm', guest: 'beach' };
    expect(createPvpGame(words, 'host', T, '10m', { host: 'easy', guest: 'hard' }, true)).toEqual({ ok: false, error: 'easy-unrated' });
    expect(createPvpGame(words, 'host', T, '10m', { host: 'hard', guest: 'easy' }, true)).toEqual({ ok: false, error: 'easy-unrated' });
    expect(createPvpGame(words, 'host', T, '10m', { host: 'easy', guest: 'easy' }).ok).toBe(true);
  });
});

describe('records', () => {
  it('replay to the same game', () => {
    let game = play(newGame('guest'), 'crane', 'moist');
    const changed = setPvpDifficulty(game, 'host', 'easy', T);
    if (!changed.ok) throw new Error(changed.error);
    game = play(changed.game, 'beach', 'storm');
    expect(replayPvp(toPvpRecord(game))).toEqual({ ok: true, game });
  });

  it('still replay a harder level after a guess, from before that was refused', () => {
    const game = play(newGame('guest'), 'crane', 'moist');
    const record = { ...toPvpRecord(game), moves: [...toPvpRecord(game).moves, { seat: 'host' as const, kind: 'difficulty' as const, difficulty: 'extreme' as const, at: T }] };
    const replayed = replayPvp(record);
    expect(replayed.ok && replayed.game.playingDifficulty.host).toBe('extreme');
    expect(replayed.ok && replayed.game.scoredDifficulty.host).toBe('medium');
  });

  it('fail on a move out of turn', () => {
    const record = { ...toPvpRecord(newGame('host')), moves: [{ seat: 'guest' as const, kind: 'guess' as const, word: 'crane', at: T }] };
    expect(replayPvp(record)).toEqual({ ok: false, error: 'not-your-turn' });
  });
});

describe('pvpView', () => {
  it("shows each player their own side, hiding the opponent's word", () => {
    const game = play(newGame('host'), 'bunny');
    const host = pvpView(game, 'host');
    expect(host).toMatchObject({
      first: 'you', yourSecret: 'storm', theirSecret: null, turn: 'opponent', difficulty: 'medium',
      yourGuesses: [{ guess: 'bunny', score: 1, isWin: false }], theirGuesses: [],
    });
    const guest = pvpView(game, 'guest');
    expect(guest).toMatchObject({ first: 'opponent', yourSecret: 'beach', theirSecret: null, turn: 'you', difficulty: 'hard' });
    expect(JSON.stringify(guest)).not.toContain('storm');
  });

  it("reveals the opponent's word once you've found it, and at the end", () => {
    const game = play(newGame('host'), 'beach');
    expect(pvpView(game, 'host').theirSecret).toBe('beach');
    expect(pvpView(game, 'guest').theirSecret).toBeNull();
    const over = play(game, 'crane');
    expect(pvpView(over, 'guest')).toMatchObject({ theirSecret: 'storm', outcome: { result: 'lost', reason: 'found' } });
    expect(pvpView(over, 'host').outcome).toEqual({ result: 'won', reason: 'found' });
  });
});

describe('shared Medium marks', () => {
  const guess = (game: PvpGame, seat: Seat, word: string, marks?: Record<string, 'in' | 'out'>) => {
    const result = submitPvpGuess(game, seat, word, T, marks);
    if (!result.ok) throw new Error(result.error);
    return result.game;
  };

  it("show the opponent each Medium player's marks from their latest guess", () => {
    // The host plays at Medium, the guest at Hard.
    let game = guess(newGame('host'), 'host', 'bunny', { b: 'in', u: 'out' });
    expect(pvpView(game, 'guest')).toMatchObject({ theirDifficulty: 'medium', theirMarks: { b: 'in', u: 'out' } });
    expect(pvpView(game, 'host')).toMatchObject({ theirDifficulty: 'hard', theirMarks: null });
    game = guess(game, 'guest', 'crane', { c: 'in' });
    game = guess(game, 'host', 'crane', {});
    expect(pvpView(game, 'guest').theirMarks).toEqual({});
    // Marks sent at Hard aren't kept.
    expect(game.moves[1]).not.toHaveProperty('marks');
  });

  it("aren't shown once the player leaves Medium, nor kept from a guess without them", () => {
    let game = guess(newGame('host'), 'host', 'bunny', { b: 'in' });
    const changed = setPvpDifficulty(game, 'host', 'easy', T);
    if (!changed.ok) throw new Error(changed.error);
    expect(pvpView(changed.game, 'guest')).toMatchObject({ theirDifficulty: 'easy', theirMarks: null });
    game = guess(guess(game, 'guest', 'crane'), 'host', 'crane');
    expect(pvpView(game, 'guest').theirMarks).toBeNull();
  });

  it('keep only letters marked in or out, and replay from the record', () => {
    const game = guess(newGame('host'), 'host', 'bunny', { b: 'in', '1': 'in', u: 'maybe' as 'in', ab: 'out' });
    expect(game.sharedMarks.host).toEqual({ b: 'in' });
    expect(replayPvp(toPvpRecord(game))).toEqual({ ok: true, game });
  });
});

describe('pickFirstSeat', () => {
  it('picks either seat', () => {
    expect(pickFirstSeat(() => 0.2)).toBe('host');
    expect(pickFirstSeat(() => 0.7)).toBe('guest');
  });
});
