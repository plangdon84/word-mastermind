import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';
import { buildApiUrl } from './src/buildApiUrl';
import { APP_VERSION } from './src/app/releases';

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
      ...(api !== undefined ? { 'import.meta.env.VITE_API_URL': JSON.stringify(api) } : {}),
    },
    build: {
      // The definitions chunk (~700 kB, ~210 kB gzipped) is deliberately one
      // lazy-loaded file; everything else stays well under the default limit.
      chunkSizeWarningLimit: 800,
    },
    test: {
      // e2e/ is Playwright's (npm run e2e), and its build is dist-e2e/.
      exclude: ['**/node_modules/**', 'e2e/**', 'dist-e2e/**'],
    },
  };
});
