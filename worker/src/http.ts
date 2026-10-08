/** Small helpers for JSON responses and CORS. */

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export const errorResponse = (status: number, error: string) => json({ error }, status);

/** One DNS label, as Pages names a preview (`1a2b3c4d`, or a branch like `claude-item-13b`). */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Whether `origin` is one of `allowed` (a comma-separated list from the
 * ALLOWED_ORIGINS var). An entry `https://*.example.pages.dev` (staging's)
 * also allows any one-label subdomain of it, as Pages serves each preview:
 * `https://1a2b3c4d.example.pages.dev`, but not `example.pages.dev` itself
 * or anything deeper.
 */
export function isAllowedOrigin(origin: string, allowed: string): boolean {
  for (const entry of allowed.split(',').map((o) => o.trim()).filter((o) => o !== '')) {
    if (origin === entry) return true;
    const wildcard = /^(https:\/\/)\*\.(.+)$/.exec(entry);
    if (!wildcard || !origin.startsWith(wildcard[1]) || !origin.endsWith(`.${wildcard[2]}`)) continue;
    const label = origin.slice(wildcard[1].length, origin.length - wildcard[2].length - 1);
    if (LABEL.test(label)) return true;
  }
  return false;
}

/**
 * CORS headers for a request from `origin`, if it's allowed
 * (`isAllowedOrigin`). The app is served by Pages from another origin, so
 * browsers need these to call the API.
 */
export function corsHeaders(origin: string | null, allowed: string): Record<string, string> {
  if (origin === null || !isAllowedOrigin(origin, allowed)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-guest-id',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

/** Reads a JSON body, or returns null if it is missing or doesn't parse. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
