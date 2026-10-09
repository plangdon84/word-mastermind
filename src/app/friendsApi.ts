import {
  BADGE_BY_ID, computeStats, HEAD_TO_HEAD_MODES, HISTORY_MODES, isDifficulty, isLobbyCode, isObject, isTime, LOBBY_CODE_ALPHABET, NAME_MAX, normalizeWord,
  parseHistoryEntry, type DailyPlacement, type Difficulty, type EarnedBadge, type HeadToHead, type HistoryEntry,
  type HistoryFilter, type HistoryMode, type HistoryResult, type Stats,
} from '../game';
import { apiRequester, type ApiIdentity } from './apiIdentity';
import { isCountry } from './countries';
import { parsePlacement } from './dailyApi';

/*
 * Friends (README "Friends"): signed-in players add each other by friend
 * code, then challenge each other to a game or invite each other to a Rush
 * with Friends lobby. The server keeps the list (`worker/src/friends.ts`);
 * a friend is known by their code and name only, never their account's ID.
 */

/** A friend code: 8 of the join codes' letters and digits (no 0, O, 1 or I). */
export const FRIEND_CODE_LENGTH = 8;

export const isFriendCode = (value: unknown): value is string =>
  typeof value === 'string' && value.length === FRIEND_CODE_LENGTH
  && [...value].every((c) => LOBBY_CODE_ALPHABET.includes(c));

/** A code as typed ("abcd-2345", " ABCD 2345 "), or null if it can't be one. */
export function normalizeFriendCode(typed: string): string | null {
  const code = typed.toUpperCase().replace(/[\s-]/g, '');
  return isFriendCode(code) ? code : null;
}

/** A friend code as shown: two groups of four, easier to read out. */
export const formatFriendCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** A private invite key: 16 of the same letters and digits. */
export const INVITE_KEY_LENGTH = 16;

export const isInviteKey = (value: unknown): value is string =>
  typeof value === 'string' && value.length === INVITE_KEY_LENGTH
  && [...value].every((c) => LOBBY_CODE_ALPHABET.includes(c));

/** Your private invite link (`?invite=`): whoever opens it becomes your friend at once. */
export const inviteLink = (origin: string, key: string) => `${origin}/?invite=${key}`;

/** The invite key a link (`?invite=…`) carries, if any. */
export function inviteFromUrl(search: string): string | null {
  const key = new URLSearchParams(search).get('invite');
  return isInviteKey(key) ? key : null;
}

/** The friend code a link (`?friend=…`) carries, if any. */
export function friendCodeFromUrl(search: string): string | null {
  const code = new URLSearchParams(search).get('friend');
  return isFriendCode(code) ? code : null;
}

/** The message sent with your friend link. */
export const friendMessage = (name: string) => `${name} wants to be friends on Word Mastermind. Tap the link to accept:`;

/** Someone on the list: a friend, or a request either way. */
export interface Friend {
  code: string;
  name: string;
  /** When they became friends, or the request was sent. */
  since: number;
}

/** A friend invited you to their Rush with Friends lobby. */
export interface LobbyInvite {
  /** The lobby's join code. */
  code: string;
  fromName: string;
  at: number;
}

export interface FriendsList {
  /** Your own friend code, to share. */
  code: string;
  /** Your private invite key, for your invite link; null from a server older than invite links. */
  invite: string | null;
  friends: Friend[];
  /** Requests others sent you, to accept or decline. */
  received: Friend[];
  /** Requests you sent, waiting for an answer. */
  sent: Friend[];
  lobbyInvites: LobbyInvite[];
}

/** Most friends and requests an account can have, together. */
export const MAX_FRIENDS = 200;

/** Most friend requests by email an account may send in a day, whether or not each email has an account. */
export const EMAIL_REQUESTS_PER_DAY = 20;

/** The fewest characters a search by name takes (a name's least), and the most players it finds. */
export const SEARCH_MIN = 3;
export const SEARCH_MAX = 20;

/** A search for a name as typed, trimmed with its spaces collapsed, or null if it's too short or too long to be part of a name. */
export function normalizeSearch(typed: string): string | null {
  const search = typed.trim().replace(/\s+/g, ' ');
  const length = [...search].length;
  return length >= SEARCH_MIN && length <= NAME_MAX ? search : null;
}

/** Where you stand with a player a search found: friends, a request either way, or null for neither. */
export type FoundState = 'friends' | 'sent' | 'received' | null;

/**
 * A player found by name (Dev Plan item 18d, `GET /api/friends/search`):
 * only what anyone may see of them, their name and country, and their
 * friend code (public too) to send a request with. Never an ID or email.
 */
export interface FoundPlayer {
  code: string;
  name: string;
  country: string | null;
  state: FoundState;
}

const FOUND_STATES: readonly FoundState[] = ['friends', 'sent', 'received', null];

export function parseFoundPlayers(value: unknown): FoundPlayer[] | null {
  if (!isObject(value) || !Array.isArray(value.players)) return null;
  return value.players.filter((p): p is FoundPlayer =>
    isObject(p) && isFriendCode(p.code) && typeof p.name === 'string' && FOUND_STATES.includes(p.state as FoundState))
    .map(({ code, name, country, state }) => ({ code, name, country: isCountry(country) ? country : null, state }));
}

const parseFriends = (value: unknown): Friend[] | null => {
  if (!Array.isArray(value)) return null;
  const friends = value.filter((f): f is Friend =>
    isObject(f) && isFriendCode(f.code) && typeof f.name === 'string' && isTime(f.since));
  return friends.map(({ code, name, since }) => ({ code, name, since }));
};

export function parseFriendsList(value: unknown): FriendsList | null {
  if (!isObject(value) || !isFriendCode(value.code) || !Array.isArray(value.lobbyInvites)) return null;
  const friends = parseFriends(value.friends);
  const received = parseFriends(value.received);
  const sent = parseFriends(value.sent);
  if (!friends || !received || !sent) return null;
  const lobbyInvites = value.lobbyInvites.filter((i): i is LobbyInvite =>
    isObject(i) && isLobbyCode(i.code) && typeof i.fromName === 'string' && isTime(i.at))
    .map(({ code, fromName, at }) => ({ code, fromName, at }));
  // A server deployed before the app (or before invite links) sends none: the list still works, without the link.
  const invite = isInviteKey(value.invite) ? value.invite : null;
  return { code: value.code, invite, friends, received, sent, lobbyInvites };
}

/**
 * A friend's profile (Dev Plan item 18c, README "Friends' profiles"): what
 * they've chosen to show every player (name and country), and their Daily
 * Rush places, for their badges. Never their settings, email or friends.
 */
export interface FriendProfile {
  name: string;
  country: string | null;
  memberSince: number | null;
  placements: DailyPlacement[];
}

function parseFriendProfile(value: unknown): FriendProfile | null {
  if (!isObject(value) || typeof value.name !== 'string' || !Array.isArray(value.placements)) return null;
  const { name, country, memberSince } = value;
  return {
    name,
    country: isCountry(country) ? country : null,
    memberSince: isTime(memberSince) ? memberSince : null,
    placements: value.placements.map(parsePlacement).filter((p): p is DailyPlacement => p !== null),
  };
}

/**
 * What a player shares with friends (Dev Plan item 18cb): their stats and
 * badges as their own device works them out (`sharedSummary`), how many
 * games their history lists, and the games their stats point at, to open
 * from the stats. The server keeps it as sent: it can't work stats out
 * within a request's limits, and a made-up badge only fools friends.
 * `format` is `SHARED_FORMAT` when it was worked out.
 */
export interface SharedSummary {
  format: number;
  games: number;
  stats: Stats;
  badges: EarnedBadge[];
  featured: HistoryEntry[];
}

/**
 * The shape of the stats and badges a summary holds: raise it when they
 * change, so a friend's app never reads one in a shape it doesn't know (it
 * shows "not shared yet" until their device sends the new one).
 */
export const SHARED_FORMAT = 1;

/** The longest summary the server keeps, as JSON: far more than any real one. */
export const MAX_SHARED_CHARS = 200_000;
/** The most badges and featured games a summary has: more than there are. */
const MAX_BADGES = 500;
const MAX_FEATURED = 40;

/**
 * `GET /api/friends/profile`: their profile, what they share (null until a
 * device of theirs on this version has sent it) and your record against
 * them, from the games you both played.
 */
export interface FriendProfileAnswer {
  profile: FriendProfile;
  summary: SharedSummary | null;
  versus: HeadToHead;
}

/** A page of a friend's game history, newest first; `next` is the offset of the next page, or null at the end. */
export interface FriendGamesPage {
  games: HistoryEntry[];
  next: number | null;
}

/** The most games one page of a friend's history has. */
export const FRIEND_GAMES_PAGE_MAX = 50;

/** Which page of a friend's history to load (`GET /api/friends/profile/games`). */
export interface FriendGamesQuery {
  filter: HistoryFilter;
  offset: number;
  limit: number;
}

/** A friend's history query, as `URLSearchParams`. The search is sent as `matchesFilter` reads it. */
export function friendGamesParams(code: string, { filter, offset, limit }: FriendGamesQuery): URLSearchParams {
  const params = new URLSearchParams({ code, offset: String(offset), limit: String(limit) });
  if (filter.mode) params.set('mode', filter.mode);
  if (filter.result) params.set('result', filter.result);
  if (filter.difficulty) params.set('difficulty', filter.difficulty);
  const search = normalizeWord(filter.search ?? '');
  if (search) params.set('search', search);
  return params;
}

/** The server's reading of `friendGamesParams`, or null if it's no such query. */
export function parseFriendGamesParams(params: URLSearchParams): FriendGamesQuery | null {
  const offset = Number(params.get('offset'));
  const limit = Number(params.get('limit'));
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > FRIEND_GAMES_PAGE_MAX) {
    return null;
  }
  const [mode, result, difficulty, search] = ['mode', 'result', 'difficulty', 'search'].map((k) => params.get(k));
  if (mode !== null && !HISTORY_MODES.includes(mode as HistoryMode)) return null;
  if (result !== null && !['won', 'lost', 'drawn'].includes(result)) return null;
  if (difficulty !== null && !isDifficulty(difficulty)) return null;
  if (search !== null && (search.length === 0 || search.length > 32)) return null;
  const filter: HistoryFilter = {};
  if (mode !== null) filter.mode = mode as HistoryMode;
  if (result !== null) filter.result = result as HistoryResult;
  if (difficulty !== null) filter.difficulty = difficulty as Difficulty;
  if (search !== null) filter.search = search;
  return { filter, offset, limit };
}

const parseEntries = (value: unknown[]) =>
  // A game this version of the app can't read (from a newer app or server) is left out: it's only shown.
  value.map(parseHistoryEntry).filter((e): e is HistoryEntry => e !== null);

const isTally = (value: unknown) =>
  isObject(value) && [value.wins, value.draws, value.losses].every((n) => Number.isSafeInteger(n));

/** Modes added since summaries were first shared, which an older app's summary leaves out. */
const LATER_MODES: readonly HistoryMode[] = ['dailyWord'];

/**
 * A shared summary, checked as far as the app relies on it (the server
 * checks what a device sends with it too), or null if it isn't one.
 */
export function parseSharedSummary(value: unknown): SharedSummary | null {
  if (!isObject(value) || value.format !== SHARED_FORMAT || !Number.isSafeInteger(value.games)
    || (value.games as number) < 0 || !Array.isArray(value.badges) || value.badges.length > MAX_BADGES
    || !Array.isArray(value.featured) || value.featured.length > MAX_FEATURED) {
    return null;
  }
  const { stats } = value;
  if (!isObject(stats) || !isObject(stats.modes)) return null;
  // A summary shared before the Daily Word (Dev Plan item 7b) has no stats for it: none played.
  const modes: Record<string, unknown> = { ...stats.modes };
  for (const m of LATER_MODES) modes[m] ??= computeStats([], 0).modes[m];
  if (typeof stats.played !== 'number' || !isObject(stats.byDifficulty) || !Array.isArray(stats.topGuesses)
    || !HISTORY_MODES.every((m) => isObject(modes[m]))) {
    return null;
  }
  // Only badges this version knows, each once.
  const badges = new Map<string, EarnedBadge>();
  for (const b of value.badges) {
    if (isObject(b) && typeof b.id === 'string' && BADGE_BY_ID.has(b.id) && !badges.has(b.id) && isTime(b.at)
      && typeof b.gameId === 'string') {
      badges.set(b.id, { id: b.id, at: b.at, gameId: b.gameId });
    }
  }
  return {
    format: SHARED_FORMAT, games: value.games as number, stats: { ...stats, modes } as unknown as Stats, badges: [...badges.values()],
    featured: parseEntries(value.featured),
  };
}

export function parseFriendProfileAnswer(value: unknown): FriendProfileAnswer | null {
  if (!isObject(value)) return null;
  const profile = parseFriendProfile(value.profile);
  // A summary this version can't read (from a newer app) shows as not shared yet.
  const summary = value.summary === null ? null : parseSharedSummary(value.summary);
  const { versus } = value;
  if (!profile || !isObject(versus) || !HEAD_TO_HEAD_MODES.every((m) => isTally(versus[m]))) return null;
  return { profile, summary, versus: versus as unknown as HeadToHead };
}

export function parseFriendGamesPage(value: unknown): FriendGamesPage | null {
  if (!isObject(value) || !Array.isArray(value.games) || !(value.next === null || Number.isSafeInteger(value.next))) return null;
  return { games: parseEntries(value.games), next: value.next as number | null };
}

/** The server's reasons for refusing. */
export type FriendsErrorCode =
  | 'bad-request' | 'bad-guest-id' | 'signed-out' | 'sign-in-needed' | 'not-found' | 'own-code' | 'too-many-friends'
  | 'too-many-requests' | 'unreachable' | 'bad-email' | 'own-email' | 'too-many-emails'
  // Opening an invite link: not codes the server sends, but how the app words its not-found and own-code.
  | 'invite-gone' | 'own-invite';

export class FriendsApiError extends Error {
  constructor(readonly code: FriendsErrorCode, readonly status: number) {
    super(`The server answered ${status}: ${code}`);
  }
}

export interface FriendsApi {
  /** Your code, friends, requests and lobby invites. */
  list(): Promise<FriendsList>;
  /** Sends a friend request, or accepts theirs if they've sent you one. Answers with the list. */
  add(code: string): Promise<FriendsList>;
  /** Removes a friend, declines their request, or withdraws yours. Answers with the list. */
  remove(code: string): Promise<FriendsList>;
  /**
   * Sends a friend request to whoever has an account with this email, if
   * anyone. The answer is the same either way, and the request stays off
   * your list until they accept.
   */
  requestByEmail(email: string): Promise<void>;
  /** Players whose name has this in it (`normalizeSearch`), best matches first, leaving out those who'd rather not be found. */
  search(name: string): Promise<FoundPlayer[]>;
  /** Whose invite link this is (their name), to ask before accepting it. */
  peekInvite(key: string): Promise<{ name: string }>;
  /** Opens a friend's invite link: you're friends at once. Answers with the list and who the link was from. */
  acceptInvite(key: string): Promise<{ list: FriendsList; friend: Friend | null }>;
  /** A new invite key, so links shared before stop working. Answers with the list. */
  resetInvite(): Promise<FriendsList>;
  /** A friend's profile, what they share and your record against them. */
  profile(code: string): Promise<FriendProfileAnswer>;
  /** A page of a friend's game history. */
  profileGames(code: string, query: FriendGamesQuery): Promise<FriendGamesPage>;
  /** Shares your stats and badges with your friends. */
  share(summary: SharedSummary): Promise<void>;
  /** Indexes a few more of your games for friends; `done` once there are none left. */
  indexStep(): Promise<{ done: boolean }>;
}

/** Talks to the worker at `apiUrl` as the signed-in account (`identity`). Every call rejects with a `FriendsApiError`. */
export function friendsApi(apiUrl: string, identity: ApiIdentity, fetchFn: typeof fetch = fetch): FriendsApi {
  const send = apiRequester(apiUrl, identity, fetchFn, (code, status) => new FriendsApiError(code as FriendsErrorCode, status));
  const request = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<FriendsList> => {
    const list = parseFriendsList(await send(method, path, body));
    if (!list) throw new FriendsApiError('bad-request', 200);
    return list;
  };
  return {
    list: () => request('GET', '/api/friends'),
    add: (code) => request('POST', '/api/friends/add', { code }),
    remove: (code) => request('POST', '/api/friends/remove', { code }),
    requestByEmail: async (email) => {
      await send('POST', '/api/friends/email', { email });
    },
    search: async (name) => {
      const players = parseFoundPlayers(await send('GET', `/api/friends/search?${new URLSearchParams({ name })}`));
      if (!players) throw new FriendsApiError('bad-request', 200);
      return players;
    },
    peekInvite: async (key) => {
      const answer = await send('POST', '/api/friends/invite/peek', { invite: key });
      if (!isObject(answer) || typeof answer.name !== 'string') throw new FriendsApiError('bad-request', 200);
      return { name: answer.name };
    },
    acceptInvite: async (key) => {
      const answer = await send('POST', '/api/friends/invite/accept', { invite: key });
      const list = parseFriendsList(answer);
      if (!list) throw new FriendsApiError('bad-request', 200);
      const [friend] = isObject(answer) && isObject(answer.accepted) ? parseFriends([answer.accepted]) ?? [] : [];
      return { list, friend: friend ?? null };
    },
    resetInvite: () => request('POST', '/api/friends/invite/reset', {}),
    profile: async (code) => {
      const answer = parseFriendProfileAnswer(await send('GET', `/api/friends/profile?${new URLSearchParams({ code })}`));
      if (!answer) throw new FriendsApiError('bad-request', 200);
      return answer;
    },
    profileGames: async (code, query) => {
      const page = parseFriendGamesPage(await send('GET', `/api/friends/profile/games?${friendGamesParams(code, query)}`));
      if (!page) throw new FriendsApiError('bad-request', 200);
      return page;
    },
    share: async (summary) => {
      await send('POST', '/api/profile/shared', summary);
    },
    indexStep: async () => {
      const answer = await send('POST', '/api/profile/index', {});
      if (!isObject(answer) || typeof answer.done !== 'boolean') throw new FriendsApiError('bad-request', 200);
      return { done: answer.done };
    },
  };
}

/** What to tell someone when a change to their friends list didn't work. */
export function friendsErrorMessage(code: FriendsErrorCode): string {
  switch (code) {
    case 'not-found':
      return 'Nobody has that friend code. Check it and try again.';
    case 'invite-gone':
      return 'That invite link no longer works: its owner made a new one. Ask them for it, or for their friend code.';
    case 'own-invite':
      return "That's your own invite link: send it to a friend so they can add you.";
    case 'own-code':
      return "That's your own friend code: send it to a friend so they can add you.";
    case 'too-many-friends':
      return `You have ${MAX_FRIENDS} friends and requests already. Remove some to add more.`;
    case 'bad-email':
      return "That doesn't look like an email address. Check it and try again.";
    case 'own-email':
      return "That's your own email: type a friend's.";
    case 'too-many-emails':
      return `You've sent ${EMAIL_REQUESTS_PER_DAY} requests by email today. Try again tomorrow, or add friends by name or code.`;
    case 'signed-out':
    case 'sign-in-needed':
      return 'You were signed out. Sign in again to see your friends.';
    case 'too-many-requests':
      return 'Too many tries from this connection just now. Wait a minute and try again.';
    case 'unreachable':
      return "Can't reach the game server. Check your connection and try again.";
    case 'bad-request':
    case 'bad-guest-id':
      return 'Something went wrong. Reload the page and try again.';
  }
}

const PENDING_INVITE_KEY = 'word-mastermind:friend-invite:v2';

/** How long an invite link opened while signed out is kept: long enough to sign in, not to be found by the next person. */
export const PENDING_INVITE_MS = 24 * 60 * 60 * 1000;

/**
 * An invite link opened while signed out is kept until you sign in (which
 * can leave the page, for Google), then accepted. It's forgotten after a
 * day, and on signing out, so on a shared computer it can't make the next
 * person to sign in a friend of its owner. Browser storage can be blocked;
 * then the link has to be opened again after signing in.
 */
export function savePendingInvite(key: string | null, now: number = Date.now()): void {
  try {
    if (key) localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ key, at: now }));
    else localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // See above.
  }
}

export function parsePendingInvite(raw: string | null, now: number): string | null {
  try {
    const data: unknown = raw ? JSON.parse(raw) : null;
    if (!isObject(data) || !isInviteKey(data.key) || !isTime(data.at)) return null;
    return now - data.at < PENDING_INVITE_MS && data.at <= now ? data.key : null;
  } catch {
    return null;
  }
}

export function loadPendingInvite(now: number = Date.now()): string | null {
  try {
    return parsePendingInvite(localStorage.getItem(PENDING_INVITE_KEY), now);
  } catch {
    return null;
  }
}
