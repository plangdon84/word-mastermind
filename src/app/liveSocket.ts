import { useEffect, useRef } from 'preact/hooks';

/** How often an open socket says "ping", so proxies don't close it for being idle. */
const PING_MS = 30_000;
/** The longest wait before reconnecting a dropped socket. */
const MAX_RETRY_MS = 30_000;

/**
 * Keeps a WebSocket open to a game on the server (`liveSocketUrl`) while
 * `url` is set, calling `onChanged` whenever the game changes, and once each
 * time it (re)connects, in case a move was missed. A dropped socket
 * reconnects, waiting longer each time. The socket carries no game data: the
 * page fetches the game itself.
 */
export function useLiveSocket(url: string | null, onChanged: () => void): void {
  const handler = useRef(onChanged);
  handler.current = onChanged;
  useEffect(() => {
    if (!url || typeof WebSocket === 'undefined') return;
    let socket: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let wait = 1000;
    const open = () => {
      socket = new WebSocket(url);
      socket.onopen = () => {
        wait = 1000;
        handler.current();
      };
      socket.onmessage = (e) => {
        if (e.data === 'changed') handler.current();
      };
      socket.onclose = () => {
        if (closed) return;
        retry = setTimeout(open, wait);
        wait = Math.min(wait * 2, MAX_RETRY_MS);
      };
    };
    open();
    const ping = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send('ping');
    }, PING_MS);
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(ping);
      socket?.close();
    };
  }, [url]);
}
