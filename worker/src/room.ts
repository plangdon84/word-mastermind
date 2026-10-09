import {
  concedePvp, createPvpGame, otherSeat, isRatedDifficulty, HISTORY_VERSION, hostScore, pickFirstSeat, ratingPool, pvpDeadline, pvpView, replayPvp, setPvpDifficulty,
  isLive, submitPvpGuess, suggestPvp, timeOutPvp, toPvpRecord, validateSecretWord, type Difficulty, type PvpGame, type PvpRecord, type Seat,
  type Marks, type Rating, type TimeControl, type TurnDays,
} from '../../src/game';
import type { FriendError, FriendGame, RatingLine } from '../../src/app/friendApi';
import { showRating } from '../../src/app/ratingsApi';
import { declinedNotice, expiredNotice, joinedNotice, moveNotices, type Notice } from './notices';
import { rateFinishedGame, type RatingChange } from './ratings';

/*
 * The referee for one game against a friend, run by the game's Durable
 * Object (`gameRoom.ts`). It holds both secret words and answers each player
 * with their own side of the game only. Like the game logic, it never reads
 * the clock: the time is passed in.
 */

export interface Player {
  guestId: string;
  name: string;
}

/** Everything the referee keeps: the game is its record, replayed on each request. */
export interface Room {
  id: string;
  createdAt: number;
  /** How the game is timed; rooms made before live games have `turnDays` instead. */
  timeControl?: TimeControl;
  turnDays?: TurnDays;
  host: Player & { secret: string; difficulty: Difficulty };
  /** Null until someone accepts the invite. */
  guest: Player | null;
  /** A challenge to a friend: only this player (their account's ID) may accept it. */
  invitee?: Player | null;
  /** Null until the game starts. */
  record: PvpRecord | null;
  /** The host withdrew the invite before anyone accepted it. */
  cancelled: boolean;
  /** Nobody accepted the invite in time (`INVITE_MS`). */
  expired?: boolean;
  /** The invitee turned the challenge down. */
  declined?: boolean;
  /** A rematch of this game (README "Rematch"): its room's ID, and which seat asked for it. */
  rematch?: { id: string; by: Seat };
  /** This room is a rematch of that game. */
  rematchOf?: string;
  /** A rematch: the difficulty the invitee plays at, the one they ended the last game on. */
  inviteeDifficulty?: Difficulty;
  /** A rated game (README "Rating"): both players are accounts, and difficulty is fixed. */
  rated?: boolean;
  /** Started by the matchmaking queue (`queue.ts`), not an invite. */
  matched?: boolean;
  /**
   * A rated game's ratings when it started, and once it's over, the ones it
   * was rated from (other rated games may have finished meanwhile) and after
   * it. Rooms rated before `ratingsBefore` was kept have only `ratingsAfter`.
   */
  ratings?: Record<Seat, Rating>;
  ratingsBefore?: Record<Seat, Rating>;
  ratingsAfter?: Record<Seat, Rating>;
}

/** How long an invite link works for, from when it's sent. */
export const INVITE_MS = 24 * 60 * 60 * 1000;
/** A live game's invite: the host is waiting to play now, so it's shorter. */
export const LIVE_INVITE_MS = 60 * 60 * 1000;

export const roomTimeControl = (room: Room): TimeControl => room.timeControl ?? `${room.turnDays ?? 1}d`;

/** When the room's invite stops working. */
export const inviteEnds = (room: Room) => room.createdAt + (isLive(roomTimeControl(room)) ? LIVE_INVITE_MS : INVITE_MS);

/** An invite still waiting for someone to accept it. */
const isOpenInvite = (room: Room) => !room.record && !room.cancelled && !room.expired && !room.declined;

/** The Durable Object's storage, or a stand-in in tests. */
export interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  /** Wakes the room (`handleAlarm`) at this time; there is one alarm per room. */
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

/** What the referee needs from outside the room. */
export interface RoomDeps {
  /**
   * Keeps a finished game in D1's game history and, if it's rated, rates it
   * once: each seat's change, or null if it isn't rated or was already saved.
   */
  saveFinished(room: Room, record: PvpRecord, now: number): Promise<Record<Seat, RatingChange> | null>;
  /**
   * The names the players go by now, by player ID (`currentNames` in
   * `sync.ts`): an ID without an account profile is left out, and keeps the
   * name it played under.
   */
  namesOf(ids: readonly string[]): Promise<Record<string, string>>;
  /** Which of these player IDs are friends of the account `accountId`: their friend codes, by ID (`friendCodes`). */
  friendCodes(accountId: string, ids: readonly string[]): Promise<Record<string, string>>;
  /** Both players' ratings as a rated game starts. */
  ratingsOf(players: Record<Seat, string>, control: TimeControl, now: number): Promise<Record<Seat, Rating>>;
  /** Picks who goes first: a number in [0, 1). */
  random(): number;
  /**
   * Sends turn notifications. It doesn't hold up the answer: the Durable
   * Object sends them after answering, and a failure never undoes a move.
   */
  notify(notices: readonly Notice[]): void;
}

/**
 * Who is asking: `guestId` is the player's ID (their account's, once signed
 * in), which a new seat takes. `aliases` are the account's other guest IDs,
 * so a seat taken on another device before signing in is still theirs.
 */
interface Asker {
  guestId: string;
  aliases?: readonly string[];
}

export type RoomRequest =
  | {
    action: 'create'; id: string; guestId: string; name: string; secret: string; difficulty: Difficulty; timeControl: TimeControl;
    invitee?: Player | null; rated?: boolean; matched?: boolean; rematchOf?: string; inviteeDifficulty?: Difficulty;
  }
  | Asker & (
    | { action: 'get' }
    | { action: 'join'; name: string; secret: string; difficulty: Difficulty }
    | { action: 'guess'; word: string; marks?: Marks }
    | { action: 'suggest'; word: string }
    | { action: 'concede' }
    | { action: 'decline' }
    /**
     * Asked twice: first to plan a rematch (`record` false), then, once its
     * room is made, to record it (`record` true), so a rematch is never
     * recorded before it exists. `replacing` is an earlier rematch that was
     * declined or expired, which a new one may replace.
     */
    | { action: 'rematch'; newId: string; record: boolean; replacing?: string }
    | { action: 'difficulty'; difficulty: Difficulty });

/**
 * The old room's answer to `rematch`: a new rematch to create (the other
 * player, as the invitee, with this game's settings) or, once recorded, the
 * one created; or the one already recorded, and whether you asked for it.
 */
export type RematchPlan =
  | {
    kind: 'new'; id: string; invitee: Player; timeControl: TimeControl; rated: boolean;
    /** Each side's difficulty as the last game ended. */
    difficulty: Difficulty; inviteeDifficulty: Difficulty;
  }
  | { kind: 'existing'; id: string; byYou: boolean };

export type RoomResponse = { status: number; body: FriendGame | RematchPlan | { error: FriendError } };

/** Whether a request can change the game, so the room tells open pages (its WebSockets) to look again. */
export const mayChange = (request: RoomRequest) => request.action !== 'get';

const ROOM_KEY = 'room';

const refuse = (status: number, error: FriendError): RoomResponse => ({ status, body: { error } });

/** All the IDs a request may hold a seat under. */
const idsOf = (asker: Asker): readonly string[] => [asker.guestId, ...(asker.aliases ?? [])];

function seatOf(room: Room, ids: readonly string[]): Seat | null {
  if (ids.includes(room.host.guestId)) return 'host';
  if (room.guest && ids.includes(room.guest.guestId)) return 'guest';
  return null;
}

function gameOf(room: Room): PvpGame | null {
  if (!room.record) return null;
  const replayed = replayPvp(room.record);
  if (!replayed.ok) throw new Error(`Room ${room.id} doesn't replay: ${replayed.error}`);
  return replayed.game;
}

/**
 * A rated game's ratings from one side, once it has started: as it began
 * and, once over, this game's own change (from the ratings it was rated
 * from, so other games finishing meanwhile don't show as this one's).
 */
function ratingLines(room: Room, seat: Seat | null): FriendGame['ratings'] {
  if (!room.ratings || !seat) return null;
  const from = (room.ratingsAfter && room.ratingsBefore) ?? room.ratings;
  const line = (s: Seat): RatingLine => ({
    ...showRating(from[s]), after: room.ratingsAfter ? showRating(room.ratingsAfter[s]) : null,
  });
  return { you: line(seat), opponent: line(seat === 'host' ? 'guest' : 'host') };
}

/** The room as the player with these IDs may see it, at `now` by the server's clock. */
export function describeRoom(room: Room, ids: readonly string[], now: number): FriendGame {
  const seat = seatOf(room, ids);
  const game = gameOf(room);
  const state = room.cancelled ? 'cancelled' : room.expired ? 'expired' : room.declined ? 'declined'
    : !game ? 'waiting' : game.status === 'over' ? 'over' : 'playing';
  return {
    id: room.id,
    seat,
    state,
    hostName: room.host.name,
    guestName: room.guest?.name ?? null,
    opponentCode: null,
    inviteeName: room.invitee?.name ?? null,
    invitedYou: !seat && isOpenInvite(room) && !!room.invitee && ids.includes(room.invitee.guestId),
    inviteeDifficulty: room.inviteeDifficulty ?? null,
    rematchOf: room.rematchOf ?? null,
    rematch: room.rematch && seat ? { id: room.rematch.id, byYou: room.rematch.by === seat } : null,
    timeControl: roomTimeControl(room),
    createdAt: room.createdAt,
    expiresAt: isOpenInvite(room) ? inviteEnds(room) : null,
    serverNow: now,
    rated: room.rated === true,
    matched: room.matched === true,
    ratings: ratingLines(room, seat),
    view: game && seat ? pvpView(game, seat) : null,
  };
}

/**
 * Saves the room after a change, sets the alarm for the next deadline (or
 * clears it once the game is over), and keeps a finished game in D1, rating
 * it if it's rated. Returns the room as saved.
 */
async function save(storage: RoomStorage, deps: RoomDeps, room: Room, now: number): Promise<Room> {
  await storage.put(ROOM_KEY, room);
  const game = gameOf(room);
  const deadline = game && pvpDeadline(game);
  if (deadline) await storage.setAlarm(deadline);
  else await storage.deleteAlarm();
  if (game?.status !== 'over' || !room.record) return room;
  const changes = await deps.saveFinished(room, room.record, now);
  if (!changes) return room;
  const rated: Room = {
    ...room,
    ratingsBefore: { host: changes.host.before, guest: changes.guest.before },
    ratingsAfter: { host: changes.host.after, guest: changes.guest.after },
  };
  await storage.put(ROOM_KEY, rated);
  return rated;
}

/**
 * If the player to move has run out of time, they concede. The alarm does
 * this at the deadline; every request checks too, in case the alarm is late.
 */
async function settle(storage: RoomStorage, deps: RoomDeps, room: Room, now: number): Promise<Room> {
  if (isOpenInvite(room)) {
    if (now < inviteEnds(room)) return room;
    const expired = { ...room, expired: true };
    await storage.put(ROOM_KEY, expired);
    deps.notify(expiredNotice(expired));
    return expired;
  }
  const game = gameOf(room);
  const deadline = game && pvpDeadline(game);
  if (!game || deadline === null || now < deadline) return room;
  const result = timeOutPvp(game, now);
  if (!result.ok) return room;
  const settled = await save(storage, deps, { ...room, record: toPvpRecord(result.game) }, now);
  deps.notify(moveNotices(settled, result.game));
  return settled;
}

/** The room's alarm: a player's time may have run out. */
export async function handleAlarm(storage: RoomStorage, deps: RoomDeps, now: number): Promise<void> {
  const room = await storage.get<Room>(ROOM_KEY);
  if (room) await settle(storage, deps, room, now);
}

/** Handles one request to the room. */
export async function handleRoom(
  storage: RoomStorage, deps: RoomDeps, request: RoomRequest, now: number,
): Promise<RoomResponse> {
  const answer = await answerRoom(storage, deps, request, now);
  return { ...answer, body: await withCurrentNames(storage, deps, answer.body, request.guestId) };
}

/**
 * A game as the server describes it, by each player's current name (issue
 * #133): a guest who signed in, or a player who renamed their profile,
 * shows by the new name. The room keeps the names they played under, for
 * anyone without an account profile and if the lookup fails.
 */
async function withCurrentNames(
  storage: RoomStorage, deps: RoomDeps, body: RoomResponse['body'], askerId: string,
): Promise<RoomResponse['body']> {
  if (!('hostName' in body)) return body;
  const room = await storage.get<Room>(ROOM_KEY);
  if (!room || room.id !== body.id) return body;
  const players = [room.host, room.guest, room.invitee].filter((p): p is Player => !!p);
  // Your opponent's name opens their profile when they're your friend (Dev Plan item 18ca): your ID is your
  // account's once signed in, and a guest has no friends. Looked up alongside the names.
  const opponent = body.seat === 'host' ? room.guest : body.seat === 'guest' ? room.host : null;
  const none = {} as Record<string, string>;
  const [names, codes] = await Promise.all([
    deps.namesOf(players.map((p) => p.guestId)).catch(() => none),
    opponent ? deps.friendCodes(askerId, [opponent.guestId]).catch(() => none) : none,
  ]);
  const nameOf = (player: Player | null | undefined, fallback: string | null) => (player && names[player.guestId]) ?? fallback;
  return {
    ...body,
    hostName: nameOf(room.host, body.hostName)!,
    guestName: nameOf(room.guest, body.guestName),
    opponentCode: opponent ? codes[opponent.guestId] ?? null : null,
    inviteeName: nameOf(room.invitee, body.inviteeName),
  };
}

async function answerRoom(
  storage: RoomStorage, deps: RoomDeps, request: RoomRequest, now: number,
): Promise<RoomResponse> {
  const stored = await storage.get<Room>(ROOM_KEY);

  if (request.action === 'create') {
    if (stored) return refuse(409, 'bad-request');
    if (request.rated && request.invitee && !isRatedDifficulty(request.difficulty)) return refuse(400, 'easy-unrated');
    const secret = validateSecretWord(request.secret);
    if (!secret.ok) return refuse(400, secret.error);
    const room: Room = {
      id: request.id,
      createdAt: now,
      timeControl: request.timeControl,
      host: { guestId: request.guestId, name: request.name, secret: secret.word, difficulty: request.difficulty },
      guest: null,
      invitee: request.invitee ?? null,
      record: null,
      cancelled: false,
      // Only a challenge to one friend (both accounts) can be rated.
      ...(request.rated && request.invitee ? { rated: true } : {}),
      ...(request.matched ? { matched: true } : {}),
      ...(request.rematchOf ? { rematchOf: request.rematchOf } : {}),
      ...(request.inviteeDifficulty ? { inviteeDifficulty: request.inviteeDifficulty } : {}),
    };
    await storage.put(ROOM_KEY, room);
    await storage.setAlarm(inviteEnds(room));
    return { status: 201, body: describeRoom(room, [request.guestId], now) };
  }

  if (!stored) return refuse(404, 'not-found');
  const room = await settle(storage, deps, stored, now);
  const ids = idsOf(request);
  if (request.action === 'get') return { status: 200, body: describeRoom(room, ids, now) };

  if (request.action === 'join') {
    if (ids.includes(room.host.guestId)) return refuse(409, 'own-invite');
    if (room.guest) return ids.includes(room.guest.guestId)
      ? { status: 200, body: describeRoom(room, ids, now) }
      : refuse(409, 'invite-taken');
    if (room.cancelled || room.declined) return refuse(409, 'invite-closed');
    if (room.expired) return refuse(409, 'invite-expired');
    if (room.invitee && !ids.includes(room.invitee.guestId)) return refuse(403, 'not-invited');
    // A rematch keeps the invitee's difficulty from the last game.
    const guestDifficulty = room.inviteeDifficulty ?? request.difficulty;
    const created = createPvpGame(
      { host: room.host.secret, guest: request.secret }, pickFirstSeat(deps.random), now, roomTimeControl(room),
      { host: room.host.difficulty, guest: guestDifficulty }, room.rated === true,
    );
    if (!created.ok) return refuse(400, created.error);
    const ratings = room.rated
      ? await deps.ratingsOf({ host: room.host.guestId, guest: request.guestId }, roomTimeControl(room), now) : undefined;
    const joined: Room = {
      ...room, guest: { guestId: request.guestId, name: request.name }, record: toPvpRecord(created.game),
      ...(ratings ? { ratings } : {}),
    };
    await save(storage, deps, joined, now);
    deps.notify(joinedNotice(joined, created.game));
    return { status: 200, body: describeRoom(joined, ids, now) };
  }

  if (request.action === 'decline') {
    // Only the friend a challenge is for can turn it down, while it's open.
    if (!room.invitee || !ids.includes(room.invitee.guestId) || seatOf(room, ids)) return refuse(403, 'not-invited');
    if (!isOpenInvite(room)) return refuse(409, room.expired ? 'invite-expired' : 'invite-closed');
    const declined = { ...room, declined: true };
    await storage.put(ROOM_KEY, declined);
    await storage.deleteAlarm();
    deps.notify(declinedNotice(declined));
    return { status: 200, body: describeRoom(declined, ids, now) };
  }

  const seat = seatOf(room, ids);
  if (!seat) return refuse(403, 'not-a-player');
  const game = gameOf(room);

  if (request.action === 'rematch') {
    // One open rematch per game, once it's over: whoever asks second is answered with the first.
    if (game?.status !== 'over' || !room.guest) return refuse(409, 'not-over');
    if (room.matched) return refuse(409, 'bad-request');
    if (room.rematch && room.rematch.id !== request.replacing) {
      return { status: 200, body: { kind: 'existing', id: room.rematch.id, byYou: room.rematch.by === seat } };
    }
    const other = seat === 'host' ? room.guest : room.host;
    if (request.record) await storage.put(ROOM_KEY, { ...room, rematch: { id: request.newId, by: seat } });
    return {
      status: 200,
      body: {
        kind: 'new', id: request.newId, invitee: { guestId: other.guestId, name: other.name },
        timeControl: roomTimeControl(room), rated: room.rated === true,
        difficulty: game.playingDifficulty[seat], inviteeDifficulty: game.playingDifficulty[otherSeat(seat)],
      },
    };
  }

  if (!game) {
    // Before anyone accepts, the host can withdraw the invite.
    if (request.action !== 'concede' || seat !== 'host' || !isOpenInvite(room)) {
      return refuse(409, room.cancelled || room.declined ? 'invite-closed' : room.expired ? 'invite-expired' : 'not-started');
    }
    const cancelled = { ...room, cancelled: true };
    await storage.put(ROOM_KEY, cancelled);
    await storage.deleteAlarm();
    return { status: 200, body: describeRoom(cancelled, ids, now) };
  }

  const result = request.action === 'guess' ? submitPvpGuess(game, seat, request.word, now, request.marks)
    : request.action === 'suggest' ? suggestPvp(game, seat, request.word, now)
    : request.action === 'concede' ? concedePvp(game, seat, now)
      : setPvpDifficulty(game, seat, request.difficulty, now);
  if (!result.ok) {
    const conflict = result.error === 'game-over' || result.error === 'not-your-turn' || result.error === 'time-up';
    return refuse(conflict ? 409 : 400, result.error);
  }
  const next = await save(storage, deps, { ...room, record: toPvpRecord(result.game) }, now);
  deps.notify(moveNotices(next, result.game));
  return { status: 200, body: describeRoom(next, ids, now) };
}

/**
 * Saves a finished game to D1: its record, and a row per player for their
 * history; and rates it if it's rated, the first time it's saved only.
 */
export async function saveFinishedGame(db: D1Database, room: Room, record: PvpRecord, now: number): Promise<Record<Seat, RatingChange> | null> {
  if (!room.guest) return null;
  const { meta } = await db.prepare(
    `INSERT OR IGNORE INTO games (id, mode, version, record, started_at, finished_at) VALUES (?1, 'friend', ?2, ?3, ?4, ?5)`,
  ).bind(room.id, HISTORY_VERSION, JSON.stringify(record), record.startedAt, now).run();
  for (const guestId of [room.host.guestId, room.guest.guestId]) {
    await db.prepare('INSERT OR IGNORE INTO game_players (game_id, guest_id) VALUES (?1, ?2)').bind(room.id, guestId).run();
  }
  const game = gameOf(room);
  if (!room.rated || meta.changes === 0 || !game?.outcome) return null;
  return rateFinishedGame(db, room.id, ratingPool(roomTimeControl(room)), {
    host: room.host.guestId, guest: room.guest.guestId,
  }, hostScore(game.outcome), now);
}
