import { json } from './http';
import type { Env } from './index';
import { handleLobby, handleLobbyAlarm, saveFinishedLobby, type LobbyDeps, type LobbyRequest } from './lobbyRoom';
import { notifyGuest } from './push';
import { vapidKeysOf } from './pushRoutes';

/**
 * One Durable Object per Rush with Friends or Competitive Rush lobby, named
 * by its join code: the lobby's referee (`lobbyRoom.ts`). Each request and
 * alarm is handled whole before the next starts (`blockConcurrencyWhile`),
 * even while it waits on D1, so two players' moves can't race and a game
 * ending is saved, rated and announced once. The worker
 * (`lobbyRoutes.ts`) checks each request before passing it on. Its alarm
 * announces computers finishing and ends the game when the time is up, even
 * when nobody has it open.
 */
export class RushLobby implements DurableObject {
  private readonly deps: LobbyDeps;

  constructor(private readonly state: DurableObjectState, env: Env) {
    this.deps = {
      random: Math.random,
      saveFinished: (lobby, endedAt) => saveFinishedLobby(env.DB, lobby, endedAt),
      // Sent after the answer; the Durable Object stays alive until they're done.
      notify: (notices) => {
        const keys = vapidKeysOf(env);
        if (!keys) return;
        for (const { guestId, message } of notices) {
          state.waitUntil(notifyGuest(env.DB, keys, guestId, message, Date.now()).catch(() => {}));
        }
      },
    };
  }

  async fetch(request: Request): Promise<Response> {
    const lobbyRequest = await request.json<LobbyRequest>();
    const { status, body } = await this.state.blockConcurrencyWhile(
      () => handleLobby(this.state.storage, this.deps, lobbyRequest, Date.now()));
    return json(body, status);
  }

  async alarm(): Promise<void> {
    await this.state.blockConcurrencyWhile(() => handleLobbyAlarm(this.state.storage, this.deps, Date.now()));
  }
}
