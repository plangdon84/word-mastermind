import { isObject, isWordError, validateWord, type WordKind, type WordValidation } from '../game';
import { identityHeaders, type ApiIdentity } from './apiIdentity';

/**
 * Where a word is checked: on this device (local), or by the server
 * (remote, `worker/`). The modes played on this device use the local
 * source; the server's modes (a friend, Daily Rush, lobbies) check words
 * as part of each move, through their own APIs.
 */
export interface GameSource {
  readonly kind: 'local' | 'remote';
  /** Checks a word against the secret or guess list. Rejects if it can't reach the referee. */
  checkWord(kind: WordKind, word: string): Promise<WordValidation>;
}

/** The game logic runs here, with the bundled word lists. */
export const localSource: GameSource = {
  kind: 'local',
  checkWord: async (kind, word) => validateWord(kind, word),
};

/** Reads the server's answer defensively: anything unexpected is an error, not a verdict. */
export function parseWordValidation(value: unknown): WordValidation | null {
  if (!isObject(value)) return null;
  if (value.ok === true && typeof value.word === 'string') return { ok: true, word: value.word };
  if (value.ok === false && isWordError(value.error)) return { ok: false, error: value.error };
  return null;
}

/**
 * The server referees. `apiUrl` is the worker's origin; `identity` is this
 * device's ID (the profile's `deviceId`) and session, sent with every request.
 */
export function remoteSource(apiUrl: string, identity: ApiIdentity, fetchFn: typeof fetch = fetch): GameSource {
  const post = async (path: string, body: unknown): Promise<unknown> => {
    const response = await fetchFn(`${apiUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...identityHeaders(identity) },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return response.json();
  };
  return {
    kind: 'remote',
    checkWord: async (kind, word) => {
      const validation = parseWordValidation(await post('/api/words/check', { kind, word }));
      if (!validation) throw new Error('/api/words/check gave an unexpected answer');
      return validation;
    },
  };
}

/** The source today's modes (single player, vs. the computer, Rush) use. */
export const gameSource: GameSource = localSource;
