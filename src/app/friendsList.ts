import { useEffect, useRef, useState } from 'preact/hooks';
import type { ApiIdentity } from './apiIdentity';
import { friendsApi, type FriendsList } from './friendsApi';

/**
 * Your friends list from the server, loaded once `identity` is signed in,
 * and again whenever you come back to the page. Null until it arrives, or
 * without a session.
 */
export function useFriendsList(apiUrl: string | null, identity: ApiIdentity): [FriendsList | null, (list: FriendsList) => void] {
  const [list, setListState] = useState<FriendsList | null>(null);
  /** Bumped by each change's answer, so a look that set out before it can't put back the older list. */
  const changes = useRef(0);
  const setList = (next: FriendsList) => {
    changes.current++;
    setListState(next);
  };
  useEffect(() => {
    if (!apiUrl || !identity.token) {
      setListState(null);
      return;
    }
    let live = true;
    const api = friendsApi(apiUrl, identity);
    const look = () => {
      const before = changes.current;
      void api.list().then((l) => live && changes.current === before && setListState(l), () => {});
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
  }, [apiUrl, identity]);
  return [list, setList];
}
