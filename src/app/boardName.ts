import { apiRequester, type ApiIdentity } from './apiIdentity';
import { DailyApiError, type DailyError } from './dailyApi';

/*
 * A guest's name on the Daily boards (Dev Plan item 18zw): the server shows
 * each player's name now on every day's board. An account's comes from its
 * synced profile; a guest's is the one their last daily game started with,
 * so a new name is sent as soon as it's chosen. This device remembers the
 * name the server has for its guest ID once it's sent one (or started a
 * daily game), and sends a new name when it's chosen. Opening the app sends
 * nothing until then, so a guest who never renames or plays sends nothing;
 * one who played before this device kept track (an older app) still gets
 * their rename on the boards. The server changes nothing for a guest it
 * hasn't seen.
 */

const KEY = 'word-mastermind:board-name:v1';

interface Sent {
  /** The guest ID (the profile's `deviceId`) the name is for. */
  id: string;
  name: string;
}

function load(): Sent | null {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof data !== 'object' || data === null) return null;
    const { id, name } = data as Record<string, unknown>;
    return typeof id === 'string' && typeof name === 'string' ? { id, name } : null;
  } catch {
    return null;
  }
}

/** A daily game started as this guest with this name: the server has it now. */
export function noteBoardName(id: string, name: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ id, name } satisfies Sent));
  } catch {
    // Storage full or off: the next game started sends the name instead.
  }
}

/**
 * Whether this guest's boards may show another name than `name`, so it needs
 * sending: a name the server was sent before, or (`renamed`, a name chosen
 * since the app opened) one it may never have had.
 */
export function boardNameStale(id: string, name: string, renamed: boolean): boolean {
  const sent = load();
  return sent !== null && sent.id === id ? sent.name !== name : renamed;
}

/** Sends a guest's new name, for every Daily board they're on. */
export async function sendBoardName(apiUrl: string, identity: ApiIdentity, name: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const request = apiRequester(apiUrl, identity, fetchFn, (code, status) => new DailyApiError(code as DailyError, status));
  await request('POST', '/api/daily/name', { name });
}
