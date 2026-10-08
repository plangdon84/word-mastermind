import { json } from './http';
import type { Env } from './index';
import { notifyGuest } from './push';
import { vapidKeysOf } from './pushRoutes';
import { ratingsOf } from './ratings';
import { currentNames } from './sync';
import { ratingPool } from '../../src/game';
import { handleAlarm, handleRoom, mayChange, saveFinishedGame, type RoomDeps, type RoomRequest } from './room';

/** Most open pages one game tells about its moves; a new one past this closes the oldest. */
const MAX_SOCKETS = 8;

/**
 * One Durable Object per game against a friend: the game's referee
 * (`room.ts`). Cloudflare runs one instance per game ID, anywhere in the
 * world, and handles its requests one at a time, so two moves can't race.
 * The worker (`index.ts`) checks each request before passing it on. Its
 * alarm enforces the time per guess, even when nobody has the game open.
 * Open game pages keep a WebSocket to it, and it says "changed" down each
 * after every move, so a live game's clocks and guesses show at once. It
 * uses the hibernation API: an idle game with open pages costs nothing, and
 * the pages' "ping" keep-alives are answered without waking it.
 */
export class GameRoom implements DurableObject {
  private readonly deps: RoomDeps;

  constructor(private readonly state: DurableObjectState, env: Env) {
    this.deps = {
      saveFinished: (room, record, now) => saveFinishedGame(env.DB, room, record, now),
      namesOf: (ids) => currentNames(env.DB, ids),
      ratingsOf: (players, control, now) => ratingsOf(env.DB, players, ratingPool(control), now),
      random: Math.random,
      // Sent after the answer; the Durable Object stays alive until they're done.
      notify: (notices) => {
        const keys = vapidKeysOf(env);
        if (!keys) return;
        for (const { guestId, message } of notices) {
          state.waitUntil(notifyGuest(env.DB, keys, guestId, message, Date.now()).catch(() => {}));
        }
      },
    };
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.openSocket();
    const roomRequest = await request.json<RoomRequest>();
    const { status, body } = await handleRoom(this.state.storage, this.deps, roomRequest, Date.now());
    if (mayChange(roomRequest) && status < 300) this.tellPages();
    return json(body, status);
  }

  /** Set by the referee for the player to move's deadline: if they haven't moved, they concede. */
  async alarm(): Promise<void> {
    await handleAlarm(this.state.storage, this.deps, Date.now());
    this.tellPages();
  }

  private openSocket(): Response {
    const open = this.state.getWebSockets();
    for (const old of open.slice(0, Math.max(0, open.length - MAX_SOCKETS + 1))) old.close(1008, 'Too many open pages');
    const { 0: page, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: page });
  }

  /** Every open page looks at the game again. */
  private tellPages(): void {
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send('changed');
      } catch {
        // Already closing; the page reconnects.
      }
    }
  }

  async webSocketMessage(): Promise<void> {
    // Pages only send keep-alives, answered automatically.
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    socket.close(code === 1005 ? 1000 : code, 'Closed');
  }
}
