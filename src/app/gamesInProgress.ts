/*
 * Whether the title screen's Games in progress list is open (Dev Plan item
 * 18za, README "Title screen"): open when something waits on you (your turn
 * against a friend, a challenge or a lobby invite), closed otherwise. Opening
 * or closing it yourself holds until something new waits on you.
 */

const KEY = 'word-mastermind:games-in-progress:v1';

/** Your own open or close, with what was waiting on you then. */
export interface ListChoice {
  open: boolean;
  waiting: string[];
}

/** Whether the list is open: your own choice while nothing new waits on you, else open if anything does. */
export function listOpen(choice: ListChoice | null, waiting: readonly string[]): boolean {
  if (choice && waiting.every((id) => choice.waiting.includes(id))) return choice.open;
  return waiting.length > 0;
}

export function parseListChoice(raw: string | null): ListChoice | null {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { open, waiting } = value as Record<string, unknown>;
    if (typeof open !== 'boolean' || !Array.isArray(waiting) || !waiting.every((w) => typeof w === 'string')) return null;
    return { open, waiting };
  } catch {
    return null;
  }
}

/** Your last open or close. Browser storage can be blocked, when the list follows what's waiting. */
export function loadListChoice(): ListChoice | null {
  try {
    return parseListChoice(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveListChoice(choice: ListChoice): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    // It follows what's waiting next visit; nothing else is lost.
  }
}
