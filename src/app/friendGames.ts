import { isLive, isObject, isTime, parseMarks, timeControlText, type Marks, type TimeControl } from '../game';

/*
 * The games against a friend this device is in. The server referees them and
 * keeps the game itself; this browser only remembers which games are yours,
 * and your Medium marks and half-typed guess in each. As a guest, a game can
 * only be played from the device that joined it; signed in (README
 * "Accounts"), your games from other devices are added here too.
 */

export interface FriendGameEntry {
  id: string;
  /** When you sent or accepted the invite, in milliseconds since the epoch. */
  addedAt: number;
  marks: Marks;
  draft: string;
  /** You've seen how it ended (or that it was cancelled), so it leaves the title screen. */
  done: boolean;
}

const KEY = 'word-mastermind:friend-games:v1';

/**
 * Finished games kept (for their marks, should you look again); older ones
 * drop off. Games still on are always kept, however many there are.
 */
export const MAX_DONE_FRIEND_GAMES = 30;

const isGameId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

/** Reads the list defensively, dropping any entry that doesn't parse. */
export function parseFriendGames(raw: string | null): FriendGameEntry[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.flatMap((e): FriendGameEntry[] => {
    if (!isObject(e) || !isGameId(e.id) || !isTime(e.addedAt)) return [];
    const draft = typeof e.draft === 'string' && /^[a-z]{0,5}$/.test(e.draft) ? e.draft : '';
    return [{ id: e.id, addedAt: e.addedAt, marks: parseMarks(e.marks), draft, done: e.done === true }];
  });
}

export function loadFriendGames(): FriendGameEntry[] {
  try {
    return parseFriendGames(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

function save(entries: readonly FriendGameEntry[]): void {
  let done = 0;
  const kept = entries.filter((e) => !e.done || ++done <= MAX_DONE_FRIEND_GAMES);
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Storage is a convenience; the server still has the game.
  }
}

/** Adds a game (newest first), or leaves it where it is if it's already listed. */
export function addFriendGame(id: string, now: number): FriendGameEntry {
  const entries = loadFriendGames();
  const found = entries.find((e) => e.id === id);
  if (found) return found;
  const entry: FriendGameEntry = { id, addedAt: now, marks: {}, draft: '', done: false };
  save([entry, ...entries]);
  return entry;
}

/**
 * Adds games this device doesn't know yet (ones you sent or accepted on
 * another device), in order, newest first. Returns how many were new.
 */
export function mergeFriendGames(found: readonly Pick<FriendGameEntry, 'id' | 'addedAt' | 'done'>[]): number {
  const entries = loadFriendGames();
  const known = new Set(entries.map((e) => e.id));
  const added = found.filter((f) => !known.has(f.id))
    .map(({ id, addedAt, done }): FriendGameEntry => ({ id, addedAt, marks: {}, draft: '', done }));
  if (added.length === 0) return 0;
  save([...entries, ...added].sort((a, b) => b.addedAt - a.addedAt));
  return added.length;
}

/** Forgets every game: on signing out, they're the account's, not the new guest's. */
export function clearFriendGames(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

export function updateFriendGame(id: string, change: Partial<Omit<FriendGameEntry, 'id' | 'addedAt'>>): void {
  save(loadFriendGames().map((e) => (e.id === id ? { ...e, ...change } : e)));
}

export function findFriendGame(id: string): FriendGameEntry | null {
  return loadFriendGames().find((e) => e.id === id) ?? null;
}

/** The game an invite link (`?join=…`) or a notification (`?game=…`) opens, if any. */
export function gameIdFromUrl(search: string): string | null {
  const params = new URLSearchParams(search);
  const id = params.get('join') ?? params.get('game');
  return isGameId(id) ? id : null;
}

/** The invite link for a game: the app's own address with `?join=`. */
export const inviteLink = (origin: string, id: string) => `${origin}/?join=${id}`;

/** The message sent with an invite link, from the Share button or a text message. */
export function inviteMessage(hostName: string, control: TimeControl): string {
  const timing = isLive(control) ? `A live game, ${timeControlText(control)}` : `Up to ${timeControlText(control)}`;
  return `${hostName} wants to play Word Mastermind with you! ${timing}. Tap the link to accept.`;
}

/**
 * A link that opens the phone's messaging app with the invite typed in, for
 * phones whose browser can't share. `?&body=` works on both iPhone and Android.
 */
export const smsLink = (message: string, link: string) => `sms:?&body=${encodeURIComponent(`${message} ${link}`)}`;
