/*
 * The usage dashboard's figures (Dev Plan item 18m), for the page at
 * /admin/. Cloudflare Access stands in front of /admin and adds its signed
 * token to each request it lets through; this passes that token on to the
 * worker's `GET /api/admin/figures`, which checks it itself
 * (worker/src/access.ts), and nothing else of the request. The site itself
 * uses the production worker; a preview, the staging one; any other address
 * neither.
 */
import { STAGING_API_URL } from '../../src/buildApiUrl';

const PRODUCTION_API_URL = 'https://api.wordmastermind.app';
const PRODUCTION_HOSTS = ['wordmastermind.app', 'www.wordmastermind.app'];
/** Pages serves each preview at a subdomain of this (the bare address is the old site, now production's). */
const PREVIEW_SUFFIX = '.word-mastermind.pages.dev';
const ACCESS_HEADER = 'cf-access-jwt-assertion';

const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };

/** The worker for the address the page was opened at, or null for an address that's neither the site nor a preview. */
export function apiFor(hostname: string): string | null {
  if (PRODUCTION_HOSTS.includes(hostname)) return PRODUCTION_API_URL;
  if (hostname.endsWith(PREVIEW_SUFFIX)) return STAGING_API_URL;
  return null;
}

const error = (status: number, code: string) =>
  new Response(JSON.stringify({ error: code }), { status, headers: { 'content-type': 'application/json', ...HEADERS } });

interface Context {
  request: Request;
}

export async function onRequestGet({ request }: Context): Promise<Response> {
  const api = apiFor(new URL(request.url).hostname);
  if (api === null) return error(404, 'not-found');
  const token = request.headers.get(ACCESS_HEADER);
  let answer: Response;
  try {
    answer = await fetch(`${api}/api/admin/figures`, { headers: token === null ? {} : { [ACCESS_HEADER]: token } });
  } catch {
    return error(502, 'unreachable');
  }
  return new Response(answer.body, {
    status: answer.status,
    headers: { 'content-type': answer.headers.get('content-type') ?? 'application/json', ...HEADERS },
  });
}
