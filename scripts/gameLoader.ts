// Lets a script run with Node import `src/game/` as Vite builds it: a
// `?raw` import (the word lists) as its text, and an extensionless relative
// import as its `.ts` file (a folder's as its index.ts). Registered by
// `scripts/calibrate.ts` and `worker/scripts/rerate.ts`.
import { readFile } from 'node:fs/promises';

type Resolved = { url: string; format?: string; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: unknown) => Promise<Resolved>;
type NextLoad = (url: string, context: unknown) => Promise<{ format: string; source?: string | Buffer }>;

export async function resolve(specifier: string, context: { parentURL?: string }, next: NextResolve): Promise<Resolved> {
  if (specifier.endsWith('?raw') && context.parentURL) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
  }
  if (/^\.\.?\//.test(specifier) && !/\.\w+$/.test(specifier)) {
    // A folder's import (`../../src/game`) is its index.ts.
    return next(`${specifier}.ts`, context).catch(() => next(`${specifier}/index.ts`, context));
  }
  return next(specifier, context);
}

export async function load(url: string, context: unknown, next: NextLoad) {
  if (url.endsWith('?raw')) {
    const text = await readFile(new URL(url.slice(0, -'?raw'.length)), 'utf8');
    return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
  }
  return next(url, context);
}
