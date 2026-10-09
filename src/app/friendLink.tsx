import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Friend } from './friendsApi';

/*
 * A friend's name opens their profile (Dev Plan item 18ca, README "Friends'
 * profiles"): in a game against them, a lobby's results and a board's
 * Friends view. The server marks a friend's name with their friend code,
 * since a name alone can be shared or changed; any other name is text.
 */

/** Opens a friend's profile over the screen it's tapped on; null where nothing may open one. */
export const OpenFriend = createContext<((friend: Friend) => void) | null>(null);

/** A player's name: a button opening their profile when the server marked it a friend's (`code`), else text. */
export function PlayerName({ name, code }: { name: string; code: string | null }) {
  const open = useContext(OpenFriend);
  if (!code || !open) return <>{name}</>;
  return (
    <button type="button" class="friend-name" title={`${name}'s profile`}
      onClick={() => open({ code, name, since: 0 })}>{name}</button>
  );
}
