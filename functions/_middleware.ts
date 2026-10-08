/*
 * A Cloudflare Pages Function in front of the app's pages (Dev Plan item
 * 18j). From 18f's day, the old address answers with a permanent (301)
 * redirect to the same page on wordmastermind.app, so search engines move
 * its ranking to the new address; the app's own redirect (src/main.tsx)
 * stays for a page already open. Everything else is served as before, with
 * public/_headers. public/_routes.json runs it for page addresses only.
 */
import { newAddress, redirectDue } from '../src/app/moved';

interface Context {
  request: Request;
  next: () => Promise<Response>;
}

export async function onRequest({ request, next }: Context): Promise<Response> {
  const url = new URL(request.url);
  if (redirectDue(url.hostname, Date.now())) return Response.redirect(newAddress(url), 301);
  return next();
}
