/**
 * The staging worker's address (worker/README.md "Staging"), which every
 * preview uses. Not a secret: every build's code contains its server's
 * address. It lives here rather than in a Pages variable because Pages no
 * longer offers preview-only variables.
 */
export const STAGING_API_URL = 'https://word-mastermind-api-staging.paul-m-langdon.workers.dev';

/** The production worker's own domain (Dev Plan item 18), as well as its `word-mastermind-api.…` address. */
const PRODUCTION_HOST = 'api.wordmastermind.app';

/**
 * The worker's address a build gets (`vite.config.ts`), from the build's
 * environment. Cloudflare Pages sets `CF_PAGES_BRANCH`, and its variables
 * are the same for every branch, so:
 *
 * - `main` (production), and any build outside Pages, uses `VITE_API_URL`
 *   as it is (`undefined` here leaves it alone).
 * - A preview (any other branch) uses the staging worker,
 *   `STAGING_API_URL` (or `VITE_API_URL_PREVIEW` if set, to try another),
 *   and never `VITE_API_URL`. If that names the production worker
 *   (`word-mastermind-api.…` or `api.wordmastermind.app`) or isn't an address, the preview is built
 *   without a server, so testing never touches production data.
 */
export function buildApiUrl(
  mode: string, env: Record<string, string | undefined>, warn: (message: string) => void = () => {},
): string | undefined {
  const branch = env.CF_PAGES_BRANCH;
  if (mode !== 'production' || !branch || branch === 'main') return undefined;
  const url = env.VITE_API_URL_PREVIEW?.trim() || STAGING_API_URL;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    warn(`Preview build of ${branch}: VITE_API_URL_PREVIEW isn't an address, so this build has no server.`);
    return '';
  }
  if (host.startsWith('word-mastermind-api.') || host === PRODUCTION_HOST) {
    warn(`Preview build of ${branch}: VITE_API_URL_PREVIEW is the production worker, so this build has no server.`);
    return '';
  }
  return url;
}
