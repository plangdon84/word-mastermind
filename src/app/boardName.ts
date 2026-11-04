import { apiRequester, type ApiIdentity } from './apiIdentity';
import { DailyApiError, type DailyError } from './dailyApi';
import { readStored, removeStored, writeStored } from './localStore';

/*
 * A guest's name on the Daily boards (Dev Plan items 18zw and 19n): the
 * server shows each player's name now on every day's board. An account's
 * comes from its synced profile; a guest's is the one their last daily game
 * started with, or a new one sent when it's chosen, which the server keeps
 * only once they've started a daily game.
 *
 * This device remembers two things per guest ID. The name the server was
 * last sent (or started a daily game with), so a name that differs from it
 * is sent on any visit. And a rename still to send (`pending`), written the
 * moment a guest chooses a new name and cleared once the server takes it,
 * so a rename made offline, or by a guest this device never sent a name for
 * (one who played on an older app), still reaches the boards on the next
 * visit. A guest who never renames or plays sends nothing. Sends go one at
 * a time, the newest name last, so two quick renames can't land out of
 * order.
 */

const KEY = 'word-mastermind:board-name:v1';
const PENDING_KEY = 'word-mastermind:board-name-pending:v1';

interface Sent {
  /** The guest ID (the profile's `deviceId`) the name is for. */
  id: string;
  name: string;
}

function load(key: string): Sent | null {
  try {
    const data: unknown = JSON.parse(readStored(key) ?? 'null');
    if (typeof data !== 'object' || data === null) return null;
    const { id, name } = data as Record<string, unknown>;
    return typeof id === 'string' && typeof name === 'string' ? { id, name } : null;
  } catch {
    return null;
  }
}

/** A daily game started, or a name sent, as this guest with this name: the server has it now. */
export function noteBoardName(id: string, name: string): void {
  // If storage refuses it: the next game started sends the name instead.
  writeStored(KEY, JSON.stringify({ id, name } satisfies Sent));
  const pending = load(PENDING_KEY);
  if (pending && (pending.id !== id || pending.name === name)) removeStored(PENDING_KEY);
}

/** What `spotRename` compares: the profile's guest ID and name, and whether it's signed in. */
export interface NameState {
  id: string;
  name: string;
  signedIn: boolean;
}

/**
 * Whether going from `before` to `after` is a guest choosing a new name:
 * the same guest ID, signed out both times, with another name. Signing out
 * gives the device a new guest ID, so the account's name is never taken
 * for the new guest's.
 */
export function spotRename(before: NameState, after: NameState): boolean {
  return !before.signedIn && !after.signedIn && before.id === after.id && before.name !== after.name;
}

/** A guest chose a new name: kept to send until the server takes it. */
export function noteRename(id: string, name: string): void {
  writeStored(PENDING_KEY, JSON.stringify({ id, name } satisfies Sent));
}

/**
 * Whether this guest's boards may show another name than `name`, so it needs
 * sending: a name the server was sent before, or a rename it hasn't taken yet.
 */
export function boardNameDue(id: string, name: string): boolean {
  const sent = load(KEY);
  if (sent !== null && sent.id === id) return sent.name !== name;
  return load(PENDING_KEY)?.id === id;
}

/** Sends a guest's new name, for every Daily board they're on. */
export async function sendBoardName(apiUrl: string, identity: ApiIdentity, name: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const request = apiRequester(apiUrl, identity, fetchFn, (code, status) => new DailyApiError(code as DailyError, status));
  await request('POST', '/api/daily/name', { name });
}

interface Wanted {
  apiUrl: string;
  identity: ApiIdentity;
  name: string;
  fetchFn: typeof fetch;
}

let wanted: Wanted | null = null;
let busy = false;
let done: Promise<void> = Promise.resolve();

/**
 * Sends this guest's name if it's due (`boardNameDue`), after any send
 * already going, and only the newest name asked for meanwhile. A send that
 * fails stays due, for the next visit, unless the server refused the name
 * for good (`offensive-name`), which is never sent again.
 */
export function syncBoardName(apiUrl: string, identity: ApiIdentity, name: string, fetchFn: typeof fetch = fetch): Promise<void> {
  wanted = { apiUrl, identity, name, fetchFn };
  if (busy) return done;
  busy = true;
  done = (async () => {
    // Checked again after each send, and cleared in the same step as the last check, so no name asked for is missed.
    try {
      while (wanted) {
        const next: Wanted = wanted;
        wanted = null;
        const id = next.identity.guestId;
        if (next.identity.token || !boardNameDue(id, next.name)) continue;
        await sendBoardName(next.apiUrl, next.identity, next.name, next.fetchFn).then(() => noteBoardName(id, next.name), (error: unknown) => {
          // Refused for good (a name the server's filter turns down): settled as if sent, so it isn't sent again
          // on every visit (Issue 265); the name never reaches the boards. Others, any other 400 too, are retried.
          if (error instanceof DailyApiError && error.code === 'offensive-name') noteBoardName(id, next.name);
        });
      }
    } finally {
      busy = false;
    }
  })();
  return done;
}
