import type { DailyPlacement } from '../game';
import { localDay } from './badges';
import { FriendsApiError, type FriendsApi, type SharedSummary } from './friendsApi';
import type { HistoryGame } from './historyDb';
import { sharedSummary } from './sharedSummary';

/*
 * Sharing your profile with friends (Dev Plan item 18cb, README "Friends'
 * profiles"). The server can't work out stats and badges within a
 * request's limits, so this device does, as it does for your own profile,
 * and sends them; then it asks the server to index your games for friends
 * a few at a time until it's done. Signed in only.
 */

const SENT_KEY = 'word-mastermind:shared-profile:v1';
/** The most index requests one round makes (a wait for the rate limit counts as one): thousands of games a round. */
const MAX_INDEX_STEPS = 500;
/** How long an unchanged summary goes before it's sent again anyway. */
const RESEND_MS = 24 * 60 * 60 * 1000;
/** How long to wait when the server says too many requests: its limits count a minute. */
const LIMIT_WAIT_MS = 61_000;

/** A short fingerprint of what was last sent for this account, so an unchanged summary isn't sent again. */
function fingerprint(accountId: string, summary: SharedSummary): string {
  const text = `${accountId}\n${JSON.stringify(summary)}`;
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return `${text.length}:${hash}`;
}

/** The last round of sharing that finished: when, and what it last sent, when. */
interface Shared {
  print: string;
  sentAt: number;
  at: number;
}

function lastShared(): Shared | null {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(SENT_KEY) ?? 'null');
    return data && typeof data === 'object' && typeof (data as Shared).print === 'string' ? data as Shared : null;
  } catch {
    return null;
  }
}

function noteShared(value: Shared | null): void {
  try {
    if (value) localStorage.setItem(SENT_KEY, JSON.stringify(value));
    else localStorage.removeItem(SENT_KEY);
  } catch {
    // Browser storage can be blocked: the summary is then sent again next time.
  }
}

/** Forgets what was sent: signing out, so the next account's is sent. */
export const clearSharedState = () => noteShared(null);

/**
 * One round of sharing: indexes your games until the server has them all,
 * then sends your summary if it changed since last time, and notes when the
 * round finished. Rejects with a `FriendsApiError`; the next round tries
 * again.
 */
export async function shareProfile(
  api: FriendsApi, accountId: string, games: readonly HistoryGame[], placements: readonly DailyPlacement[], now: number,
  wait: (ms: number) => Promise<unknown> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  for (let steps = 0; steps < MAX_INDEX_STEPS; steps++) {
    try {
      if ((await api.indexStep()).done) break;
    } catch (e) {
      // A long first index can reach the server's limit of requests a minute: wait it out and carry on.
      if (!(e instanceof FriendsApiError && e.status === 429)) throw e;
      await wait(LIMIT_WAIT_MS);
    }
  }
  const summary = sharedSummary(games, placements, now, localDay);
  const print = fingerprint(accountId, summary);
  // Sent again at least once a day, in case the server lost it.
  const last = lastShared();
  const resend = last?.print !== print || !(now - last.sentAt <= RESEND_MS);
  if (resend) await api.share(summary);
  noteShared({ print, sentAt: resend ? now : last!.sentAt, at: now });
}
