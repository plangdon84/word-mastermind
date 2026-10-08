import { describe, expect, it } from 'vitest';
import {
  closeLobby, computerMoves, computerPaceMs, configureLobby, createCompetitiveLobby, createLobby, DEFAULT_LOBBY_MINUTES,
  isLobbyCode, joinLobby, leaveLobby, LOBBY_SEATS, lobbyEndedAt, lobbyStandings, lobbyState, lobbyView, lobbyWakeAt,
  newLobbyCode, normalizeLobbyCode, OPEN_LOBBY_MS, playLobby, seatRun, seatWords, setLobbyWord, startLobby,
  type LobbyRecord, type LobbyResult,
} from './lobby';

const T = 1_000_000;
const at = (seconds: number) => T + seconds * 1000;
const WORDS = ['beach', 'crane', 'storm', 'light'];
const ANN = { id: 'ann', name: 'Ann' };
const BOB = { id: 'bob', name: 'Bob' };
const SETTINGS = { difficulty: 'hard', minutes: 30, computers: 0, strength: 'skilled' } as const;

/** A seeded random number generator (mulberry32), so the computers play the same each time. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = seeded(1);

function ok(result: LobbyResult): LobbyRecord {
  if (!result.ok) throw new Error(result.error);
  return result.lobby;
}

/**
 * The players' seats play their words in order, as a lobby from before
 * shuffled words did, so tests can say which word comes when. Computers keep
 * their order: their moves were made for it.
 */
function inOrder(lobby: LobbyRecord): LobbyRecord {
  const game = lobby.game!;
  return { ...lobby, game: { ...game, seats: game.seats.map((s) => (s.strength === null ? { ...s, order: undefined } : s)) } };
}

/** Ann's lobby with Bob in it, started at T. */
const started = (minutes = 30) => {
  let lobby = ok(joinLobby(createLobby('ABCDEF', ANN, 'medium', T), BOB, T));
  lobby = ok(configureLobby(lobby, 'ann', { difficulty: 'hard', minutes, computers: 0, strength: 'skilled' }, T));
  return inOrder(ok(startLobby(lobby, 'ann', WORDS, T, random)));
};

/** Plays each [player, guess, seconds] in order. */
function play(lobby: LobbyRecord, ...moves: [string, string, number][]): LobbyRecord {
  for (const [id, word, seconds] of moves) lobby = ok(playLobby(lobby, id, { kind: 'guess', word }, at(seconds)));
  return lobby;
}

describe('join codes', () => {
  it('are 6 unambiguous letters and digits, however they are typed', () => {
    const code = newLobbyCode(() => 0.5);
    expect(isLobbyCode(code)).toBe(true);
    expect(normalizeLobbyCode(' abc-def ')).toBe('ABCDEF');
    expect(normalizeLobbyCode('ABC DE2')).toBe('ABCDE2');
    // 0, O, 1 and I are left out, as easily mistaken.
    expect(normalizeLobbyCode('ABCDE0')).toBeNull();
    expect(normalizeLobbyCode('ABCDEFG')).toBeNull();
  });
});

describe('before the game', () => {
  it('opens with the host seated and a duration by difficulty', () => {
    const lobby = createLobby('ABCDEF', ANN, 'extreme', T);
    expect(lobby.players).toEqual([ANN]);
    expect(lobby.settings).toEqual(
      { difficulty: 'extreme', minutes: DEFAULT_LOBBY_MINUTES.extreme, computers: 0, strength: 'skilled' });
    expect(lobbyState(lobby, T)).toBe('open');
  });

  it('seats up to 5 players, once each', () => {
    let lobby = createLobby('ABCDEF', ANN, 'medium', T);
    for (let i = 1; i < LOBBY_SEATS; i++) lobby = ok(joinLobby(lobby, { id: `p${i}`, name: `P${i}` }, T));
    expect(ok(joinLobby(lobby, { id: 'p1', name: 'P1' }, T)).players).toHaveLength(LOBBY_SEATS);
    expect(joinLobby(lobby, { id: 'late', name: 'Late' }, T)).toEqual({ ok: false, error: 'lobby-full' });
  });

  it('lets players leave, but only the host changes settings, starts or closes it', () => {
    const lobby = ok(joinLobby(createLobby('ABCDEF', ANN, 'medium', T), BOB, T));
    expect(ok(leaveLobby(lobby, 'bob', T)).players).toEqual([ANN]);
    expect(leaveLobby(lobby, 'ann', T)).toEqual({ ok: false, error: 'not-host' });
    expect(configureLobby(lobby, 'bob', { ...SETTINGS, minutes: 20 }, T)).toEqual({ ok: false, error: 'not-host' });
    expect(configureLobby(lobby, 'ann', { ...SETTINGS, minutes: 21 }, T)).toEqual({ ok: false, error: 'bad-settings' });
    expect(startLobby(lobby, 'bob', WORDS, T, random)).toEqual({ ok: false, error: 'not-host' });
    expect(closeLobby(lobby, 'bob', T)).toEqual({ ok: false, error: 'not-host' });
    const closed = ok(closeLobby(lobby, 'ann', T));
    expect(lobbyState(closed, T)).toBe('closed');
    expect(joinLobby(closed, { id: 'cat', name: 'Cat' }, T)).toEqual({ ok: false, error: 'lobby-closed' });
  });

  it('needs a second player to start', () => {
    expect(startLobby(createLobby('ABCDEF', ANN, 'medium', T), 'ann', WORDS, T, random)).toEqual({ ok: false, error: 'need-players' });
  });

  it('closes if nobody starts it within a day', () => {
    const lobby = createLobby('ABCDEF', ANN, 'medium', T);
    expect(lobbyState(lobby, T + OPEN_LOBBY_MS)).toBe('closed');
    expect(joinLobby(lobby, BOB, T + OPEN_LOBBY_MS)).toEqual({ ok: false, error: 'lobby-closed' });
  });
});

describe('the game', () => {
  it('gives everyone the same words and one clock, and no more joining', () => {
    const lobby = started();
    expect(lobby.game?.difficulty).toBe('hard');
    expect(lobby.game?.durationMs).toBe(30 * 60_000);
    expect(joinLobby(lobby, { id: 'cat', name: 'Cat' }, at(1))).toEqual({ ok: false, error: 'already-started' });
    expect(playLobby(lobby, 'cat', { kind: 'guess', word: 'crane' }, at(1))).toEqual({ ok: false, error: 'not-in-lobby' });
  });

  it('plays each seat as its own run', () => {
    const lobby = play(started(), ['ann', 'crane', 5], ['ann', 'beach', 10], ['bob', 'storm', 12]);
    expect(seatRun(lobby.game!, 0, at(20)).current).toBe(1);
    expect(seatRun(lobby.game!, 1, at(20)).results[0].guesses.map((g) => g.guess)).toEqual(['storm']);
    expect(playLobby(lobby, 'bob', { kind: 'guess', word: 'xxxxx' }, at(13))).toEqual({ ok: false, error: 'not-in-word-list' });
  });

  it('is over once everyone has finished', () => {
    let lobby = play(started(), ...WORDS.map((w, i): [string, string, number] => ['ann', w, i + 1]));
    expect(lobbyState(lobby, at(10))).toBe('playing');
    lobby = ok(playLobby(lobby, 'bob', { kind: 'give-up' }, at(30)));
    expect(lobbyState(lobby, at(30))).toBe('over');
    expect(lobbyEndedAt(lobby, at(40))).toBe(at(30));
    expect(seatRun(lobby.game!, 1, at(30)).results.map((r) => r.outcome)).toEqual(['unsolved', 'unsolved', 'unsolved', 'unsolved']);
  });

  it('is over when the time is up, with every word not found unsolved', () => {
    const lobby = play(started(10), ['ann', 'beach', 5]);
    const end = T + 10 * 60_000;
    expect(lobbyState(lobby, end - 1)).toBe('playing');
    expect(lobbyState(lobby, end)).toBe('over');
    expect(lobbyEndedAt(lobby, end + 5000)).toBe(end);
    expect(seatRun(lobby.game!, 0, end).results.map((r) => r.outcome)).toEqual(['solved', 'unsolved', 'unsolved', 'unsolved']);
    expect(playLobby(lobby, 'bob', { kind: 'guess', word: 'crane' }, end + 1)).toEqual({ ok: false, error: 'time-up' });
  });

  it('can give up a word and move on', () => {
    const lobby = ok(playLobby(started(), 'bob', { kind: 'give-up-word' }, at(3)));
    expect(seatRun(lobby.game!, 1, at(3)).results[0].outcome).toBe('gave-up');
  });
});

describe('lobbyView', () => {
  it("shows your run, and only others' progress, never their guesses", () => {
    const lobby = play(started(), ['ann', 'crane', 5], ['ann', 'beach', 10], ['bob', 'storm', 12]);
    const view = lobbyView(lobby, ['bob'], at(20));
    expect(view).toMatchObject({ state: 'playing', host: false, joined: true, words: null });
    expect(view.run?.words[0]).toMatchObject({ word: null, guesses: [{ guess: 'storm' }] });
    const empty = { outcome: null, guesses: 0, counted: null };
    expect(view.standings).toEqual([
      { name: 'Ann', strength: null, you: false, rank: null, finished: false, score: null, seconds: null, words: [
        { outcome: 'solved', guesses: 2, counted: null }, empty, empty, empty,
      ] },
      { name: 'Bob', strength: null, you: true, rank: null, finished: false, score: null, seconds: null, words: [
        { outcome: null, guesses: 1, counted: null }, empty, empty, empty,
      ] },
    ]);
    // Ann sees the word she found; Bob doesn't, until the game is over.
    expect(lobbyView(lobby, ['ann'], at(20)).run?.words[0].word).toBe('beach');
    const over = lobbyView(lobby, ['bob'], T + 30 * 60_000);
    expect(over.state).toBe('over');
    expect(over.words).toEqual(WORDS);
    expect(over.run?.words.map((w) => w.word)).toEqual(WORDS);
  });

  it('lets someone who has not joined see who is in it', () => {
    const view = lobbyView(createLobby('ABCDEF', ANN, 'medium', T), ['cat'], T);
    expect(view).toMatchObject({ hostName: 'Ann', host: false, joined: false, run: null, players: [{ name: 'Ann', you: false }] });
    expect(view.closesAt).toBe(T + OPEN_LOBBY_MS);
  });
});

describe('computer players', () => {
  const MINUTE = 60_000;

  it('guess at a steady pace: the duration ÷ 4 words ÷ their fewest guesses per word', () => {
    expect(computerPaceMs(30 * MINUTE, 'skilled')).toBe(30_000);
    expect(computerPaceMs(30 * MINUTE, 'mastermind')).toBeCloseTo(64_286, 0);
    const moves = computerMoves(WORDS, 'skilled', T, 30 * MINUTE, seeded(7));
    expect(moves.slice(0, 3).map((m) => m.at)).toEqual([T + 30_000, T + 60_000, T + 90_000]);
  });

  it('find each word in turn, and stop when the time is up', () => {
    // Its pace gives it its fewest guesses per word on average (28 for 4 at Mastermind),
    // so whether it finds the last word is luck: it finds them in order, and none after the time.
    const moves = computerMoves(WORDS, 'mastermind', T, 90 * MINUTE, seeded(1));
    const wins = moves.filter((m) => m.kind === 'guess' && WORDS.includes(m.word));
    expect(wins.length).toBeGreaterThanOrEqual(3);
    expect(wins.map((m) => m.kind === 'guess' && m.word)).toEqual(WORDS.slice(0, wins.length));
    expect(moves.every((m) => m.at <= T + 90 * MINUTE)).toBe(true);
    expect(moves.length).toBeLessThanOrEqual(4 * 7);
    const short = computerMoves(WORDS, 'casual', T, 10 * MINUTE, seeded(3));
    expect(short.every((m) => m.at <= T + 10 * MINUTE)).toBe(true);
    // Casual needs about 28 guesses a word but has time for 25.
    expect(short.length).toBeLessThanOrEqual(100);
  });

  it('fill empty seats at the host\'s strength, and give way to a person who joins', () => {
    let lobby = ok(configureLobby(createLobby('ABCDEF', ANN, 'medium', T), 'ann', { ...SETTINGS, computers: 4 }, T));
    expect(configureLobby(lobby, 'ann', { ...SETTINGS, computers: 5 }, T)).toEqual({ ok: false, error: 'bad-settings' });
    expect(lobbyView(lobby, ['ann'], T).players.map((p) => p.strength)).toEqual([null, 'skilled', 'skilled', 'skilled', 'skilled']);
    lobby = ok(joinLobby(lobby, BOB, T));
    expect(lobby.settings.computers).toBe(3);
    const game = ok(startLobby(lobby, 'ann', WORDS, T, seeded(5))).game!;
    expect(game.seats.map((s) => s.name)).toEqual(['Ann', 'Bob', 'Computer 1', 'Computer 2', 'Computer 3']);
    expect(game.seats[2].moves.length).toBeGreaterThan(0);
  });

  it('let the host play against computers alone', () => {
    const lobby = ok(configureLobby(createLobby('ABCDEF', ANN, 'medium', T), 'ann', { ...SETTINGS, computers: 1 }, T));
    expect(ok(startLobby(lobby, 'ann', WORDS, T, seeded(5))).game?.seats).toHaveLength(2);
  });

  it("only count their moves once they're due", () => {
    const lobby = ok(startLobby(
      ok(configureLobby(createLobby('ABCDEF', ANN, 'medium', T), 'ann', { ...SETTINGS, computers: 1 }, T)),
      'ann', WORDS, T, seeded(5)));
    const game = lobby.game!;
    expect(seatRun(game, 1, T + 29_999).results[0].guesses).toHaveLength(0);
    expect(seatRun(game, 1, T + 30_000).results[0].guesses).toHaveLength(1);
    expect(lobbyView(lobby, ['ann'], T + 65_000).standings?.find((p) => p.strength)).toMatchObject(
      { name: 'Computer 1', strength: 'skilled', words: [{ guesses: 2 }, {}, {}, {}] });
  });

  it('wake the lobby when one finishes, before the time is up', () => {
    const lobby = ok(startLobby(
      ok(configureLobby(createLobby('ABCDEF', ANN, 'medium', T), 'ann', { ...SETTINGS, minutes: 90, computers: 1, strength: 'mastermind' }, T)),
      'ann', WORDS, T, seeded(1)));
    const game = lobby.game!;
    const last = game.seats[1].moves[game.seats[1].moves.length - 1].at;
    expect(lobbyWakeAt(lobby, T)).toBe(last);
    expect(lobbyWakeAt(lobby, last)).toBe(T + 90 * MINUTE);
    const done = ok(playLobby(lobby, 'ann', { kind: 'give-up' }, T + 1000));
    expect(lobbyState(done, last)).toBe('over');
    expect(lobbyEndedAt(done, last + 1)).toBe(last);
    expect(lobbyWakeAt(done, last)).toBeNull();
  });
});

describe('lobbyStandings', () => {
  /** Ann, Bob and Dan in a lobby started at T (README "Scoring": the penalty example). */
  const three = () => {
    let lobby = createLobby('ABCDEF', ANN, 'medium', T);
    for (const p of [BOB, { id: 'dan', name: 'Dan' }]) lobby = ok(joinLobby(lobby, p, T));
    return inOrder(ok(startLobby(lobby, 'ann', WORDS, T, random)));
  };
  /** `misses` wrong guesses at the word being played, a second apart from `from`, then (with `find`) the word. */
  function guesses(lobby: LobbyRecord, id: string, word: string, misses: number, from: number, find = true): LobbyRecord {
    const wrong = ['moist', 'plumb', 'dough', 'funky', 'jiffy'];
    for (let i = 0; i < misses; i++) lobby = ok(playLobby(lobby, id, { kind: 'guess', word: wrong[i % wrong.length] }, at(from + i)));
    return find ? ok(playLobby(lobby, id, { kind: 'guess', word }, at(from + misses))) : lobby;
  }

  it("counts a word given up as the worst solved result on it in the group, plus 10", () => {
    let lobby = three();
    // Word 1: Ann finds it in 12, Bob in 18, Dan gives up after 3.
    lobby = guesses(lobby, 'ann', 'beach', 11, 0);
    lobby = guesses(lobby, 'bob', 'beach', 17, 0);
    lobby = guesses(lobby, 'dan', 'beach', 3, 0, false);
    lobby = ok(playLobby(lobby, 'dan', { kind: 'give-up-word' }, at(40)));
    // The rest: everyone finds each word first time.
    for (const id of ['ann', 'bob', 'dan']) {
      for (const [i, word] of WORDS.slice(1).entries()) lobby = guesses(lobby, id, word, 0, 100 + i);
    }
    const standings = lobbyStandings(lobby.game!, at(200), ['dan']);
    expect(standings.map((s) => [s.name, s.rank])).toEqual([['Ann', 1], ['Bob', 2], ['Dan', 3]]);
    const dan = standings[2];
    expect(dan.you).toBe(true);
    expect(dan.words[0]).toMatchObject({ outcome: 'gave-up', guesses: 3, counted: { guesses: 28 } });
    // Medium counts each guess as 1: (28 + 1 + 1 + 1) / 4.
    expect(dan.score).toBe(31 / 4);
    expect(standings[0].score).toBe(15 / 4);
  });

  it('ranks those still playing after those done, and ties share a rank', () => {
    let lobby = three();
    for (const id of ['ann', 'bob']) {
      for (const [i, word] of WORDS.entries()) lobby = guesses(lobby, id, word, 1, 10 * i);
    }
    lobby = guesses(lobby, 'dan', 'beach', 0, 1);
    const standings = lobbyStandings(lobby.game!, at(100));
    expect(standings.map((s) => [s.name, s.rank, s.finished])).toEqual([
      ['Ann', 1, true], ['Bob', 1, true], ['Dan', null, false],
    ]);
    expect(standings[2].score).toBeNull();
  });

  it('scores at the difficulty factor, which is the same for everyone', () => {
    // started() is on Hard: × 0.9.
    let lobby = started();
    for (const [i, word] of WORDS.entries()) lobby = guesses(lobby, 'ann', word, 1, 10 * i);
    lobby = ok(playLobby(lobby, 'bob', { kind: 'give-up' }, at(50)));
    const [ann, bob] = lobbyStandings(lobby.game!, at(60));
    expect(ann.score).toBeCloseTo(2 * 0.9);
    // Bob found nothing: each word counts as Ann's 2 guesses plus 10.
    expect(bob.score).toBeCloseTo(12 * 0.9);
  });
});

describe('Rush with Friends, ranked by time', () => {
  it('opens on the host\'s pick, which the host can change, and ranks by time, then guesses', () => {
    let lobby = createLobby('ABCDEF', ANN, 'medium', T, 'rush');
    expect(lobby.settings.rankBy).toBe('rush');
    lobby = ok(configureLobby(lobby, 'ann', { ...SETTINGS }, T));
    expect(lobby.settings.rankBy).toBeUndefined();
    lobby = ok(configureLobby(ok(joinLobby(lobby, BOB, T)), 'ann', { ...SETTINGS, rankBy: 'rush' }, T));
    lobby = inOrder(ok(startLobby(lobby, 'ann', WORDS, T, random)));
    expect(lobby.game!.rankBy).toBe('rush');
    expect(seatRun(lobby.game!, 0, T).rankBy).toBe('rush');
    // Ann takes more guesses but is faster: first in a Rush.
    const wrong = ['moist', 'plumb', 'dough'];
    for (const [i, word] of WORDS.entries()) {
      lobby = play(lobby, ...wrong.map((w, g): [string, string, number] => ['ann', w, i * 10 + g]), ['ann', word, i * 10 + 5]);
      lobby = play(lobby, ['bob', word, 100 + i * 50]);
    }
    const standings = lobbyStandings(lobby.game!, at(400));
    expect(standings.map((s) => s.name)).toEqual(['Ann', 'Bob']);
    // The same game ranked by guesses puts Bob first.
    const crush = lobbyStandings({ ...lobby.game!, rankBy: undefined }, at(400));
    expect(crush.map((s) => s.name)).toEqual(['Bob', 'Ann']);
  });

  it('adds 2 minutes to the time of a word given up', () => {
    let lobby = createLobby('ABCDEF', ANN, 'medium', T, 'rush');
    lobby = inOrder(ok(startLobby(ok(joinLobby(lobby, BOB, T)), 'ann', WORDS, T, random)));
    lobby = play(lobby, ...WORDS.map((w, i): [string, string, number] => ['ann', w, 10 * (i + 1)]));
    lobby = ok(playLobby(lobby, 'bob', { kind: 'give-up' }, at(50)));
    const bob = lobbyStandings(lobby.game!, at(60)).find((s) => s.name === 'Bob')!;
    // Ann took 10 seconds a word. Bob spent 50 on the first, which counts as 50 + 120; the
    // three he never reached count as Ann's 10 + 120 each.
    expect(bob.seconds).toBe(170 + 3 * 130);
  });
});

describe('Competitive Rush', () => {
  /** The server's pick for the computers' words: one of them clashes with Ann's word. */
  const SPARE = ['crane', 'storm', 'light', 'ghost', 'moist'];
  const open = () => ok(createCompetitiveLobby('ABCDEF', { ...ANN, word: ' Crane ' }, 'medium', T));
  /** Ann (CRANE) and Bob (BEACH), with 3 computers, started at T. */
  const duel = () => {
    const lobby = ok(joinLobby(open(), { ...BOB, word: 'beach' }, T));
    return inOrder(ok(startLobby(lobby, 'ann', SPARE, T, seeded(5))));
  };

  it('needs a valid secret word from everyone who sits down', () => {
    expect(createCompetitiveLobby('ABCDEF', ANN, 'medium', T)).toEqual({ ok: false, error: 'need-word' });
    expect(createCompetitiveLobby('ABCDEF', { ...ANN, word: 'geese' }, 'medium', T)).toEqual({ ok: false, error: 'repeated-letters' });
    const lobby = open();
    expect(lobby.players[0].word).toBe('crane');
    expect(joinLobby(lobby, BOB, T)).toEqual({ ok: false, error: 'need-word' });
    expect(ok(setLobbyWord(lobby, 'ann', 'storm', T)).players[0].word).toBe('storm');
    expect(setLobbyWord(lobby, 'bob', 'storm', T)).toEqual({ ok: false, error: 'not-in-lobby' });
    expect(setLobbyWord(createLobby('ABCDEF', ANN, 'medium', T), 'ann', 'storm', T)).toEqual({ ok: false, error: 'bad-settings' });
  });

  it('leaves Easy out, since it is rated', () => {
    expect(createCompetitiveLobby('ABCDEF', { ...ANN, word: 'crane' }, 'easy', T)).toEqual({ ok: false, error: 'bad-settings' });
    expect(configureLobby(open(), 'ann', { ...open().settings, difficulty: 'easy' }, T)).toEqual({ ok: false, error: 'bad-settings' });
    expect(ok(configureLobby(createLobby('ABCDEF', ANN, 'medium', T), 'ann', { ...open().settings, computers: 0, difficulty: 'easy' }, T))
      .settings.difficulty).toBe('easy');
  });

  it("won't start while two players share a word, without saying whose", () => {
    let lobby = ok(joinLobby(open(), { ...BOB, word: 'CRANE' }, T));
    expect(startLobby(lobby, 'ann', SPARE, T, seeded(5))).toEqual({ ok: false, error: 'same-words' });
    lobby = ok(setLobbyWord(lobby, 'bob', 'beach', T));
    expect(ok(startLobby(lobby, 'ann', SPARE, T, seeded(5))).game).not.toBeNull();
  });

  it('fills every empty seat with a computer, whatever the host asks', () => {
    let lobby = open();
    expect(lobby.settings.computers).toBe(4);
    lobby = ok(joinLobby(lobby, { ...BOB, word: 'beach' }, T));
    expect(lobby.settings.computers).toBe(3);
    expect(ok(configureLobby(lobby, 'ann', { ...SETTINGS, computers: 0 }, T)).settings.computers).toBe(3);
    expect(ok(leaveLobby(lobby, 'bob', T)).settings.computers).toBe(4);
  });

  it("gives each seat the others' words, and never a computer a player's word", () => {
    const game = duel().game!;
    expect(game.seats.map((s) => s.word)).toEqual(['crane', 'beach', 'storm', 'light', 'ghost']);
    expect(seatWords(game, 0)).toEqual(['beach', 'storm', 'light', 'ghost']);
    expect(seatWords(game, 1)).toEqual(['crane', 'storm', 'light', 'ghost']);
    expect(game.seats[2].moves.length).toBeGreaterThan(0);
    const view = lobbyView(duel(), ['bob'], T);
    expect(view).toMatchObject({ kind: 'competitive', yourWord: 'beach' });
    expect(view.run?.setBy).toEqual(['Ann', 'Computer 1', 'Computer 2', 'Computer 3']);
    expect(lobbyView(started(), ['bob'], T)).toMatchObject({ kind: 'friends', yourWord: null, run: { setBy: null } });
  });

  it("counts a word given up from the others' results on that word", () => {
    let lobby = duel();
    // Ann finds Bob's word (her first) in 3; Bob gives up Ann's word (his first).
    lobby = play(lobby, ['ann', 'moist', 1], ['ann', 'plumb', 2], ['ann', 'beach', 3]);
    lobby = ok(playLobby(lobby, 'bob', { kind: 'give-up-word' }, at(4)));
    for (const id of ['ann', 'bob']) lobby = ok(playLobby(lobby, id, { kind: 'give-up' }, at(5)));
    const [first, second] = lobbyStandings(lobby.game!, at(5), ['bob']).filter((s) => s.strength === null);
    expect(first.name).toBe('Ann');
    // Nobody else has found CRANE yet, so Bob's penalty comes from the worst word found in the group: Ann's 3
    // guesses, and at least the 4 seconds he spent.
    expect(second.words[0].counted).toEqual({ guesses: 13, seconds: 4 });
  });
});

describe('shuffled words', () => {
  it("gives each seat the same words in its own order, kept in the record", () => {
    let lobby = createLobby('ABCDEF', ANN, 'medium', T);
    for (const p of [BOB, { id: 'dan', name: 'Dan' }, { id: 'eve', name: 'Eve' }]) lobby = ok(joinLobby(lobby, p, T));
    const game = ok(startLobby(lobby, 'ann', WORDS, T, seeded(3))).game!;
    const orders = game.seats.map((_, i) => seatWords(game, i));
    for (const words of orders) expect([...words].sort()).toEqual([...WORDS].sort());
    // Four seats in the same order would be a 1 in 13,824 chance: with this seed they differ.
    expect(new Set(orders.map((w) => w.join())).size).toBeGreaterThan(1);
    expect(game.seats.every((s) => s.order?.length === 4)).toBe(true);
  });

  it('compares results by word, whatever order each seat met them in', () => {
    let lobby = ok(joinLobby(createLobby('ABCDEF', ANN, 'medium', T), BOB, T));
    lobby = ok(startLobby(lobby, 'ann', WORDS, T, seeded(3)));
    const game = lobby.game!;
    // Ann finds her first word in 3; Bob gives up that same word, wherever it falls for him, and finds the rest at once.
    const target = seatWords(game, 0)[0];
    lobby = ok(playLobby(lobby, 'ann', { kind: 'guess', word: 'moist' }, at(1)));
    lobby = ok(playLobby(lobby, 'ann', { kind: 'guess', word: 'plumb' }, at(2)));
    for (const [i, word] of seatWords(game, 0).entries()) lobby = ok(playLobby(lobby, 'ann', { kind: 'guess', word }, at(3 + i)));
    for (const [i, word] of seatWords(game, 1).entries()) {
      lobby = word === target ? ok(playLobby(lobby, 'bob', { kind: 'give-up-word' }, at(10 + i)))
        : ok(playLobby(lobby, 'bob', { kind: 'guess', word }, at(10 + i)));
    }
    const bob = lobbyStandings(lobby.game!, at(20)).find((p) => p.name === 'Bob')!;
    const given = bob.words.find((w) => w.outcome === 'gave-up')!;
    // Ann's 3 guesses on that word, plus 10.
    expect(given.counted?.guesses).toBe(13);
  });
});
