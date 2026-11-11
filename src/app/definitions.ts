import { useEffect, useState } from 'preact/hooks';

/** One definition from wordlist/lists/definitions.json (see wordlist/README.md). */
export interface Definition {
  /** Part of speech. */
  p: 'noun' | 'verb' | 'adjective' | 'adverb';
  /** The definition. */
  d: string;
  /** The base word this definition belongs to, when it isn't the word itself. */
  l?: string;
}

export type Definitions = Readonly<Record<string, readonly Definition[]>>;

export type DefinitionState =
  | { status: 'loading' | 'error' }
  /** `entries` is undefined for a word with no definition. */
  | { status: 'ready'; entries: readonly Definition[] | undefined };

/**
 * The definitions ship with the app as 26 chunks, one per first letter
 * (a plugin in vite.config.ts; Dev Plan item 19zn), each loaded from our own
 * origin the first time a word starting with that letter needs one.
 */
const FILES: Record<string, () => Promise<{ default: string }>> = {
  a: () => import('virtual:definitions-a'),
  b: () => import('virtual:definitions-b'),
  c: () => import('virtual:definitions-c'),
  d: () => import('virtual:definitions-d'),
  e: () => import('virtual:definitions-e'),
  f: () => import('virtual:definitions-f'),
  g: () => import('virtual:definitions-g'),
  h: () => import('virtual:definitions-h'),
  i: () => import('virtual:definitions-i'),
  j: () => import('virtual:definitions-j'),
  k: () => import('virtual:definitions-k'),
  l: () => import('virtual:definitions-l'),
  m: () => import('virtual:definitions-m'),
  n: () => import('virtual:definitions-n'),
  o: () => import('virtual:definitions-o'),
  p: () => import('virtual:definitions-p'),
  q: () => import('virtual:definitions-q'),
  r: () => import('virtual:definitions-r'),
  s: () => import('virtual:definitions-s'),
  t: () => import('virtual:definitions-t'),
  u: () => import('virtual:definitions-u'),
  v: () => import('virtual:definitions-v'),
  w: () => import('virtual:definitions-w'),
  x: () => import('virtual:definitions-x'),
  y: () => import('virtual:definitions-y'),
  z: () => import('virtual:definitions-z'),
};

const loaded = new Map<string, Definitions>();
const pending = new Map<string, Promise<Definitions>>();

function letterOf(word: string): string | undefined {
  const letter = word.charAt(0);
  return letter in FILES ? letter : undefined;
}

/** The definitions of every word starting with `letter`, loaded once. */
function loadLetter(letter: string): Promise<Definitions> {
  let promise = pending.get(letter);
  if (!promise) {
    promise = FILES[letter]()
      .then((m) => {
        const definitions = JSON.parse(m.default) as Definitions;
        loaded.set(letter, definitions);
        return definitions;
      })
      .catch((error: unknown) => {
        pending.delete(letter); // let a later tap retry
        throw error;
      });
    pending.set(letter, promise);
  }
  return promise;
}

/** Starts loading a word's definition ahead of the tap that shows it. Never throws. */
export function preloadDefinition(word: string): void {
  const letter = letterOf(word);
  if (letter) loadLetter(letter).catch(() => undefined);
}

function stateOf(word: string): DefinitionState | undefined {
  const letter = letterOf(word);
  if (!letter) return { status: 'ready', entries: undefined }; // not a word of ours: nothing to load
  const definitions = loaded.get(letter);
  return definitions && { status: 'ready', entries: definitions[word] };
}

/** One word's definition, loading its first letter's file the first time it's needed. */
export function useDefinition(word: string | undefined): DefinitionState {
  const [failed, setFailed] = useState(false);
  const [, setLoadedLetter] = useState<string>();
  useEffect(() => {
    setFailed(false);
    const letter = word === undefined ? undefined : letterOf(word);
    if (!letter || loaded.has(letter)) return;
    let live = true;
    loadLetter(letter).then(
      () => live && setLoadedLetter(letter),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [word]);
  if (word === undefined) return { status: 'loading' };
  return stateOf(word) ?? (failed ? { status: 'error' } : { status: 'loading' });
}
