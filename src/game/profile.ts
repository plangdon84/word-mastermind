/*
 * Player profile rules (README "Profile"), kept here so the server can reuse
 * them. Names needn't be unique, but they're shown to other players (the
 * Daily Rush leaderboard, a friend's game), so a profanity filter refuses
 * the obvious ones.
 */

export const NAME_MIN = 3;
export const NAME_MAX = 20;

export type NameError = 'too-short' | 'too-long' | 'invalid-characters' | 'offensive';

export type NameValidation =
  | { ok: true; name: string }
  | { ok: false; error: NameError };

/** Trims the name and collapses runs of spaces, so `  Ann   Lee ` is `Ann Lee`. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ');
}

/**
 * A display name is 3 to 20 characters once normalized, counting an emoji or
 * accented letter as one, with no control or invisible formatting characters.
 */
export function validateName(name: string): NameValidation {
  const normalized = normalizeName(name);
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(normalized)) return { ok: false, error: 'invalid-characters' };
  const length = [...normalized].length;
  if (length < NAME_MIN) return { ok: false, error: 'too-short' };
  if (length > NAME_MAX) return { ok: false, error: 'too-long' };
  if (isOffensive(normalized)) return { ok: false, error: 'offensive' };
  return { ok: true, name: normalized };
}

/*
 * The profanity filter: a short list, not a complete one. Words that hide
 * inside innocent ones (ass in Cassie, dick in Dickens, homo in homogenous)
 * only count as a whole word, singular or plural; the rest count anywhere,
 * even spelled out with spaces or dots ("f.u.c.k") or digits for letters.
 */
const ANYWHERE = [
  'fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'bitch', 'motherf', 'jizz', 'hitler', 'pussy',
  'bastard', 'rapist', 'retard', 'tranny',
];
const WHOLE_WORD = [
  'ass', 'arse', 'asshole', 'cock', 'dick', 'tit', 'tits', 'fag', 'slut', 'rape', 'piss', 'cum', 'porn', 'nazi',
  'kike', 'spic', 'chink', 'homo', 'dyke', 'penis', 'vagina', 'anus', 'boob', 'boobs', 'sex', 'twat', 'wank',
  'wanker', 'prick', 'coon', 'gook', 'negro', 'kkk',
];
const LOOKALIKES: Record<string, string> = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };

/** Is this name one the filter refuses? */
export function isOffensive(name: string): boolean {
  const plain = [...name.toLowerCase()].map((c) => LOOKALIKES[c] ?? c).join('').normalize('NFD').replace(/\p{M}/gu, '');
  const words = plain.split(/[^a-z]+/).filter(Boolean);
  // Letters run together catch a word spelled out: "f u c k", "s.h.i.t".
  const joined = words.join('');
  const squeezed = joined.replace(/(.)\1+/g, '$1');
  if (ANYWHERE.some((w) => joined.includes(w) || squeezed.includes(w))) return true;
  return words.some((w) => WHOLE_WORD.some((bad) => w === bad || w === `${bad}s` || w === `${bad}es`));
}

/** A default name like `Guest-4821`. `random` returns a number in [0, 1). */
export function guestName(random: () => number = Math.random): string {
  return `Guest-${1000 + Math.floor(random() * 9000)}`;
}

/** Up to two initials for the profile bubble: `Ann Lee` → `AL`, `ann` → `A`. */
export function initials(name: string): string {
  const words = normalizeName(name).split(/[\s\-_.]+/u).filter(Boolean);
  const first = (word: string | undefined) => (word ? [...word][0].toLocaleUpperCase() : '');
  return words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : first(words[0]);
}
