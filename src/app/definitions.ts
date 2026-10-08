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

export type DefinitionsState =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'ready'; definitions: Definitions };

let pending: Promise<Definitions> | undefined;

/**
 * The definitions ship with the app as a separate chunk (about 200 KB
 * compressed) that loads the first time it's needed, from our own origin.
 */
export function loadDefinitions(): Promise<Definitions> {
  pending ??= import('../../wordlist/lists/definitions.json?raw')
    .then((m) => JSON.parse(m.default) as Definitions)
    .catch((error: unknown) => {
      pending = undefined; // let a later tap retry
      throw error;
    });
  return pending;
}

/** Loads the definitions once `wanted` becomes true. */
export function useDefinitions(wanted: boolean): DefinitionsState {
  const [state, setState] = useState<DefinitionsState>({ status: 'idle' });
  useEffect(() => {
    if (!wanted || state.status !== 'idle') return;
    setState({ status: 'loading' });
    loadDefinitions().then(
      (definitions) => setState({ status: 'ready', definitions }),
      () => setState({ status: 'error' }),
    );
  }, [wanted, state.status]);
  return state;
}
