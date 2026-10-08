/**
 * Medium difficulty's manual letter marks. A mark belongs to a letter, not to
 * one bubble, so marking `a` as in highlights every `a` in every guess.
 */
export type Mark = 'in' | 'out';

/** Letter (a–z) → mark. Unmarked letters are absent. */
export type Marks = Readonly<Partial<Record<string, Mark>>>;

const NEXT: Record<Mark | 'unmarked', Mark | undefined> = {
  unmarked: 'in',
  in: 'out',
  out: undefined,
};

/** Tapping a letter cycles it unmarked → in → out → unmarked. Returns new marks. */
export function cycleMark(marks: Marks, letter: string): Marks {
  const next = NEXT[marks[letter] ?? 'unmarked'];
  const { [letter]: _previous, ...rest } = marks;
  return next ? { ...rest, [letter]: next } : rest;
}

/**
 * Whether the marks fit the scores: some secret word of 5 different letters
 * could score every guess as it did while containing every letter marked in
 * and none marked out. Letter logic only, never the word list, so it reveals
 * nothing about the secret that the scores don't. A `false` means at least one
 * mark is wrong, without saying which.
 */
export function marksFitScores(marks: Marks, guesses: readonly { guess: string; score: number }[]): boolean {
  let inMask = 0;
  let outMask = 0;
  for (const [c, mark] of Object.entries(marks)) {
    if (mark === 'in') inMask |= letterBit(c);
    else if (mark === 'out') outMask |= letterBit(c);
  }
  return !forEachFittingSet(guesses, inMask, outMask, () => false);
}

/** A letter's bit in a set of letters (a = bit 0 … z = bit 25). */
export function letterBit(letter: string): number {
  return 1 << (letter.charCodeAt(0) - 97);
}

/** A word's distinct letters as a bit set. */
export function letterMask(word: string): number {
  return [...word].reduce((m, c) => m | letterBit(c), 0);
}

/**
 * Calls `visit` with every set of 5 different letters (as a bit set) that
 * contains every letter in `inMask`, none in `outMask`, and shares exactly
 * its score's number of letters with every guess. `visit` returns false to
 * stop early; the result is false if it stopped, true if the search ran out.
 * Letter logic only: the word list is never consulted.
 */
export function forEachFittingSet(
  guesses: readonly { guess: string; score: number }[],
  inMask: number,
  outMask: number,
  visit: (set: number) => boolean,
): boolean {
  const checks = guesses.map((g) => [letterMask(g.guess), g.score] as const);
  // Try every set of 5 of the 26 letters.
  const search = (from: number, chosen: number, left: number): boolean => {
    if (left === 0) {
      if ((chosen & inMask) !== inMask || !checks.every(([m, score]) => popcount(chosen & m) === score)) return true;
      return visit(chosen);
    }
    for (let i = from; i <= 26 - left; i++) {
      const b = 1 << i;
      if (!(outMask & b) && !search(i + 1, chosen | b, left - 1)) return false;
    }
    return true;
  };
  return search(0, 0, 5);
}

export function popcount(n: number): number {
  let count = 0;
  for (; n; n &= n - 1) count++;
  return count;
}

/** Keeps only valid entries, for marks read back from storage. */
export function parseMarks(value: unknown): Marks {
  if (typeof value !== 'object' || value === null) return {};
  const marks: Partial<Record<string, Mark>> = {};
  for (const [letter, mark] of Object.entries(value)) {
    if (/^[a-z]$/.test(letter) && (mark === 'in' || mark === 'out')) marks[letter] = mark;
  }
  return marks;
}
