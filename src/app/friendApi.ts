import {
  isDifficulty, isObject, isTime, parseMarks, isTimeControl, isTurnDays, type Difficulty, type GuessResult, type Marks, type PvpView, type Seat,
  type TimeControl,
} from '../game';
import { apiRequester, type ApiIdentity } from './apiIdentity';
import { isShownRating, type ShownRating } from './ratingsApi';

/*
 * Games against a friend (README "Two player vs. a friend"), refereed by the
 * server (`worker/`). The server holds both secret words and sends each
 * player only their own side of the game (`pvpView`).
 */

/** One player's rating in a rated game: as it started, and once it's over, after it. */
export interface RatingLine extends ShownRating {
  after: ShownRating | null;
}

/** Where a game against a friend is: waiting for the friend to accept the invite, playing, or over. */
export type FriendGameState = 'waiting' | 'playing' | 'over' | 'cancelled' | 'expired' | 'declined';

/** What the server says about a game, from the side of whoever asked. */
export interface FriendGame {
  id: string;
  /** Your seat, or null if you haven't joined (you're looking at an invite). */
  seat: Seat | null;
  state: FriendGameState;
  hostName: string;
  /** Null until someone accepts the invite. */
  guestName: string | null;
  /** Your opponent, when they're on your friends list: their friend code, which opens their profile. Null otherwise. */
  opponentCode: string | null;
  /** A challenge to a friend (README "Friends"): the friend it's for, who alone can accept it; null for an invite link. */
  inviteeName: string | null;
  /** A challenge you may accept or decline: you're the friend it's for, and haven't answered. */
  invitedYou: boolean;
  /** A rematch: the difficulty its invitee plays at (the one they ended the last game on); null otherwise. */
  inviteeDifficulty: Difficulty | null;
  /** A rematch (README "Rematch"): the game it follows. */
  rematchOf: string | null;
  /** A finished game's rematch, once either player has asked for one, and whether you did. */
  rematch: { id: string; byYou: boolean } | null;
  timeControl: TimeControl;
  /** When the invite was sent, in milliseconds since the epoch. */
  createdAt: number;
  /** When the invite link stops working, while nobody has accepted it; null otherwise. */
  expiresAt: number | null;
  /** The server's clock when it answered, so a live game's clocks can allow for this device's being off. */
  serverNow: number | null;
  /** A rated game (README "Rating"): a challenge between friends marked rated, or a matched game. */
  rated: boolean;
  /** Started by the matchmaking queue (README "Random opponent"), not an invite. */
  matched: boolean;
  /** A rated game's ratings from your side, once it has started. */
  ratings: { you: RatingLine; opponent: RatingLine } | null;
  /** Your view of the game once it has started and you're in it. */
  view: PvpView | null;
}

/** The server's reasons for refusing a request, beyond a word the rules refuse. */
export type FriendError =
  | 'bad-request' | 'bad-guest-id' | 'signed-out' | 'sign-in-needed' | 'not-found' | 'not-a-player' | 'own-invite' | 'invite-taken'
  | 'not-invited' | 'not-a-friend'
  | 'invite-closed' | 'invite-expired' | 'not-started' | 'not-over' | 'game-over' | 'not-your-turn' | 'time-up' | 'time-left'
  | 'wrong-length' | 'not-letters' | 'repeated-letters' | 'not-in-word-list' | 'difficulty-fixed' | 'difficulty-harder'
  | 'easy-unrated' | 'not-easy' | 'no-suggestions';

/** The opponent's name, from your seat. */
export const opponentName = (game: FriendGame): string | null =>
  game.seat === 'guest' ? game.hostName : game.guestName;

const FRIEND_STATES: readonly FriendGameState[] = ['waiting', 'playing', 'over', 'cancelled', 'expired', 'declined'];

const isGuess = (value: unknown): value is GuessResult =>
  isObject(value) && typeof value.guess === 'string' && typeof value.score === 'number' && typeof value.isWin === 'boolean';

const isGuessList = (value: unknown): value is GuessResult[] => Array.isArray(value) && value.every(isGuess);
const isSeat = (value: unknown): value is Seat => value === 'host' || value === 'guest';
const isSideLabel = (value: unknown): value is 'you' | 'opponent' => value === 'you' || value === 'opponent';

/** A time control, or an older server's days per guess. */
function readTimeControl(value: Record<string, unknown>): TimeControl | null {
  if (isTimeControl(value.timeControl)) return value.timeControl;
  return value.timeControl === undefined && isTurnDays(value.turnDays) ? `${value.turnDays}d` : null;
}

function readClocks(value: unknown): PvpView['clocks'] | undefined {
  if (value === null || value === undefined) return null;
  return isObject(value) && typeof value.you === 'number' && typeof value.opponent === 'number'
    ? { you: value.you, opponent: value.opponent } : undefined;
}

export function parsePvpView(value: unknown): PvpView | null {
  if (!isObject(value)) return null;
  const v = value;
  if (!isSideLabel(v.first) || typeof v.yourSecret !== 'string') return null;
  if (!(v.theirSecret === null || typeof v.theirSecret === 'string')) return null;
  if (!isGuessList(v.yourGuesses) || !isGuessList(v.theirGuesses)) return null;
  if (!(v.turn === null || isSideLabel(v.turn))) return null;
  if (v.status !== 'playing' && v.status !== 'final-guess' && v.status !== 'over') return null;
  const timeControl = readTimeControl(v);
  const clocks = readClocks(v.clocks);
  if (!isTime(v.startedAt) || !timeControl || !isDifficulty(v.difficulty) || clocks === undefined) return null;
  if (!(v.deadline === null || isTime(v.deadline))) return null;
  let outcome: PvpView['outcome'] = null;
  if (v.outcome !== null) {
    const o = v.outcome;
    if (!isObject(o) || !['won', 'lost', 'draw'].includes(o.result as string)) return null;
    if (!['found', 'draw', 'conceded', 'timed-out'].includes(o.reason as string)) return null;
    outcome = { result: o.result, reason: o.reason } as NonNullable<PvpView['outcome']>;
  }
  return {
    first: v.first, yourSecret: v.yourSecret, theirSecret: v.theirSecret,
    yourGuesses: v.yourGuesses, theirGuesses: v.theirGuesses, turn: v.turn, status: v.status, outcome,
    startedAt: v.startedAt, timeControl, deadline: v.deadline, clocks, difficulty: v.difficulty, rated: v.rated === true,
    // An older server doesn't count suggestions, or say the opponent's difficulty and marks.
    suggested: typeof v.suggested === 'number' ? v.suggested : 0,
    theirDifficulty: isDifficulty(v.theirDifficulty) ? v.theirDifficulty : null,
    theirMarks: isObject(v.theirMarks) ? parseMarks(v.theirMarks) : null,
  };
}

export const isRatingLine = (value: unknown): value is RatingLine =>
  isShownRating(value) && isObject(value) && (value.after === null || isShownRating(value.after));

/** A rating line with nothing else the server may have sent. */
export const ratingLine = ({ rating, provisional, after }: RatingLine): RatingLine =>
  ({ rating, provisional, after: after && { rating: after.rating, provisional: after.provisional } });

function readRatings(value: unknown): FriendGame['ratings'] | undefined {
  if (value === null || value === undefined) return null;
  if (!isObject(value) || !isRatingLine(value.you) || !isRatingLine(value.opponent)) return undefined;
  return { you: ratingLine(value.you), opponent: ratingLine(value.opponent) };
}

/** Reads the server's answer defensively: anything unexpected is an error, not a game. */
export function parseFriendGame(value: unknown): FriendGame | null {
  if (!isObject(value)) return null;
  const { id, seat, state, hostName, guestName, createdAt, expiresAt } = value;
  const timeControl = readTimeControl(value);
  const serverNow = isTime(value.serverNow) ? value.serverNow : null;
  const inviteeName = value.inviteeName ?? null;
  if (!(inviteeName === null || typeof inviteeName === 'string')) return null;
  if (typeof id !== 'string' || !(seat === null || isSeat(seat))) return null;
  if (!FRIEND_STATES.includes(state as FriendGameState) || typeof hostName !== 'string') return null;
  if (!(guestName === null || typeof guestName === 'string') || !timeControl || !isTime(createdAt)) return null;
  if (!(expiresAt === null || isTime(expiresAt))) return null;
  const view = value.view === null ? null : parsePvpView(value.view);
  if (value.view !== null && view === null) return null;
  const ratings = readRatings(value.ratings);
  if (ratings === undefined) return null;
  // An older server sends none of a rematch's fields.
  const rematchOf = typeof value.rematchOf === 'string' && GAME_ID.test(value.rematchOf) ? value.rematchOf : null;
  const r = value.rematch;
  const rematch = isObject(r) && typeof r.id === 'string' && GAME_ID.test(r.id) ? { id: r.id, byYou: r.byYou === true } : null;
  const inviteeDifficulty = isDifficulty(value.inviteeDifficulty) ? value.inviteeDifficulty : null;
  // An older server sends none.
  const opponentCode = typeof value.opponentCode === 'string' ? value.opponentCode : null;
  return {
    id, seat, state: state as FriendGameState, hostName, guestName, opponentCode, inviteeName, invitedYou: value.invitedYou === true,
    inviteeDifficulty, rematchOf, rematch, timeControl, createdAt, expiresAt, serverNow,
    rated: value.rated === true, matched: value.matched === true, ratings, view,
  };
}

/** A game's ID as the server makes them. */
const GAME_ID = /^[0-9a-f]{64}$/;

/** A request the server refused, with its reason. */
export class FriendApiError extends Error {
  constructor(readonly code: FriendError | 'unreachable', readonly status: number) {
    super(`The server answered ${status}: ${code}`);
  }
}

export interface NewInvite {
  name: string;
  secret: string;
  difficulty: Difficulty;
  timeControl: TimeControl;
  /** A friend's code, to challenge them: only they can accept (signed in). */
  friend?: string;
  /** A challenge to a friend only: the game is rated. */
  rated?: boolean;
}

/** A game you sent or accepted, from any of your devices once you've signed in. */
export interface ListedGame {
  id: string;
  /** When you sent or accepted the invite. */
  addedAt: number;
}

export function parseListedGames(value: unknown): ListedGame[] | null {
  if (!isObject(value) || !Array.isArray(value.games)) return null;
  const games = value.games.filter((g): g is ListedGame =>
    isObject(g) && typeof g.id === 'string' && GAME_ID.test(g.id) && isTime(g.addedAt));
  return games.map(({ id, addedAt }) => ({ id, addedAt }));
}

/** The WebSocket address an open game page listens on for moves (`routeLiveSocket` in the worker). */
export const liveSocketUrl = (apiUrl: string, id: string) =>
  `${apiUrl.replace(/\/$/, '').replace(/^http/, 'ws')}/api/games/${encodeURIComponent(id)}/live`;

export interface FriendApi {
  /** Your games, newest first. */
  list(): Promise<ListedGame[]>;
  create(invite: NewInvite): Promise<FriendGame>;
  get(id: string): Promise<FriendGame>;
  join(id: string, answer: { name: string; secret: string; difficulty: Difficulty }): Promise<FriendGame>;
  /** `marks`: your Medium marks, to share with your opponent (README "Two player vs. a friend"). */
  guess(id: string, word: string, marks?: Marks): Promise<FriendGame>;
  /** Gives up, or cancels an invite nobody has accepted yet. */
  concede(id: string): Promise<FriendGame>;
  setDifficulty(id: string, difficulty: Difficulty): Promise<FriendGame>;
  /** Records that Easy's Suggest offered `word` (README "Easy"). */
  suggest(id: string, word: string): Promise<FriendGame>;
  /**
   * Asks the other player of finished game `id` for a rematch, with your
   * word: the new game. If they asked first, it accepts theirs instead.
   */
  rematch(id: string, answer: { name: string; secret: string }): Promise<FriendGame>;
  /** Turns down a challenge or rematch sent to you. */
  decline(id: string): Promise<FriendGame>;
}

/**
 * Talks to the worker at `apiUrl`, as this device's guest or, signed in, its
 * account (`identity`). Every call rejects with a `FriendApiError`.
 */
export function friendApi(apiUrl: string, identity: ApiIdentity, fetchFn: typeof fetch = fetch): FriendApi {
  const request = apiRequester(apiUrl, identity, fetchFn, (code, status) => new FriendApiError(code as FriendError, status));
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<FriendGame> => {
    const game = parseFriendGame(await request(method, path, body));
    if (!game) throw new FriendApiError('bad-request', 200);
    return game;
  };
  const game = (id: string) => `/api/games/${encodeURIComponent(id)}`;
  return {
    list: async () => {
      const games = parseListedGames(await request('GET', '/api/games'));
      if (!games) throw new FriendApiError('bad-request', 200);
      return games;
    },
    create: (invite) => call('POST', '/api/games', invite),
    get: (id) => call('GET', game(id)),
    join: (id, answer) => call('POST', `${game(id)}/join`, answer),
    guess: (id, word, marks) => call('POST', `${game(id)}/guess`, marks ? { word, marks } : { word }),
    concede: (id) => call('POST', `${game(id)}/concede`, {}),
    setDifficulty: (id, difficulty) => call('POST', `${game(id)}/difficulty`, { difficulty }),
    suggest: (id, word) => call('POST', `${game(id)}/suggest`, { word }),
    rematch: (id, answer) => call('POST', `${game(id)}/rematch`, answer),
    decline: (id) => call('POST', `${game(id)}/decline`, {}),
  };
}
