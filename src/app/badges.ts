import { useEffect, useState } from 'preact/hooks';
import { BADGE_BY_ID, computeAchievements, type Badge, type DailyPlacement, type EarnedBadge } from '../game';
import { loadPlacements, savePlacements } from './dailyStorage';
import { loadAllMatching, whenSaved } from './historyDb';

/*
 * Which earned badges you've been told about (README "Achievements"). Badges
 * themselves are worked out from the history each time; this only remembers
 * the toast and the profile-icon dot: each badge is announced once, and stays
 * "new" until you open Achievements on your profile.
 */

const KEY = 'word-mastermind:badges:v1';

export interface BadgeNotices {
  /** Every badge a toast has announced, so a reloaded result screen doesn't announce it again. */
  announced: string[];
  /** Announced but not yet seen on the profile: these show the dot. */
  unseen: string[];
}

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && BADGE_BY_ID.has(id)))] : [];

export function parseBadgeNotices(raw: string | null): BadgeNotices {
  try {
    const data: unknown = raw ? JSON.parse(raw) : null;
    if (typeof data !== 'object' || data === null) return { announced: [], unseen: [] };
    const { announced, unseen } = data as Record<string, unknown>;
    return { announced: ids(announced), unseen: ids(unseen) };
  } catch {
    return { announced: [], unseen: [] };
  }
}

/** Browser storage can be missing or blocked (private windows), so failures are ignored. */
export function loadBadgeNotices(): BadgeNotices {
  try {
    return parseBadgeNotices(localStorage.getItem(KEY));
  } catch {
    return { announced: [], unseen: [] };
  }
}

const listeners = new Set<() => void>();

function saveBadgeNotices(notices: BadgeNotices): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(notices));
  } catch {
    // The dot is a convenience; badges are still worked out from the history.
  }
  for (const listener of listeners) listener();
}

/** Announces `ids`: they're remembered, and show the dot until Achievements is opened. Returns the ones not announced before. */
export function announceBadges(badgeIds: readonly string[]): string[] {
  const notices = loadBadgeNotices();
  const fresh = badgeIds.filter((id) => !notices.announced.includes(id));
  if (fresh.length > 0) {
    saveBadgeNotices({ announced: [...notices.announced, ...fresh], unseen: [...notices.unseen, ...fresh] });
  }
  return fresh;
}

/** Opening Achievements shows the new badges, so the dot goes. */
export function markBadgesSeen(): void {
  if (loadBadgeNotices().unseen.length > 0) saveBadgeNotices({ ...loadBadgeNotices(), unseen: [] });
}

/** Whether the profile icon shows its dot. */
export function useUnseenBadges(): boolean {
  const [unseen, setUnseen] = useState(() => loadBadgeNotices().unseen.length > 0);
  useEffect(() => {
    const update = () => setUnseen(loadBadgeNotices().unseen.length > 0);
    listeners.add(update);
    // Another tab can earn a badge too.
    window.addEventListener('storage', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return unseen;
}

/** A local day number from the browser's time zone, for the daily streak: days since 1970-01-01 there. */
export function localDay(ms: number): number {
  const d = new Date(ms);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** Every badge earned, from the whole history and your Daily Rush places. */
export async function loadEarnedBadges(): Promise<EarnedBadge[]> {
  const games = await loadAllMatching({});
  return computeAchievements(games.map((g) => ({ id: g.entry.id, replayed: g.replayed })), localDay, loadPlacements());
}

/**
 * Keeps your final Daily Rush places as the server sent them, and announces
 * a badge they earn (with the profile dot: there's no result screen when a
 * day's places become final at midnight).
 */
export function receivePlacements(placements: readonly DailyPlacement[]): void {
  savePlacements(placements);
  announceBadges(computeAchievements([], localDay, placements).map((b) => b.id));
}

/**
 * The badges the finished game `gameId` just earned, once it's saved; empty
 * until then, or with no game. Each is announced once.
 */
export function useBadgesEarnedBy(gameId: string | null): Badge[] {
  const [badges, setBadges] = useState<Badge[]>([]);
  useEffect(() => {
    setBadges([]);
    if (!gameId) return;
    let live = true;
    whenSaved(gameId)
      .then(loadEarnedBadges)
      .then((earned) => {
        const fresh = announceBadges(earned.filter((b) => b.gameId === gameId).map((b) => b.id));
        if (live) setBadges(fresh.map((id) => BADGE_BY_ID.get(id)!));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [gameId]);
  return badges;
}
