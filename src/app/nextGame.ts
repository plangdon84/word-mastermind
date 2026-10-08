import { useEffect, useState } from 'preact/hooks';
import { FriendApiError, type FriendApi, type FriendGame } from './friendApi';
import { loadFriendGames, mergeFriendGames, updateFriendGame } from './friendGames';

/** A game against a friend that's waiting on your guess. */
export const isYourTurn = (game: FriendGame) => game.state === 'playing' && game.view?.turn === 'you';

/**
 * The game to go to next: of your other games waiting on your guess, the
 * one whose time runs out first.
 */
export function pickNextGame(games: readonly FriendGame[], currentId: string | null): FriendGame | null {
  const waiting = games.filter((g) => g.id !== currentId && isYourTurn(g));
  waiting.sort((a, b) => (a.view?.deadline ?? Infinity) - (b.view?.deadline ?? Infinity));
  return waiting[0] ?? null;
}

/**
 * Loads each of your friend games still on (from this device's list) from
 * the server. A game the server no longer has, or that isn't yours, leaves
 * the list.
 */
export async function loadFriendGamesFromServer(api: FriendApi, ids: readonly string[]): Promise<FriendGame[]> {
  const loaded = await Promise.all(ids.map(async (id) => {
    try {
      return await api.get(id);
    } catch (e) {
      if (e instanceof FriendApiError && (e.code === 'not-found' || e.code === 'not-a-player')) {
        updateFriendGame(id, { done: true });
      }
      return null;
    }
  }));
  return loaded.filter((g): g is FriendGame => g !== null);
}

/**
 * Adds your games from your other devices (signed in) to this device's list.
 * Those already over are added as seen, so only games still on reach the
 * title screen. Returns how many were added.
 */
export async function syncFriendGames(api: FriendApi): Promise<number> {
  const known = new Set(loadFriendGames().map((e) => e.id));
  const listed = (await api.list()).filter((g) => !known.has(g.id));
  const found = await Promise.all(listed.map(async ({ id, addedAt }) => {
    try {
      const game = await api.get(id);
      return { id, addedAt, done: game.state !== 'waiting' && game.state !== 'playing' };
    } catch {
      return null;
    }
  }));
  return mergeFriendGames(found.filter((f) => f !== null));
}

/**
 * Your next game waiting on your guess, other than `currentId`, checked again
 * whenever `check` changes (after each of your moves, say) and when you come
 * back to the page. Null while there's none.
 */
export function useNextGame(api: FriendApi | null, currentId: string | null, check: unknown): FriendGame | null {
  const [next, setNext] = useState<FriendGame | null>(null);
  useEffect(() => {
    if (!api) return;
    let live = true;
    const look = () => {
      const ids = loadFriendGames().filter((e) => !e.done && e.id !== currentId).map((e) => e.id);
      void loadFriendGamesFromServer(api, ids).then((games) => live && setNext(pickNextGame(games, currentId)));
    };
    look();
    const onVisible = () => {
      if (document.visibilityState === 'visible') look();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [api, currentId, check]);
  return next;
}
