import {
  concedePvp, createPvpGame, isRatedDifficulty, HISTORY_VERSION, hostScore, pickFirstSeat, TWO_PLAYER_POOL, pvpDeadline, pvpView, replayPvp, setPvpDifficulty,
  cancelPvp, isLive, pvpTimeLowAt, submitPvpGuess, suggestPvp, timeOutPvp, toPvpRecord, validateSecretWord, type Difficulty, type PvpGame, type PvpRecord, type Seat,
  type Marks, type Rating, type TimeControl, type TurnDays, computerRating, LADDER_COMPUTER_NAME, planComputerGuesses, pvpTurn, pvpTurnStart,
  ratedComputer, SECRET_WORDS, type PlannedGuess,
} from '../../src/game';
import type { FriendError, FriendGame, LadderFriend, RatingLine } from '../../src/app/friendApi';
import { showRating } from '../../src/app/ratingsApi';
import { markFinished, SAVE_RETRY_MS, saveMarked, type FinishedSave } from './finishSave';
import { shownName } from './names';
import { declinedNotice, expiredNotice, joinedNotice, moveNotices, timeLowNotice, type Notice } from './notices';
import { batchRated, computerGameChanges, ratedGameChanges, ratingStatements, seatChanges, type RatingChange } from './ratings';

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
  /** A rated game (README "Rating"): both players are accounts, and difficulty is fixed. */
  rated?: boolean;
  /** Started by the matchmaking queue (`queue.ts`), not an invite. */
  matched?: boolean;
  /**
   * A ladder game against a computer (Dev Plan item 19p), in the guest's
   * seat: its recall, and every guess it will make with the pause before
   * each, worked out when the game starts (`planComputerGuesses`). The room
   * plays each on the computer's turn (`playComputer`).
   */
  computer?: { recall: number; rating: number; plan: PlannedGuess[] };
  /**
   * A rated game's ratings when it started, and once it's over, the ones it
   * was rated from (other rated games may have finished meanwhile) and after
   * it. Rooms rated before `ratingsBefore` was kept have only `ratingsAfter`.
   */
  ratings?: Record<Seat, Rating>;
  ratingsBefore?: Record<Seat, Rating>;
  ratingsAfter?: Record<Seat, Rating>;
  /**
   * A finished game not yet in D1's history (Dev Plan item 19m): saving it
   * failed, so the alarm and the next request try again. Stored as soon as
   * the game ends, before saving, so a request meanwhile finds it over.
   */
  unsaved?: boolean;
  /**
   * The deadline whose player was reminded their time is running out
   * (README "Reminders"), so each turn reminds once.
   */
  timeLowFor?: number;
}

/** A ladder computer's player ID: never a guest ID a device could make (`isGuestId`), so nobody can take its seat. */
export const COMPUTER_ID = 'computer';

/** Sends notices to people only: a ladder computer (`COMPUTER_ID`) has no devices to tell. */
const notify = (deps: RoomDeps, notices: readonly Notice[]) => deps.notify(notices.filter((n) => n.guestId !== COMPUTER_ID));

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
   * Tells the queue that started this game (`matched`) that it's over, so it
   * stops counting it in play (Dev Plan item 19w). Sent after the answer;
   * a lost notice only leaves it counted until `PLAYING_KEEP_MS`.
   */
  ladderEnded(gameId: string): void;
  /**
   * The names the players go by now, by player ID (`currentNames` in
   * `sync.ts`): an ID without an account profile is left out, and keeps the
   * name it played under.
   */
  namesOf(ids: readonly string[]): Promise<Record<string, string>>;
  /** Which of these player IDs are friends of the account `accountId`: their friend codes, by ID (`friendCodes`). */
  friendCodes(accountId: string, ids: readonly string[]): Promise<Record<string, string>>;
  /**
   * Where the account `accountId` stands with player `playerId` as their
   * friends list shows it (`friendStateOf`): a request sent by email, still
   * off the list, is none (Dev Plan item 19e).
   */
  friendStateOf(accountId: string, playerId: string): Promise<LadderFriend>;
  /** Both players' ratings as a rated game starts. */
  ratingsOf(players: Record<Seat, string>, now: number): Promise<Record<Seat, Rating>>;
  /** Picks who goes first: a number in [0, 1). */
  random(): number;
  /**
   * Sends turn notifications. It doesn't hold up the answer: the Durable
   * Object sends them after answering, and a failure never undoes a move.
   */
  notify(notices: readonly Notice[]): void;
  /** Notes that a player made a move, so they aren't reminded to come back (README "Reminders"). */
  played(playerId: string, now: number): Promise<void>;
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
    invitee?: Player | null; rated?: boolean; matched?: boolean; rematchOf?: string;
  }
  /**
   * A ladder game against a computer at `recall` (Dev Plan item 19p),
   * started at once by the queue: the player is the host, rated `rating`
   * going in.
   */
  | {
    action: 'computer'; id: string; guestId: string; name: string; secret: string; difficulty: Difficulty; timeControl: TimeControl;
    recall: number; rating: Rating;
  }
  /**
   * From the queue (Dev Plan item 19za): the ladder computer game it made
   * for a player who cancelled meanwhile. Cancelled at once, no winner,
   * history or rating, unless the player has already guessed.
   */
  | { action: 'abandon' }
  | Asker & (
    /** `tell`: open pages look again too, after a friend request from the game (Dev Plan item 19e). */
    | { action: 'get'; tell?: boolean }
    /**
     * Who a finished ladder game's other person is (Dev Plan item 19e), for
     * a friend request from the game: never during the game, nor against a
     * computer, and only to a player in it.
     */
    | { action: 'opponent' }
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
    | { action: 'rematch'; newId: string; record: boolean; replacing?: string; difficulty?: Difficulty }
    | { action: 'difficulty'; difficulty: Difficulty });

/**
 * The old room's answer to `rematch`: a new rematch to create (the other
 * player, as the invitee, with this game's settings) or, once recorded, the
 * one created; or the one already recorded, and whether you asked for it.
 * Either way, `difficulty` is the one you play it at (`rematchDifficulty`).
 */
export type RematchPlan =
  | { kind: 'new'; id: string; invitee: Player; timeControl: TimeControl; rated: boolean; difficulty: Difficulty }
  | { kind: 'existing'; id: string; byYou: boolean; difficulty: Difficulty };

export type RoomResponse = {
  status: number; body: FriendGame | RematchPlan | { opponentId: string } | { error: FriendError };
};

/** Whether a request can change the game, so the room tells open pages (its WebSockets) to look again. */
export const mayChange = (request: RoomRequest) =>
  request.action === 'get' ? request.tell === true : request.action !== 'opponent';

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
    ladderFriend: null,
    inviteeName: room.invitee?.name ?? null,
    invitedYou: !seat && isOpenInvite(room) && !!room.invitee && ids.includes(room.invitee.guestId),
    rematchOf: room.rematchOf ?? null,
    rematch: room.rematch && seat ? { id: room.rematch.id, byYou: room.rematch.by === seat } : null,
    timeControl: roomTimeControl(room),
    createdAt: room.createdAt,
    expiresAt: isOpenInvite(room) ? inviteEnds(room) : null,
    serverNow: now,
    rated: room.rated === true,
    matched: room.matched === true,
    computer: room.computer !== undefined,
    ratings: ratingLines(room, seat),
    view: game && seat ? pvpView(game, seat) : null,
  };
}

/**
 * Saves the room after a change and sets the alarm for the next deadline.
 * A finished game is stored at once, marked `unsaved`, then put into D1's
 * game history, rated if it's rated (`markFinished`). Returns the room as
 * saved.
 */
async function save(storage: RoomStorage, deps: RoomDeps, room: Room, now: number): Promise<Room> {
  const game = gameOf(room);
  if (game?.status === 'over' && room.record) {
    const { value } = await markFinished(storage, { ...room, unsaved: true }, historySave(storage, deps, room, now));
    if (room.matched) deps.ladderEnded(room.id);
    return value;
  }
  await storage.put(ROOM_KEY, room);
  const next = game && nextAlarm(room, game, now);
  if (next) await storage.setAlarm(next);
  else await storage.deleteAlarm();
  return room;
}

/**
 * How a finished game goes into D1's history, rated if it's rated: once
 * saved, `unsaved` is cleared and the ratings kept for the players to see.
 * If it fails, the room keeps `unsaved` and its alarm tries again shortly.
 */
function historySave(storage: RoomStorage, deps: RoomDeps, room: Room, now: number): FinishedSave<Room, Record<Seat, RatingChange> | null> {
  return {
    key: ROOM_KEY,
    save: () => deps.saveFinished(room, room.record!, now),
    retryAt: now + SAVE_RETRY_MS,
    cleared: ({ unsaved: _unsaved, ...rest }, changes) => (changes ? {
      ...rest,
      ratingsBefore: { host: changes.host.before, guest: changes.guest.before },
      ratingsAfter: { host: changes.host.after, guest: changes.guest.after },
    } : rest),
    afterSave: () => storage.deleteAlarm(),
  };
}

/**
 * When the room next has something to do: remind the player to move that
 * their time is running out, unless they've been reminded this turn, or
 * end the game when it has run out. Null once the game is over.
 */
function nextAlarm(room: Room, game: PvpGame, now: number): number | null {
  const computerAt = computerMoveAt(room, game);
  if (computerAt !== null) return computerAt;
  const deadline = pvpDeadline(game);
  const timeLow = pvpTimeLowAt(game);
  if (deadline !== null && timeLow !== null && room.timeLowFor !== deadline && timeLow > now) return timeLow;
  return deadline;
}

/** When the computer's next guess is due, if it's the computer's turn; else null. */
function computerMoveAt(room: Room, game: PvpGame): number | null {
  if (!room.computer || pvpTurn(game) !== 'guest') return null;
  const next = room.computer.plan[game.guesses.guest.length];
  return next ? pvpTurnStart(game) + next.pauseMs : null;
}

/**
 * Plays the computer's guess once it's due, timed when it was due (not when
 * the alarm or a request came), so the record is the same however late the
 * room woke. Its pause is far inside its clock and its first-guess time.
 */
async function playComputer(storage: RoomStorage, deps: RoomDeps, room: Room, game: PvpGame | null, now: number): Promise<Room | null> {
  const at = game && computerMoveAt(room, game);
  if (at === null || now < at) return null;
  const word = room.computer!.plan[game!.guesses.guest.length].word;
  const result = submitPvpGuess(game!, 'guest', word, at);
  if (!result.ok) return null;
  const played = await save(storage, deps, { ...room, record: toPvpRecord(result.game) }, now);
  notify(deps, moveNotices(played, result.game));
  return played;
}

/**
 * If the player to move has run out of time, they concede. The alarm does
 * this at the deadline; every request checks too, in case the alarm is late.
 */
async function settle(storage: RoomStorage, deps: RoomDeps, room: Room, now: number): Promise<Room> {
  if (room.unsaved && room.record) return (await saveMarked(storage, room, historySave(storage, deps, room, now))).value;
  if (isOpenInvite(room)) {
    if (now < inviteEnds(room)) return room;
    const expired = { ...room, expired: true };
    await storage.put(ROOM_KEY, expired);
    notify(deps, expiredNotice(expired));
    return expired;
  }
  // A computer's guess that was due is played first, then the usual check runs on the game after it.
  const played = await playComputer(storage, deps, room, gameOf(room), now);
  if (played) room = played;
  const game = gameOf(room);
  const deadline = game && pvpDeadline(game);
  if (!game || deadline === null) return room;
  if (now < deadline) return remindTimeLow(storage, deps, room, game, deadline, now);
  const result = timeOutPvp(game, now);
  if (!result.ok) return room;
  const settled = await save(storage, deps, { ...room, record: toPvpRecord(result.game) }, now);
  notify(deps, moveNotices(settled, result.game));
  return settled;
}

/**
 * Once a correspondence turn is down to its last 5%, tells the player to
 * move, once a turn (README "Reminders"), and sets the alarm for the deadline.
 */
async function remindTimeLow(
  storage: RoomStorage, deps: RoomDeps, room: Room, game: PvpGame, deadline: number, now: number,
): Promise<Room> {
  const timeLow = pvpTimeLowAt(game);
  if (timeLow === null || now < timeLow || room.timeLowFor === deadline) return room;
  const reminded: Room = { ...room, timeLowFor: deadline };
  await storage.put(ROOM_KEY, reminded);
  await storage.setAlarm(deadline);
  notify(deps, timeLowNotice(reminded, game, deadline, now));
  return reminded;
}

/** The room's alarm: a player's time may be running out, or have run out. */
export async function handleAlarm(storage: RoomStorage, deps: RoomDeps, now: number): Promise<void> {
  const room = await storage.get<Room>(ROOM_KEY);
  if (room) await settle(storage, deps, room, now);
}

/** Handles one request to the room. */
export async function handleRoom(
  storage: RoomStorage, deps: RoomDeps, request: RoomRequest, now: number,
): Promise<RoomResponse> {
  const answer = await answerRoom(storage, deps, request, now);
  // The queue's `abandon` reads nothing back, so it's answered without names.
  if (request.action === 'abandon') return answer;
  return { ...answer, body: await withCurrentNames(storage, deps, answer.body, request.guestId) };
}

/**
 * A game as the server describes it, by each player's current name (issue
 * #133): a guest who signed in, or a player who renamed their profile,
 * shows by the new name. The room keeps the names they played under, for
 * anyone without an account profile and if the lookup fails, checked again
 * (Dev Plan item 19v): a name the profanity filter now refuses is
 * `NO_NAME`, whichever it is.
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
  // A finished ladder game against a person offers Add friend (Dev Plan item 19e): where you stand with them.
  const offersFriend = opponent && body.state === 'over' && room.matched === true && !room.computer;
  const [names, codes, ladderFriend] = await Promise.all([
    deps.namesOf(players.map((p) => p.guestId)).catch(() => none),
    opponent ? deps.friendCodes(askerId, [opponent.guestId]).catch(() => none) : none,
    offersFriend ? deps.friendStateOf(askerId, opponent.guestId).catch(() => null) : null,
  ]);
  const nameOf = (player: Player | null | undefined, fallback: string | null) =>
    (player && names[player.guestId]) ?? (fallback === null ? null : shownName(fallback));
  return {
    ...body,
    hostName: nameOf(room.host, body.hostName)!,
    guestName: nameOf(room.guest, body.guestName),
    opponentCode: opponent ? codes[opponent.guestId] ?? null : null,
    ladderFriend,
    inviteeName: nameOf(room.invitee, body.inviteeName),
  };
}

/**
 * The other person in a finished ladder game (Dev Plan item 19e), for the
 * player with these IDs to send a friend request to: refused during the
 * game, against a computer, outside the ladder and to anyone not in it.
 */
function ladderOpponent(room: Room, ids: readonly string[]): RoomResponse {
  const seat = seatOf(room, ids);
  if (!seat) return refuse(403, 'not-a-player');
  const game = gameOf(room);
  if (!room.matched || room.computer || !room.guest || !game) return refuse(400, 'bad-request');
  if (game.status !== 'over') return refuse(409, 'not-over');
  return { status: 200, body: { opponentId: (seat === 'host' ? room.guest : room.host).guestId } };
}

/**
 * The difficulty you play a rematch at (issue 240): the one you asked or
 * accepted it with (your Start games on setting; an older app sends none,
 * so the one you ended the last game on), but Medium for Easy when it's
 * rated, since Easy can't be.
 */
export function rematchDifficulty(difficulty: Difficulty, rated: boolean): Difficulty {
  return rated && !isRatedDifficulty(difficulty) ? 'medium' : difficulty;
}

/**
 * A ladder game against a computer (Dev Plan item 19p), started at once:
 * the computer takes the guest's seat with a random secret-list word, and
 * all its guesses at the player's word are worked out now.
 */
async function startComputerGame(
  storage: RoomStorage, deps: RoomDeps, request: Extract<RoomRequest, { action: 'computer' }>, now: number,
): Promise<RoomResponse> {
  const computer = ratedComputer(request.recall);
  if (!computer || !isRatedDifficulty(request.difficulty)) return refuse(400, 'bad-request');
  const secret = validateSecretWord(request.secret);
  if (!secret.ok) return refuse(400, secret.error);
  let theirs = SECRET_WORDS[Math.floor(deps.random() * SECRET_WORDS.length)];
  // Never the player's own word, which would make a hit on the first guess a draw at best.
  if (theirs === secret.word) theirs = SECRET_WORDS[(SECRET_WORDS.indexOf(theirs) + 1) % SECRET_WORDS.length];
  const timeControl = request.timeControl;
  const created = createPvpGame(
    { host: secret.word, guest: theirs }, pickFirstSeat(deps.random), now, timeControl,
    { host: request.difficulty, guest: request.difficulty }, true,
  );
  if (!created.ok) return refuse(400, created.error);
  const record = toPvpRecord({ ...created.game, ladder: { computer: computer.recall } });
  const room: Room = {
    id: request.id,
    createdAt: now,
    timeControl,
    host: { guestId: request.guestId, name: request.name, secret: secret.word, difficulty: request.difficulty },
    guest: { guestId: COMPUTER_ID, name: LADDER_COMPUTER_NAME },
    invitee: null,
    record,
    cancelled: false,
    rated: true,
    matched: true,
    computer: { recall: computer.recall, rating: computer.rating, plan: planComputerGuesses(secret.word, computer.recall, deps.random) },
    ratings: { host: request.rating, guest: computerRating(computer) },
  };
  const saved = await save(storage, deps, room, now);
  return { status: 201, body: describeRoom(saved, [request.guestId], now) };
}

/**
 * The queue's `abandon`: a ladder computer game whose player cancelled
 * while it was made, so it was never handed to them (Dev Plan item 19za).
 * It's cancelled now, as the first guess's 2 minutes would (item 18zv), so
 * it leaves their games in progress at once. Nobody is told: the player
 * cancelled. A game the player has already guessed in (they found it
 * meanwhile) is theirs and goes on.
 */
async function abandonComputerGame(storage: RoomStorage, deps: RoomDeps, room: Room, now: number): Promise<RoomResponse> {
  const game = gameOf(room);
  if (!room.computer || !game || room.unsaved) return refuse(409, room.unsaved ? 'game-over' : 'bad-request');
  if (game.guesses.host.length > 0) return refuse(409, 'game-over');
  const cancelled = cancelPvp(game, now);
  if (!cancelled.ok) return refuse(409, cancelled.error === 'game-over' ? 'game-over' : 'bad-request');
  const saved = await save(storage, deps, { ...room, record: toPvpRecord(cancelled.game) }, now);
  return { status: 200, body: describeRoom(saved, [], now) };
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
    };
    await storage.put(ROOM_KEY, room);
    await storage.setAlarm(inviteEnds(room));
    return { status: 201, body: describeRoom(room, [request.guestId], now) };
  }

  if (request.action === 'computer') {
    if (stored) return refuse(409, 'bad-request');
    return startComputerGame(storage, deps, request, now);
  }

  if (!stored) return refuse(404, 'not-found');
  // Before the usual catch-up, which could play the computer's due guess and tell the player it's their turn.
  if (request.action === 'abandon') return abandonComputerGame(storage, deps, stored, now);
  const room = await settle(storage, deps, stored, now);
  const ids = idsOf(request);
  if (request.action === 'get') return { status: 200, body: describeRoom(room, ids, now) };
  if (request.action === 'opponent') return ladderOpponent(room, ids);

  if (request.action === 'join') {
    if (ids.includes(room.host.guestId)) return refuse(409, 'own-invite');
    if (room.guest) return ids.includes(room.guest.guestId)
      ? { status: 200, body: describeRoom(room, ids, now) }
      : refuse(409, 'invite-taken');
    if (room.cancelled || room.declined) return refuse(409, 'invite-closed');
    if (room.expired) return refuse(409, 'invite-expired');
    if (room.invitee && !ids.includes(room.invitee.guestId)) return refuse(403, 'not-invited');
    const created = createPvpGame(
      { host: room.host.secret, guest: request.secret }, pickFirstSeat(deps.random), now, roomTimeControl(room),
      { host: room.host.difficulty, guest: request.difficulty }, room.rated === true,
    );
    if (!created.ok) return refuse(400, created.error);
    // A ladder game against a person (Dev Plan item 19p): its record says so.
    if (room.matched) created.game = { ...created.game, ladder: {} };
    const ratings = room.rated
      ? await deps.ratingsOf({ host: room.host.guestId, guest: request.guestId }, now) : undefined;
    const joined: Room = {
      ...room, guest: { guestId: request.guestId, name: request.name }, record: toPvpRecord(created.game),
      ...(ratings ? { ratings } : {}),
    };
    await save(storage, deps, joined, now);
    notify(deps, joinedNotice(joined, created.game));
    return { status: 200, body: describeRoom(joined, ids, now) };
  }

  if (request.action === 'decline') {
    // Only the friend a challenge is for can turn it down, while it's open.
    if (!room.invitee || !ids.includes(room.invitee.guestId) || seatOf(room, ids)) return refuse(403, 'not-invited');
    if (!isOpenInvite(room)) return refuse(409, room.expired ? 'invite-expired' : 'invite-closed');
    const declined = { ...room, declined: true };
    await storage.put(ROOM_KEY, declined);
    await storage.deleteAlarm();
    notify(deps, declinedNotice(declined));
    return { status: 200, body: describeRoom(declined, ids, now) };
  }

  const seat = seatOf(room, ids);
  if (!seat) return refuse(403, 'not-a-player');
  const game = gameOf(room);

  if (request.action === 'rematch') {
    // One open rematch per game, once it's over: whoever asks second is answered with the first.
    if (game?.status !== 'over' || !room.guest) return refuse(409, 'not-over');
    if (room.matched) return refuse(409, 'bad-request');
    const difficulty = rematchDifficulty(request.difficulty ?? game.playingDifficulty[seat], room.rated === true);
    if (room.rematch && room.rematch.id !== request.replacing) {
      return { status: 200, body: { kind: 'existing', id: room.rematch.id, byYou: room.rematch.by === seat, difficulty } };
    }
    const other = seat === 'host' ? room.guest : room.host;
    if (request.record) await storage.put(ROOM_KEY, { ...room, rematch: { id: request.newId, by: seat } });
    return {
      status: 200,
      body: {
        kind: 'new', id: request.newId, invitee: { guestId: other.guestId, name: other.name },
        timeControl: roomTimeControl(room), rated: room.rated === true, difficulty,
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
  notify(deps, moveNotices(next, result.game));
  if (request.action === 'guess') await deps.played((seat === 'host' ? room.host : room.guest!).guestId, now).catch(() => {});
  return { status: 200, body: describeRoom(next, ids, now) };
}

/**
 * Saves a finished game to D1: its record and a row per player for their
 * history, and if it's rated, the players' ratings, all in one batch, so
 * they're kept together or not at all. Saving it again (a retry) changes
 * nothing and returns the ratings it was given the first time.
 */
export async function saveFinishedGame(db: D1Database, room: Room, record: PvpRecord, now: number): Promise<Record<Seat, RatingChange> | null> {
  if (!room.guest) return null;
  // A cancelled game (item 18zv) has no winner: it's neither kept in either history nor rated.
  if (record.moves.at(-1)?.kind === 'cancel') return null;
  const game = gameOf(room);
  const players = { host: room.host.guestId, guest: room.guest.guestId };
  const pool = TWO_PLAYER_POOL;
  // Its recall and rating as the game started, even if the table has been recalibrated since.
  // (A room from before the rating was kept there falls back to the one it started with.)
  const computer = room.computer && { ...room.computer, rating: room.computer.rating ?? room.ratings?.guest.rating ?? 1500 };
  const outcome = room.rated ? game?.outcome : null;
  // A computer has no history, so only people get a row.
  const people = computer ? [players.host] : [players.host, players.guest];
  // Worked out again if another game changes a player's rating before this is kept (item 19zl).
  const { changes, kept } = await batchRated(db, room.id, async () => (!outcome ? []
    : computer ? computerGameChanges(db, pool, players.host, computerRating(computer), hostScore(outcome), now)
      : ratedGameChanges(db, pool, players, hostScore(outcome), now)), (changes) => [
    db.prepare(
      `INSERT OR IGNORE INTO games (id, mode, version, record, started_at, finished_at) VALUES (?1, 'friend', ?2, ?3, ?4, ?5)`,
    ).bind(room.id, HISTORY_VERSION, JSON.stringify(record), record.startedAt, now),
    ...people.map((guestId) =>
      db.prepare('INSERT OR IGNORE INTO game_players (game_id, guest_id) VALUES (?1, ?2)').bind(room.id, guestId)),
    ...ratingStatements(db, room.id, pool, changes, now, computer?.recall),
  ]);
  if (changes.length === 0) return null;
  if (!computer) return seatChanges(kept, players);
  const fixed = computerRating(computer);
  return kept[players.host] ? { host: kept[players.host], guest: { before: fixed, after: fixed } } : null;
}

