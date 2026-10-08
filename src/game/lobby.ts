import { pickComputerGuess, type Strength } from './computer';
import type { DailyWordView } from './daily';
import { DIFFICULTY_FACTOR, isRatedDifficulty, type Difficulty } from './difficulty';
import {
  createRun, endRun, giveUpWord, replayRun, runDeadline, shuffled, submitRunGuess, suggestRun, toRunRecord, type RunError, type RunGame,
  type RunMove, type RunRecord, toWordResult, type WordOutcome,
} from './run';
import {
  averageWord, evaluateGuess, penalized, totalSeconds, type GuessResult, type ScoredWord, type WordResult,
} from './scoring';
import { validateSecretWord } from './words';

/*
 * Rush with Friends (README "Rush modes"): a lobby of up to 5 players, one
 * difficulty, and the same 4 server-picked words for everyone on one clock
 * that never pauses. The server referees it (`worker/src/lobbyRoom.ts`).
 *
 * Competitive Rush is the same lobby, except each player sets a secret word
 * and solves the other 4: every seat is filled (computers take the empty
 * ones, each with a random word), and each word's group penalty counts the
 * results of the 4 players who solved it.
 *
 * A lobby is a record: who joined, the host's settings and, once started,
 * the words, the start time and each seat's moves. Each seat's run is
 * rebuilt by replaying its moves (`run.ts`). Like the rest of the game
 * logic, nothing here reads the clock: the time is passed in.
 */

/** Most players in a lobby, the host included. */
export const LOBBY_SEATS = 5;

/** Every Rush has 4 words. */
export const LOBBY_WORDS = 4;

/** The durations a host can pick, in minutes (to be tuned from play). */
export const LOBBY_MINUTES = [10, 15, 20, 30, 40, 50, 60, 90] as const;

/** The duration a lobby starts with, by difficulty: harder takes longer. */
export const DEFAULT_LOBBY_MINUTES: Readonly<Record<Difficulty, number>> = { easy: 20, medium: 30, hard: 40, extreme: 50 };

/** A lobby nobody starts within a day closes. */
export const OPEN_LOBBY_MS = 24 * 60 * 60 * 1000;

/** A join code: 6 letters and digits, leaving out the ones easily mistaken for others (0 O 1 I). */
export const LOBBY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LOBBY_CODE_LENGTH = 6;

export const isLobbyCode = (value: unknown): value is string =>
  typeof value === 'string' && value.length === LOBBY_CODE_LENGTH
  && [...value].every((c) => LOBBY_CODE_ALPHABET.includes(c));

/** A code as typed ("abc-def", " ABC DEF "), or null if it can't be one. */
export function normalizeLobbyCode(typed: string): string | null {
  const code = typed.toUpperCase().replace(/[\s-]/g, '');
  return isLobbyCode(code) ? code : null;
}

/** A new join code from `random`, which returns a number in [0, 1). */
export function newLobbyCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < LOBBY_CODE_LENGTH; i++) code += LOBBY_CODE_ALPHABET[Math.floor(random() * LOBBY_CODE_ALPHABET.length)];
  return code;
}

/** What the host sets before starting. */
export interface LobbySettings {
  difficulty: Difficulty;
  minutes: number;
  /** Computer players in empty seats, all at one strength. */
  computers: number;
  strength: Strength;
}

/** Rush with Friends, or Competitive Rush. */
export type LobbyKind = 'friends' | 'competitive';

export interface LobbyPlayer {
  /** Their player ID (their account's, once signed in). */
  id: string;
  name: string;
  /** Competitive Rush: the secret word they set, which the others solve. */
  word?: string;
}

/**
 * One seat of a started game: who sits there and their moves. A computer's
 * moves are all made when the game starts, each at the time it's due
 * (`computerMoves`), and only count once that time comes.
 */
export interface LobbySeat {
  id: string;
  name: string;
  /** A computer player's strength; null for a person. */
  strength: Strength | null;
  /** Competitive Rush: the word this seat set (a computer's is random). */
  word?: string;
  /**
   * The order this seat plays its words in, picked by the server when the
   * game starts: `order[k]` is the slot (in `seatSlots`' order) of the k-th
   * word it plays. Left out in lobbies from before, which play in order.
   */
  order?: readonly number[];
  moves: readonly RunMove[];
}

/** A started game: everything each seat's run replays from. */
export interface LobbyGame {
  /**
   * Rush with Friends: the 4 words everyone solves. Competitive Rush: each
   * seat's word, in seat order; a seat solves the others' (`seatWords`).
   */
  words: readonly string[];
  startedAt: number;
  durationMs: number;
  difficulty: Difficulty;
  seats: readonly LobbySeat[];
}

/** What to save: everything else is rebuilt from it. */
export interface LobbyRecord {
  code: string;
  /** Left out for Rush with Friends, as in lobbies from before Competitive Rush. */
  kind?: 'competitive';
  createdAt: number;
  /** In the order they joined: the host is first. */
  players: readonly LobbyPlayer[];
  settings: LobbySettings;
  /** Null until the host starts the game. */
  game: LobbyGame | null;
  /** The host closed the lobby before starting it. */
  closed: boolean;
}

/**
 * Where a lobby is: open for players to join, closed (by the host, or
 * nobody started it in time), playing, or over (everyone finished, or the
 * time is up).
 */
export type LobbyState = 'open' | 'closed' | 'playing' | 'over';

export type LobbyError =
  | RunError | 'lobby-full' | 'already-started' | 'lobby-closed' | 'not-host' | 'not-in-lobby' | 'not-started'
  | 'bad-settings' | 'need-players' | 'need-word' | 'same-words';

export type LobbyResult = { ok: true; lobby: LobbyRecord } | { ok: false; error: LobbyError };

export const isLobbyMinutes = (value: unknown): value is number =>
  (LOBBY_MINUTES as readonly unknown[]).includes(value);

export const lobbyKind = (lobby: LobbyRecord): LobbyKind => lobby.kind ?? 'friends';

/** A Competitive Rush game: its seats set the words. */
const competitiveGame = (game: LobbyGame): boolean => game.seats.some((s) => s.word !== undefined);

export function createLobby(code: string, host: LobbyPlayer, difficulty: Difficulty, now: number): LobbyRecord {
  return {
    code, createdAt: now, players: [host],
    settings: { difficulty, minutes: DEFAULT_LOBBY_MINUTES[difficulty], computers: 0, strength: 'skilled' },
    game: null, closed: false,
  };
}

/** A player with their word checked: a Competitive Rush seat needs a valid secret word. */
function withWord(player: LobbyPlayer): { ok: true; player: LobbyPlayer } | { ok: false; error: LobbyError } {
  if (player.word === undefined) return { ok: false, error: 'need-word' };
  const checked = validateSecretWord(player.word);
  return checked.ok ? { ok: true, player: { ...player, word: checked.word } } : checked;
}

/** Opens a Competitive Rush lobby: the host sets a word, and computers fill the other seats until people join. */
export function createCompetitiveLobby(code: string, host: LobbyPlayer, difficulty: Difficulty, now: number): LobbyResult {
  // Competitive Rush is rated, so it leaves Easy out.
  if (!isRatedDifficulty(difficulty)) return { ok: false, error: 'bad-settings' };
  const checked = withWord(host);
  if (!checked.ok) return checked;
  const lobby = createLobby(code, checked.player, difficulty, now);
  return { ok: true, lobby: { ...lobby, kind: 'competitive', settings: { ...lobby.settings, computers: LOBBY_SEATS - 1 } } };
}

/**
 * The fewest guesses a word takes each computer strength on average: the
 * low end of its target (README "Computer strength").
 */
export const FEWEST_GUESSES: Readonly<Record<Strength, number>> = { casual: 25, skilled: 15, expert: 10, mastermind: 7 };

/**
 * How often a computer player guesses: the duration ÷ 4 words ÷ its fewest
 * guesses per word. Stronger computers make fewer guesses but take longer
 * over each; one that needs more guesses than that doesn't finish in time.
 */
export const computerPaceMs = (durationMs: number, strength: Strength): number =>
  durationMs / LOBBY_WORDS / FEWEST_GUESSES[strength];

/**
 * A computer player's whole game, played out when the game starts: a guess
 * every `computerPaceMs`, each word until it's found, and nothing after the
 * time is up. `random` returns a number in [0, 1).
 */
export function computerMoves(
  words: readonly string[], strength: Strength, startedAt: number, durationMs: number, random: () => number,
): RunMove[] {
  const pace = computerPaceMs(durationMs, strength);
  const deadline = startedAt + durationMs;
  const moves: RunMove[] = [];
  let guessNumber = 0;
  for (const word of words) {
    const history: GuessResult[] = [];
    for (;;) {
      const at = Math.round(startedAt + ++guessNumber * pace);
      if (at > deadline) return moves;
      const result = evaluateGuess(pickComputerGuess(history, strength, random), word);
      moves.push({ kind: 'guess', word: result.guess, at });
      history.push(result);
      if (result.isWin) break;
    }
  }
  return moves;
}

/** Seats not taken by a person, which computers can fill. */
export const emptySeats = (lobby: LobbyRecord): number => LOBBY_SEATS - lobby.players.length;

export const lobbyHost = (lobby: LobbyRecord): LobbyPlayer => lobby.players[0];

/** Why the lobby can't change before the game: it's started, or closed. */
function checkOpen(lobby: LobbyRecord, now: number): LobbyError | null {
  if (lobby.game) return 'already-started';
  if (lobby.closed || now >= lobby.createdAt + OPEN_LOBBY_MS) return 'lobby-closed';
  return null;
}

/**
 * Takes a seat. Joining again, e.g. from another device, changes nothing. A
 * person takes a computer's seat if there's no empty one.
 */
export function joinLobby(lobby: LobbyRecord, joining: LobbyPlayer, now: number): LobbyResult {
  if (lobby.players.some((p) => p.id === joining.id)) return { ok: true, lobby };
  const blocked = checkOpen(lobby, now);
  if (blocked) return { ok: false, error: blocked };
  if (lobby.players.length >= LOBBY_SEATS) return { ok: false, error: 'lobby-full' };
  let player: LobbyPlayer = { id: joining.id, name: joining.name };
  if (lobbyKind(lobby) === 'competitive') {
    const checked = withWord(joining);
    if (!checked.ok) return checked;
    player = checked.player;
  }
  const players = [...lobby.players, player];
  const computers = Math.min(lobby.settings.computers, LOBBY_SEATS - players.length);
  return { ok: true, lobby: { ...lobby, players, settings: { ...lobby.settings, computers } } };
}

/** Leaves before the game starts. The host can't leave; they close the lobby instead. */
export function leaveLobby(lobby: LobbyRecord, playerId: string, now: number): LobbyResult {
  const blocked = checkOpen(lobby, now);
  if (blocked) return { ok: false, error: blocked };
  if (lobbyHost(lobby).id === playerId) return { ok: false, error: 'not-host' };
  if (!lobby.players.some((p) => p.id === playerId)) return { ok: false, error: 'not-in-lobby' };
  const players = lobby.players.filter((p) => p.id !== playerId);
  // In Competitive Rush, a computer takes the seat back.
  const computers = lobbyKind(lobby) === 'competitive' ? LOBBY_SEATS - players.length : lobby.settings.computers;
  return { ok: true, lobby: { ...lobby, players, settings: { ...lobby.settings, computers } } };
}

/** A Competitive Rush player changes their word before the game starts. */
export function setLobbyWord(lobby: LobbyRecord, playerId: string, word: string, now: number): LobbyResult {
  const blocked = checkOpen(lobby, now);
  if (blocked) return { ok: false, error: blocked };
  if (lobbyKind(lobby) !== 'competitive') return { ok: false, error: 'bad-settings' };
  const player = lobby.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: 'not-in-lobby' };
  const checked = withWord({ ...player, word });
  if (!checked.ok) return checked;
  return { ok: true, lobby: { ...lobby, players: lobby.players.map((p) => (p.id === playerId ? checked.player : p)) } };
}

/** The host closes the lobby before starting it. */
export function closeLobby(lobby: LobbyRecord, playerId: string, now: number): LobbyResult {
  const blocked = checkOpen(lobby, now);
  if (blocked) return { ok: false, error: blocked };
  if (lobbyHost(lobby).id !== playerId) return { ok: false, error: 'not-host' };
  return { ok: true, lobby: { ...lobby, closed: true } };
}

/**
 * The host changes the difficulty, the duration, or the computers in empty
 * seats. In Competitive Rush, computers always fill every empty seat.
 */
export function configureLobby(lobby: LobbyRecord, playerId: string, settings: LobbySettings, now: number): LobbyResult {
  const blocked = checkOpen(lobby, now);
  if (blocked) return { ok: false, error: blocked };
  if (lobbyHost(lobby).id !== playerId) return { ok: false, error: 'not-host' };
  const { difficulty, minutes, strength } = settings;
  const competitive = lobbyKind(lobby) === 'competitive';
  const computers = competitive ? emptySeats(lobby) : settings.computers;
  if ((competitive && !isRatedDifficulty(difficulty)) || !isLobbyMinutes(minutes) || !Number.isInteger(computers) || computers < 0 || computers > emptySeats(lobby)) {
    return { ok: false, error: 'bad-settings' };
  }
  return { ok: true, lobby: { ...lobby, settings: { difficulty, minutes, computers, strength } } };
}

/** A computer seat's ID and name: "Computer 1", "Computer 2"… */
const computerSeat = (n: number) => ({ id: `computer-${n}`, name: `Computer ${n}` });

/**
 * The host starts the game: the clock starts now, and the computers play
 * out their games (`random` returns a number in [0, 1)). `words` are
 * server-picked secret words: in Rush with Friends, the 4 everyone solves;
 * in Competitive Rush, at least 5, from which each computer takes one that
 * no player set.
 */
export function startLobby(
  lobby: LobbyRecord, playerId: string, words: readonly string[], now: number, random: () => number,
): LobbyResult {
  const blocked = checkOpen(lobby, now);
  if (blocked) return { ok: false, error: blocked };
  if (lobbyHost(lobby).id !== playerId) return { ok: false, error: 'not-host' };
  const { computers, strength, difficulty } = lobby.settings;
  if (lobby.players.length + computers < 2) return { ok: false, error: 'need-players' };
  const durationMs = lobby.settings.minutes * 60_000;
  const competitive = lobbyKind(lobby) === 'competitive';
  // Two players with the same word would each find it at once. The host isn't told whose, nor what it is.
  // Testing words this way gets nowhere: a word nobody else set starts the game.
  const set = lobby.players.map((p) => p.word);
  if (competitive && new Set(set).size < set.length) return { ok: false, error: 'same-words' };
  let seats: LobbySeat[];
  if (competitive) {
    // A computer never sets a word a player set, which that player would solve at once.
    const taken = new Set(lobby.players.map((p) => p.word));
    const spare = words.filter((w) => !taken.has(w)).slice(0, computers);
    seats = [
      ...lobby.players.map((p) => ({ id: p.id, name: p.name, strength: null, word: p.word, moves: [] })),
      ...spare.map((word, i) => ({ ...computerSeat(i + 1), strength, word, moves: [] })),
    ];
  } else {
    seats = [
      ...lobby.players.map((p) => ({ id: p.id, name: p.name, strength: null, moves: [] })),
      ...Array.from({ length: computers }, (_, i) => ({ ...computerSeat(i + 1), strength, moves: [] })),
    ];
  }
  const secrets = competitive ? seats.map((s) => s.word) : words;
  if (secrets.length !== (competitive ? LOBBY_SEATS : LOBBY_WORDS) || secrets.some((w) => w === undefined)) {
    return { ok: false, error: competitive ? 'need-word' : 'no-words' };
  }
  const created = createRun(secrets as string[], now, { timeLimitMs: durationMs, difficulty });
  if (!created.ok) return created;
  // Everyone solves the same words, each in their own order.
  const slots = competitive ? LOBBY_SEATS - 1 : LOBBY_WORDS;
  seats = seats.map((s) => ({ ...s, order: shuffled([...Array(slots).keys()], random) }));
  let game: LobbyGame = { words: created.game.words, startedAt: now, durationMs, difficulty, seats };
  game = {
    ...game,
    seats: seats.map((s, i) => (s.strength === null ? s
      : { ...s, moves: computerMoves(seatWords(game, i), s.strength, now, durationMs, random) })),
  };
  return { ok: true, lobby: { ...lobby, game } };
}

/**
 * Which of the game's words each of a seat's words is, in the order it plays
 * them: an index into `game.words`. In Rush with Friends that's the 4
 * everyone solves; in Competitive Rush, the other seats' (which is also who
 * set it). The group penalty compares words by it.
 */
export function seatKeys(game: LobbyGame, index: number): number[] {
  const slots = competitiveGame(game) ? game.seats.map((_, j) => j).filter((j) => j !== index) : game.words.map((_, w) => w);
  const { order } = game.seats[index];
  return order ? order.map((k) => slots[k]) : slots;
}

/**
 * Which seat set each of a seat's words, in the order it plays them, in
 * Competitive Rush. Null in Rush with Friends, where the words are the server's.
 */
export function seatSetters(game: LobbyGame, index: number): number[] | null {
  return competitiveGame(game) ? seatKeys(game, index) : null;
}

/** The words a seat solves, in its own order: everyone's 4, or in Competitive Rush, the others' words. */
export function seatWords(game: LobbyGame, index: number): readonly string[] {
  return seatKeys(game, index).map((k) => game.words[k]);
}

function seatRecord(game: LobbyGame, index: number, now: number): RunRecord {
  return {
    words: seatWords(game, index), startedAt: game.startedAt, timeLimitMs: game.durationMs, pausable: false,
    difficulty: game.difficulty, moves: game.seats[index].moves.filter((m) => m.at <= now),
  };
}

function replaySeat(game: LobbyGame, index: number, now: number): RunGame {
  const replayed = replayRun(seatRecord(game, index, now));
  if (!replayed.ok) throw new Error(`${game.seats[index].id}'s run doesn't replay: ${replayed.error}`);
  return replayed.game;
}

/** A seat's run as it stands at `now`: once the time is up, every word not yet played is unsolved. */
export function seatRun(game: LobbyGame, index: number, now: number): RunGame {
  const run = replaySeat(game, index, now);
  const deadline = runDeadline(run)!;
  if (run.status === 'over' || now < deadline) return run;
  const ended = endRun(run, deadline);
  if (!ended.ok) throw new Error(`${game.seats[index].id}'s run doesn't end: ${ended.error}`);
  return ended.game;
}

export const seatIndex = (game: LobbyGame, playerId: string): number => game.seats.findIndex((s) => s.id === playerId);

export function lobbyState(lobby: LobbyRecord, now: number): LobbyState {
  const { game } = lobby;
  if (!game) return lobby.closed || now >= lobby.createdAt + OPEN_LOBBY_MS ? 'closed' : 'open';
  if (now >= game.startedAt + game.durationMs) return 'over';
  return game.seats.every((_, i) => seatRun(game, i, now).status === 'over') ? 'over' : 'playing';
}

/**
 * When the game ended: when the last player finished, or when the time ran
 * out. Null while it's still on.
 */
export function lobbyEndedAt(lobby: LobbyRecord, now: number): number | null {
  const { game } = lobby;
  if (!game || lobbyState(lobby, now) !== 'over') return null;
  const deadline = game.startedAt + game.durationMs;
  const finished = game.seats.map((_, i) => seatRun(game, i, now))
    .map((run) => Math.max(...run.results.map((r) => r.endedAt ?? run.startedAt)));
  return Math.min(deadline, Math.max(...finished));
}

/**
 * When a seat finishes if nobody stops it first: a computer's last move, if
 * it finds every word in time. Null for a seat that won't (or a person).
 */
function finishesAt(game: LobbyGame, index: number): number | null {
  const run = replaySeat(game, index, Infinity);
  return run.status === 'over' ? Math.max(...run.results.map((r) => r.endedAt ?? run.startedAt)) : null;
}

/**
 * When the lobby next needs waking to bring it up to date: a computer
 * finishing, or the time running out. Null once the game is over.
 */
export function lobbyWakeAt(lobby: LobbyRecord, now: number): number | null {
  const { game } = lobby;
  if (!game || lobbyState(lobby, now) !== 'playing') return null;
  const finishes = game.seats.map((s, i) => (s.strength === null ? null : finishesAt(game, i)))
    .filter((t): t is number => t !== null && t > now);
  return Math.min(game.startedAt + game.durationMs, ...finishes);
}

/**
 * A player's move on their own run: a guess, Easy's Suggest offering a word,
 * giving up the word being played, or giving up the rest.
 */
export type LobbyMove =
  | { kind: 'guess'; word: string } | { kind: 'suggest'; word: string } | { kind: 'give-up-word' } | { kind: 'give-up' };

export function playLobby(lobby: LobbyRecord, playerId: string, move: LobbyMove, now: number): LobbyResult {
  const { game } = lobby;
  if (!game) return { ok: false, error: lobby.closed ? 'lobby-closed' : 'not-started' };
  const index = seatIndex(game, playerId);
  if (index < 0) return { ok: false, error: 'not-in-lobby' };
  const run = replaySeat(game, index, now);
  const result = move.kind === 'guess' ? submitRunGuess(run, move.word, now)
    : move.kind === 'suggest' ? suggestRun(run, move.word, now)
    : move.kind === 'give-up-word' ? giveUpWord(run, now)
      : now > runDeadline(run)! ? { ok: false as const, error: 'time-up' as const } : endRun(run, now);
  if (!result.ok) return result;
  const moves = toRunRecord(result.game).moves;
  const seats = game.seats.map((s, i) => (i === index ? { ...s, moves } : s));
  return { ok: true, lobby: { ...lobby, game: { ...game, seats } } };
}

/**
 * One player's place in the standings (README "Scoring"): their words with
 * the group penalty, their score, and their rank. Never their guesses: those
 * would give the words away.
 */
export interface LobbyStanding {
  name: string;
  /** A computer player's strength; null for a person. */
  strength: Strength | null;
  you: boolean;
  /**
   * 1 for the best, tied players (same score and time) sharing a rank; null
   * while still playing. Provisional until the game is over, since a
   * penalty depends on how the others did.
   */
  rank: number | null;
  /** Every word has an outcome. */
  finished: boolean;
  /**
   * Each word: its outcome so far and the guesses used; once finished, what
   * it counts as (`counted`), with the group penalty for a word not found.
   */
  words: readonly { outcome: WordOutcome | null; guesses: number; counted: ScoredWord | null }[];
  /** Once finished: average guesses per word, penalties included, × the difficulty factor. Lower is better. */
  score: number | null;
  /** Once finished: total seconds, penalties included, which break ties. */
  seconds: number | null;
}

/**
 * The standings at `now`: finished players by score, then time; then those
 * still playing, by words found and fewest guesses. A word given up or not
 * found counts as that word's worst solved result in the group plus the
 * penalty (`penalized`); everyone's results so far count.
 */
export function lobbyStandings(game: LobbyGame, now: number, ids: readonly string[] = []): LobbyStanding[] {
  const runs = game.seats.map((_, i) => seatRun(game, i, now));
  const results = runs.map((run) => run.results.map(toWordResult));
  const done = (r: WordResult | null): r is WordResult => r !== null;
  const group = results.flat().filter(done);
  const factor = DIFFICULTY_FACTOR[game.difficulty];
  // Which word each result is, whatever order each seat played them in.
  const keys = runs.map((_, i) => seatKeys(game, i));
  const sameWord = (i: number, w: number) =>
    results.flatMap((p, j) => p.filter((_, k) => keys[j][k] === keys[i][w])).filter(done);
  const standings = runs.map((run, i): LobbyStanding => {
    const finished = run.status === 'over';
    const counted = results[i].map((r, w) => (finished && r ? penalized(r, sameWord(i, w), group) : null));
    const scored = counted.filter((c): c is ScoredWord => c !== null);
    return {
      name: game.seats[i].name,
      strength: game.seats[i].strength,
      you: ids.includes(game.seats[i].id),
      rank: null,
      finished,
      words: run.results.map((r, w) => ({ outcome: r.outcome, guesses: r.guesses.length, counted: counted[w] })),
      score: finished ? averageWord(scored).guesses * factor : null,
      seconds: finished ? totalSeconds(scored) : null,
    };
  });
  const found = (s: LobbyStanding) => s.words.filter((w) => w.outcome === 'solved').length;
  const guesses = (s: LobbyStanding) => s.words.reduce((sum, w) => sum + w.guesses, 0);
  const sorted = [...standings].sort((a, b) =>
    a.finished !== b.finished ? (a.finished ? -1 : 1)
      : a.finished ? a.score! - b.score! || a.seconds! - b.seconds!
        : found(b) - found(a) || guesses(a) - guesses(b));
  return sorted.map((s, i) => {
    if (!s.finished) return s;
    const tied = sorted.findIndex((o) => o.score === s.score && o.seconds === s.seconds);
    return { ...s, rank: Math.min(i, tied) + 1 };
  });
}

/** Your run as you may see it: a word only once you've found it, or the game is over. */
export interface LobbyRunView {
  current: number;
  status: 'playing' | 'over';
  words: readonly DailyWordView[];
  /** Competitive Rush: who set each of your words. Null in Rush with Friends. */
  setBy: readonly string[] | null;
}

/** A lobby as one player may see it. */
export interface LobbyView {
  code: string;
  kind: LobbyKind;
  state: LobbyState;
  hostName: string;
  /** You're the host. */
  host: boolean;
  /** You have a seat. */
  joined: boolean;
  /** Everyone seated, in order, computers last: before the game, those who've joined and the computers to come. */
  players: readonly { name: string; strength: Strength | null; you: boolean }[];
  settings: LobbySettings;
  /** When an open lobby closes if nobody starts it. */
  closesAt: number | null;
  startedAt: number | null;
  /** When the time is up. */
  endsAt: number | null;
  /** When the game ended, once it's over. */
  endedAt: number | null;
  /** Competitive Rush: the word you set, which the others solve. */
  yourWord: string | null;
  /** Your run, once the game has started, if you're in it. */
  run: LobbyRunView | null;
  /** The standings, once the game has started: final once it's over. */
  standings: readonly LobbyStanding[] | null;
  /** The words, once the game is over: in Competitive Rush, each seat's, in the order of `players`. */
  words: readonly string[] | null;
}

/** The lobby as the player with these IDs (their own, and their account's other guest IDs) may see it. */
export function lobbyView(lobby: LobbyRecord, ids: readonly string[], now: number): LobbyView {
  const { game } = lobby;
  const state = lobbyState(lobby, now);
  const over = state === 'over';
  const { computers, strength } = lobby.settings;
  const seated: readonly Pick<LobbySeat, 'id' | 'name' | 'strength'>[] = game ? game.seats : [
    ...lobby.players.map((p) => ({ ...p, strength: null })),
    ...Array.from({ length: computers }, (_, i) => ({ ...computerSeat(i + 1), strength })),
  ];
  const mine = (id: string) => ids.includes(id);
  const runs = game ? game.seats.map((_, i) => seatRun(game, i, now)) : null;
  const yourIndex = seated.findIndex((s) => mine(s.id));
  const yours = runs && yourIndex >= 0 ? runs[yourIndex] : null;
  const you = lobby.players.find((p) => mine(p.id));
  return {
    code: lobby.code,
    kind: lobbyKind(lobby),
    state,
    hostName: lobbyHost(lobby).name,
    host: mine(lobbyHost(lobby).id),
    joined: yourIndex >= 0,
    players: seated.map((s) => ({ name: s.name, strength: s.strength, you: mine(s.id) })),
    settings: lobby.settings,
    closesAt: state === 'open' ? lobby.createdAt + OPEN_LOBBY_MS : null,
    startedAt: game?.startedAt ?? null,
    endsAt: game && game.startedAt + game.durationMs,
    endedAt: lobbyEndedAt(lobby, now),
    yourWord: you?.word ?? null,
    run: yours && {
      current: yours.current,
      status: yours.status,
      words: yours.results.map((r) => ({
        word: r.outcome === 'solved' || over ? r.word : null,
        guesses: r.guesses,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        outcome: r.outcome,
        suggested: r.suggested,
        pausedMs: r.pausedMs,
      })),
      setBy: (game && seatSetters(game, yourIndex)?.map((j) => game.seats[j].name)) ?? null,
    },
    standings: game && lobbyStandings(game, now, ids),
    words: game && over ? game.words : null,
  };
}
