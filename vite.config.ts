import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';
import { buildApiUrl } from './src/buildApiUrl';
import { APP_VERSION } from './src/app/releases';

/** The app's own entry, whose static imports load at start-up. */
const APP_ENTRY = resolve(import.meta.dirname, 'src/main.tsx');

interface ChunkGraph {
  getModuleInfo(id: string): { importedIds: readonly string[] } | null;
}

/** The app's own modules that load at start-up: everything `src/main.tsx` imports, but not dynamically. */
const startUpModules = new WeakMap<ChunkGraph, Set<string>>();
function startUpOf(graph: ChunkGraph): Set<string> {
  let found = startUpModules.get(graph);
  if (found) return found;
  found = new Set([APP_ENTRY]);
  for (const id of found) for (const imported of graph.getModuleInfo(id)?.importedIds ?? []) found.add(imported);
  startUpModules.set(graph, found);
  return found;
}

export default defineConfig(({ mode }) => {
  // A preview uses the staging worker (VITE_API_URL_PREVIEW), never production's.
  const api = buildApiUrl(mode, process.env, (m) => console.warn(m));
  if (mode === 'production') {
    // In the build log, so a build's server can be checked (an address, never a secret).
    const used = api ?? process.env.VITE_API_URL?.trim() ?? '';
    console.log(`Build of ${process.env.CF_PAGES_BRANCH ?? '(not on Pages)'}: game server ${used || 'none'}`);
  }
  // The build, for Report an issue and the update check: Cloudflare Pages sets the commit it builds.
  const build = process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? 'dev';
  return {
    plugins: [
      preact(),
      {
        // The guess list holds every secret word too: the app ships each word once (about 5 KB less to
        // download), and src/game/wordLists.ts merges the two lists back. The worker's bundle keeps the whole list.
        name: 'guess-list-without-secrets',
        enforce: 'pre',
        load(id) {
          if (!id.endsWith('/wordlist/lists/guess.txt?raw')) return null;
          const secrets = new Set(readFileSync(resolve(import.meta.dirname, 'wordlist/lists/secret.txt'), 'utf8').split('\n'));
          const guesses = readFileSync(id.slice(0, -'?raw'.length), 'utf8').split('\n').filter((w) => w !== '' && !secrets.has(w));
          return `export default ${JSON.stringify(`${guesses.join('\n')}\n`)};`;
        },
      },
      {
        // The definitions, one chunk per first letter (Dev Plan item 19zn): the first ⓘ tap loads 1 to 30 kB (gzipped)
        // rather than all 212 kB. Each virtual module is that letter's slice of wordlist/lists/definitions.json,
        // which stays as it is. "definitions" stays in the chunks' names for npm run check:size.
        name: 'definitions-by-letter',
        resolveId(id) {
          return /^virtual:definitions-[a-z]$/.test(id) ? `\0${id}` : null;
        },
        load(id) {
          const letter = /^\0virtual:definitions-([a-z])$/.exec(id)?.[1];
          if (!letter) return null;
          const all = JSON.parse(readFileSync(resolve(import.meta.dirname, 'wordlist/lists/definitions.json'), 'utf8')) as Record<string, unknown>;
          const slice = Object.fromEntries(Object.entries(all).filter(([word]) => word.startsWith(letter)));
          return `export default ${JSON.stringify(JSON.stringify(slice))};`;
        },
      },
      {
        // The app reads this to find out a newer build is out (issue #136, src/app/appUpdate.ts).
        name: 'version-file',
        apply: 'build',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ version: APP_VERSION, build })}\n` });
        },
      },
    ],
    define: {
      'import.meta.env.VITE_APP_BUILD': JSON.stringify(build),
      // The version (src/app/version.ts), so the release notes needn't load to say it.
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
      ...(api !== undefined ? { 'import.meta.env.VITE_API_URL': JSON.stringify(api) } : {}),
    },
    build: {
      // The app, and the usage dashboard (Dev Plan item 18m) at /admin/, behind Cloudflare Access.
      // Legal (/*!) comments stay: the word lists' ESDB notice ships with them (issue 229; npm run check:size checks).
      rollupOptions: {
        input: { main: 'index.html', admin: 'admin/index.html' },
        output: {
          comments: { legal: true },
          // Everything of the app's own that loads at start-up goes in one file, not one per set of the lazy
          // screens (src/app/screens.ts) that share it. Preact and the fonts stay apart: the dashboard shares them.
          codeSplitting: {
            groups: [
              { name: 'shared', test: /node_modules/, priority: 1 },
              { debugName: 'app', name: (id: string, graph: ChunkGraph) => (!id.includes('node_modules') && startUpOf(graph).has(id) ? 'app' : null) },
            ],
          },
        },
      },
      // The definitions are 26 lazy-loaded chunks (above); every chunk stays well under the default limit.
    },
    test: {
      // e2e/ is Playwright's (npm run e2e), and its build is dist-e2e/.
      exclude: ['**/node_modules/**', 'e2e/**', 'dist-e2e/**'],
    },
  };
});
