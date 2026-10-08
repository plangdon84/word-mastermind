/*
 * The move to wordmastermind.app (Dev Plan item 18f, issue #92). The old
 * address, word-mastermind.pages.dev, keeps working, but each address has
 * its own browser storage, so players there are told the game has moved and
 * how to bring their games with them. Previews (`<id>.word-mastermind.pages.dev`)
 * never are.
 */

/** The old production address. A preview is a subdomain of it, so never matches. */
export const OLD_HOST = 'word-mastermind.pages.dev';

export const NEW_ORIGIN = 'https://wordmastermind.app';

/**
 * From this day (UTC), the old address sends you straight to the new one
 * instead of showing the popup. The owner sets it in the PR.
 */
export const REDIRECT_FROM = '2026-11-01';

const DONE_KEY = 'word-mastermind:moved-notice:v1';

export const isOldHost = (hostname: string): boolean => hostname === OLD_HOST;

/** Whether the old address should now send you on, at `now` (ms). */
export const redirectDue = (hostname: string, now: number): boolean =>
  isOldHost(hostname) && now >= Date.parse(`${REDIRECT_FROM}T00:00:00Z`);

/** The same page on the new address: an invite, lobby or sign-in link keeps working. */
export const newAddress = (location: Pick<Location, 'pathname' | 'search' | 'hash'>): string =>
  `${NEW_ORIGIN}${location.pathname}${location.search}${location.hash}`;

/** Whether the popup shows: on the old address, until Done. Browser storage can be blocked. */
export function movedNoticeDue(hostname: string): boolean {
  if (!isOldHost(hostname)) return false;
  try {
    return localStorage.getItem(DONE_KEY) !== 'done';
  } catch {
    return true;
  }
}

export function markMovedNoticeDone(): void {
  try {
    localStorage.setItem(DONE_KEY, 'done');
  } catch {
    // It shows again next visit; nothing else is lost.
  }
}
