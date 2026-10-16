/*
 * The usage dashboard's figures (Dev Plan item 18m), for the page at
 * /admin/. Cloudflare Access stands in front of /admin and adds its signed
 * token to each request it lets through; this passes that token on to the
 * worker's `GET /api/admin/figures`, which checks it itself
 * (worker/src/access.ts), and nothing else of the request. The site itself
 * uses the production worker; a preview, the staging one.
 */
import { STAGING_API_URL } from '../../src/buildApiUrl';

const PRODUCTION_API_URL = 'https://api.wordmastermind.app';
const ACCESS_HEADER = 'cf-access-jwt-assertion';

interface Context {
  request: Request;
}

export async function onRequestGet({ request }: Context): Promise<Response> {
  const api = new URL(request.url).hostname === 'wordmastermind.app' ? PRODUCTION_API_URL : STAGING_API_URL;
  const token = request.headers.get(ACCESS_HEADER);
  const answer = await fetch(`${api}/api/admin/figures`, { headers: token === null ? {} : { [ACCESS_HEADER]: token } });
  return new Response(answer.body, {
    status: answer.status,
    headers: {
      'content-type': answer.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}
