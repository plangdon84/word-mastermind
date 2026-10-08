import {
  closeLobby, configureLobby, createCompetitiveLobby, createLobby, HISTORY_VERSION, joinLobby, leaveLobby, lobbyEndedAt,
  lobbyKind, lobbyStandings, lobbyView, lobbyWakeAt, seatRun, pickRunWords, playLobby, SECRET_WORDS, setLobbyWord, startLobby, LOBBY_SEATS,
  LOBBY_WORDS, type Difficulty, type LobbyKind, type LobbyRecord, type LobbyResult, type LobbySettings, type RankBy,
} from '../../src/game';
import type { LobbyAnswer, LobbyErrorCode } from '../../src/app/lobbyApi';
import { showRating } from '../../src/app/ratingsApi';
import { lobbyFinishedNotice, lobbyOverNotice, type Notice } from './notices';
import { rateGroupGame, type RatingChange } from './ratings';
import type { RoomStorage } from './room';

/*
 * The referee for one Rush with Friends or Competitive Rush lobby, run by
 * its Durable Object (`rushLobby.ts`), named by the join code. It holds the words and every
 * seat's run, and answers each player with their own view only: the words
 * stay hidden until a player finds them, or the game is over. Like the game
 * logic, it never reads the clock: the time is passed in.
 */

/**
 * What the lobby's storage keeps: the record, whether its finished game is
 * in D1 yet (and everyone told), which seats' finishes have been announced,
 * when its alarm is set for, and once a rated game is over, each account's
 * rating change.
 */
export interface LobbyRoom {
  lobby: LobbyRecord;
  saved: boolean;
  announced: readonly string[];
  alarmAt: number | null;
  ratings?: Readonly<Record<string, RatingChange>>;
}

/** What the referee needs from outside the lobby. */
export interface LobbyDeps {
  /** Picks the words, and the computers' guesses: a number in [0, 1). */
  random(): number;
  /**
   * Keeps a finished game in D1's game history and, if it's rated, rates it
   * once: each account's change (the same ones if asked again), or null if
   * it isn't rated.
   */
  saveFinished(lobby: LobbyRecord, endedAt: number): Promise<Record<string, RatingChange> | null>;
  /**
   * Sends notifications (Web Push). It doesn't hold up the answer: the
   * Durable Object sends them after answering, and a failure never undoes a move.
   */
  notify(notices: readonly Notice[]): void;
}

/**
 * Who is asking: their player ID, and (signed in) their account's other
 * guest IDs. Competitive Rush is rated, so only an account can play it.
 */
interface Asker {
  playerId: string;
  aliases?: readonly string[];
  signedIn?: boolean;
}

export type LobbyRequest = Asker & (
  | { action: 'create'; code: string; name: string; difficulty: Difficulty; kind?: LobbyKind; word?: string; rankBy?: RankBy }
  | { action: 'get' }
  | { action: 'join'; name: string; word?: string }
  | { action: 'word'; word: string }
  | { action: 'leave' }
  | { action: 'close' }
  | { action: 'settings'; settings: LobbySettings }
  | { action: 'start' }
  | { action: 'guess'; word: string }
  /** Easy's Suggest offered `word` (README "Easy"). */
  | { action: 'suggest'; word: string }
  | { action: 'give-up-word' }
  | { action: 'give-up' });

export type LobbyResponse = { status: number; body: LobbyAnswer | { error: LobbyErrorCode } };

const ROOM_KEY = 'lobby';

const refuse = (status: number, error: LobbyErrorCode): LobbyResponse => ({ status, body: { error } });

const STATUS: Partial<Record<LobbyErrorCode, number>> = {
  'account-needed': 401, 'not-host': 403, 'not-in-lobby': 403,
  'lobby-full': 409, 'already-started': 409, 'same-words': 409, 'lobby-closed': 409, 'not-started': 409, 'need-players': 409,
  'game-over': 409, 'time-up': 409,
};

/** All the IDs the asker may hold a seat under. */
const idsOf = (asker: Asker): readonly string[] => [asker.playerId, ...(asker.aliases ?? [])];

/** The ID the asker sits under, or their player ID if they haven't joined. */
function seatedAs(lobby: LobbyRecord, asker: Asker): string {
  const seated = lobby.game ? lobby.game.seats : lobby.players;
  return idsOf(asker).find((id) => seated.some((s) => s.id === id)) ?? asker.playerId;
}

function answer(room: LobbyRoom, asker: Asker, now: number, status = 200): LobbyResponse {
  const change = room.ratings?.[seatedAs(room.lobby, asker)];
  const rating = change ? { ...showRating(change.before), after: showRating(change.after) } : null;
  return { status, body: { lobby: lobbyView(room.lobby, idsOf(asker), now), now, rating } };
}

/**
 * Brings the lobby up to `now`: a player who has finished is announced to
 * the others, and once the game is over, it's saved to D1 and everyone
 * hears their final place. The alarm wakes the lobby when a computer
 * finishes or the time runs out, so this happens even with nobody looking;
 * every request checks too.
 */
async function settle(storage: RoomStorage, deps: LobbyDeps, room: LobbyRoom, now: number): Promise<LobbyRoom> {
  let next = room;
  const wakeAt = lobbyWakeAt(room.lobby, now);
  // Polling players ask every few seconds: only a new time is written.
  if (wakeAt !== null && wakeAt !== room.alarmAt) {
    await storage.setAlarm(wakeAt);
    next = { ...next, alarmAt: wakeAt };
  }
  const { game } = room.lobby;
  const endedAt = lobbyEndedAt(room.lobby, now);
  if (game && endedAt !== null && !room.saved) {
    const ratings = await deps.saveFinished(room.lobby, endedAt);
    await storage.deleteAlarm();
    deps.notify(lobbyOverNotice(room.lobby, now));
    next = { ...next, saved: true, alarmAt: null, announced: game.seats.map((s) => s.id), ...(ratings ? { ratings } : {}) };
  } else if (game && endedAt === null) {
    const finished = game.seats.filter((s, i) => !room.announced.includes(s.id) && seatRun(game, i, now).status === 'over');
    for (const seat of finished) deps.notify(lobbyFinishedNotice(room.lobby, seat.id, now));
    if (finished.length > 0) next = { ...next, announced: [...room.announced, ...finished.map((s) => s.id)] };
  }
  if (next !== room) await storage.put(ROOM_KEY, next);
  return next;
}

/** Saves a change to the lobby, then brings it up to date. */
async function save(storage: RoomStorage, deps: LobbyDeps, room: LobbyRoom, now: number): Promise<LobbyRoom> {
  await storage.put(ROOM_KEY, room);
  return settle(storage, deps, room, now);
}

/** The lobby's alarm: a computer may have finished, or the time may be up. */
export async function handleLobbyAlarm(storage: RoomStorage, deps: LobbyDeps, now: number): Promise<void> {
  const room = await storage.get<LobbyRoom>(ROOM_KEY);
  if (room) await settle(storage, deps, room, now);
}

/** Handles one request to the lobby. */
export async function handleLobby(
  storage: RoomStorage, deps: LobbyDeps, request: LobbyRequest, now: number,
): Promise<LobbyResponse> {
  const stored = await storage.get<LobbyRoom>(ROOM_KEY);

  if (request.action === 'create') {
    // Codes are random; the worker picks another if this one is taken.
    if (stored) return refuse(409, 'code-taken');
    const host = { id: request.playerId, name: request.name };
    let lobby: LobbyRecord;
    if (request.kind === 'competitive') {
      if (!request.signedIn) return refuse(401, 'account-needed');
      const created = createCompetitiveLobby(request.code, { ...host, word: request.word }, request.difficulty, now, request.rankBy);
      // Only the word can be refused: missing, or not a valid secret word.
      if (!created.ok) return refuse(400, created.error as LobbyErrorCode);
      lobby = created.lobby;
    } else {
      lobby = createLobby(request.code, host, request.difficulty, now, request.rankBy);
    }
    const room: LobbyRoom = { lobby, saved: false, announced: [], alarmAt: null };
    await storage.put(ROOM_KEY, room);
    return answer(room, request, now, 201);
  }

  if (!stored) return refuse(404, 'not-found');
  const room = await settle(storage, deps, stored, now);
  if (request.action === 'get') return answer(room, request, now);

  const { lobby } = room;
  const id = seatedAs(lobby, request);
  let result: LobbyResult;
  switch (request.action) {
    case 'join':
      if (lobbyKind(lobby) === 'competitive' && !request.signedIn) return refuse(401, 'account-needed');
      result = joinLobby(lobby, { id, name: request.name, word: request.word }, now);
      break;
    case 'word': result = setLobbyWord(lobby, id, request.word, now); break;
    case 'leave': result = leaveLobby(lobby, id, now); break;
    case 'close': result = closeLobby(lobby, id, now); break;
    case 'settings': result = configureLobby(lobby, id, request.settings, now); break;
    case 'start':
      // Competitive Rush: a word for each computer, none of them a player's.
      result = startLobby(lobby, id, pickRunWords(SECRET_WORDS, lobbyKind(lobby) === 'competitive' ? LOBBY_SEATS : LOBBY_WORDS,
        deps.random), now, deps.random);
      break;
    case 'guess': result = playLobby(lobby, id, { kind: 'guess', word: request.word }, now); break;
    case 'suggest': result = playLobby(lobby, id, { kind: 'suggest', word: request.word }, now); break;
    case 'give-up-word': result = playLobby(lobby, id, { kind: 'give-up-word' }, now); break;
    case 'give-up': result = playLobby(lobby, id, { kind: 'give-up' }, now); break;
  }
  if (!result.ok) {
    if (result.error === 'paused' || result.error === 'not-paused' || result.error === 'not-pausable'
      || result.error === 'no-words') {
      throw new Error(`A lobby refused a move: ${result.error}`);
    }
    return refuse(STATUS[result.error] ?? 400, result.error);
  }
  const next = await save(storage, deps, { ...room, lobby: result.lobby }, now);
  return answer(next, request, now);
}

/**
 * Saves a finished game to D1: its record, and a row per player for their
 * history. A Competitive Rush with at least two people is rated (README
 * "Rating") once: each pair of people by their final places, computers left
 * out. Saving it again returns the same changes, so they're never lost.
 */
export async function saveFinishedLobby(
  db: D1Database, lobby: LobbyRecord, endedAt: number, historyVersion = HISTORY_VERSION,
): Promise<Record<string, RatingChange> | null> {
  const { game } = lobby;
  if (!game) return null;
  const gameId = `lobby:${lobby.code}:${game.startedAt}`;
  await db.prepare(
    `INSERT OR IGNORE INTO games (id, mode, version, record, started_at, finished_at) VALUES (?1, 'lobby', ?2, ?3, ?4, ?5)`,
  ).bind(gameId, historyVersion, JSON.stringify(lobby), game.startedAt, endedAt).run();
  for (const player of lobby.players) {
    await db.prepare('INSERT OR IGNORE INTO game_players (game_id, guest_id) VALUES (?1, ?2)').bind(gameId, player.id).run();
  }
  const people = game.seats.filter((s) => s.strength === null);
  if (lobbyKind(lobby) !== 'competitive' || people.length < 2) return null;
  const places = people.map((p) => ({
    accountId: p.id, place: lobbyStandings(game, endedAt, [p.id]).find((s) => s.you)!.rank!,
  }));
  return rateGroupGame(db, gameId, 'rush', places, endedAt);
}
