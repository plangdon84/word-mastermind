import { validateName } from '../../src/game';

/*
 * The checks every route makes on a name or word it's sent (Dev Plan item
 * 19zp, issue 294): one place, so the friend game, lobby, daily and queue
 * routes answer the same for the same mistake.
 */

/** Longer than any word or name by far, so a request can't make the server work through a huge string. */
const MAX_SENT = 64;

/**
 * A word as sent (a guess, a suggestion or a secret word): a short string,
 * nothing more. Whoever plays it checks it properly (the referee or
 * `validateSecretWord`), which says what's wrong with it.
 */
export const isSentWord = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_SENT;

/** A name the server was sent, normalized, or why it's refused. */
export type SentName = { ok: true; name: string } | { ok: false; error: 'offensive-name' | 'bad-request' };

/**
 * A display name, shown to other players: it must pass the profile's rules,
 * profanity filter included. A name the filter refuses answers
 * `offensive-name` on every route, so the app can say why; anything else
 * wrong with it is `bad-request`.
 */
export function sentName(value: unknown): SentName {
  if (!isSentWord(value)) return { ok: false, error: 'bad-request' };
  const name = validateName(value);
  if (name.ok) return { ok: true, name: name.name };
  return { ok: false, error: name.error === 'offensive' ? 'offensive-name' : 'bad-request' };
}
