import { isLobbyCode, isObject, parseMarks, type LobbyKind, type Marks } from '../game';

/*
 * What this device keeps about Rush with Friends and Competitive Rush. The lobby is on the
 * server; this is only which lobby you're in (so a reload, or Continue,
 * goes back to it), whether it's still going, and Medium's marks.
 */

export interface LobbySaved {
  code: string;
  kind: LobbyKind;
  /** You're in the lobby and it isn't over (or closed) yet. */
  active: boolean;
  /** Medium's in/out marks, one set per word. */
  marks: readonly Marks[];
}

const KEY = 'word-mastermind:lobby:v1';

export function parseLobbySaved(raw: string | null): LobbySaved | null {
  try {
    const data: unknown = raw ? JSON.parse(raw) : null;
    if (!isObject(data) || !isLobbyCode(data.code) || !Array.isArray(data.marks)) return null;
    return {
      code: data.code, kind: data.kind === 'competitive' ? 'competitive' : 'friends', active: data.active === true,
      marks: data.marks.map(parseMarks),
    };
  } catch {
    return null;
  }
}

/** Browser storage can be missing or blocked (private windows), so failures are ignored. */
export function loadLobby(): LobbySaved | null {
  try {
    return parseLobbySaved(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveLobby(saved: LobbySaved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage is a convenience; the lobby is on the server.
  }
}

/** The lobby a reload, or Continue, should go back to, if any. */
export const activeLobby = (): string | null => {
  const saved = loadLobby();
  return saved?.active ? saved.code : null;
};

/** Which kind of lobby Continue goes back to, if any. */
export const activeLobbyKind = (): LobbyKind | null => {
  const saved = loadLobby();
  return saved?.active ? saved.kind : null;
};

/** The lobby a join link (`?lobby=…`) or a notification opens, if any. */
export function lobbyCodeFromUrl(search: string): string | null {
  const code = new URLSearchParams(search).get('lobby');
  return isLobbyCode(code) ? code : null;
}

/** The join link for a lobby: the app's own address with `?lobby=`. */
export const lobbyLink = (origin: string, code: string) => `${origin}/?lobby=${code}`;

/** The message sent with a join link, from the Share button or a text message. */
export const lobbyMessage = (hostName: string, code: string) =>
  `${hostName} wants you in a Rush with Friends on Word Mastermind! Join code ${code}, or tap the link:`;
