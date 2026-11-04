import { describe, expect, it } from 'vitest';
import { createLobby, joinLobby, playLobby, SECRET_WORDS, seatWords, startLobby, type LobbyRecord, type LobbyResult } from '../../src/game';
import { fakeD1 } from './fakeD1';
import { fakeLobbies } from './fakeLobbies';
import { memoryStorage } from './fakeRooms';
import { lobbyApi } from '../../src/app/lobbyApi';
import { handle, type Env } from './index';
import { checkedLobby, NO_NAME, shownName } from './names';
import { lobbyFinishedNotice, lobbyOverNotice, type Notice } from './notices';
import { handleRoom, type RoomDeps } from './room';

/*
 * Names the profanity filter now refuses (Dev Plan item 19v): a stored name
 * passed the filter when it was saved, but the filter can grow since, so
 * friend games and lobbies show such a name as "A player", as the boards do.
 */

const ANN = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const BOB = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const NOW = Date.UTC(2026, 10, 4, 12);
const WORDS = SECRET_WORDS.slice(0, 4);
/** A name the filter refuses today, as if it had been taken before the filter grew. */
const REFUSED = 'Shithead';

function must(result: LobbyResult): LobbyRecord {
  if (!result.ok) throw new Error(result.error);
  return result.lobby;
}

describe('a name the filter now refuses', () => {
  it('shows as "A player", and any other as itself', () => {
    expect(NO_NAME).toBe('A player');
    expect(shownName(REFUSED)).toBe(NO_NAME);
    expect(shownName('Ann')).toBe('Ann');
  });

  it("shows as \"A player\" in a friend game's names and notifications, from the name the room keeps", async () => {
    const storage = memoryStorage();
    const notices: Notice[] = [];
    // No account profile for either player: the names are the room's own.
    const deps: RoomDeps = {
      saveFinished: async () => null, namesOf: async () => ({}), friendCodes: async () => ({}),
      ratingsOf: async () => { throw new Error('unrated'); }, random: () => 0,
      notify: (sent) => notices.push(...sent), played: async () => {},
    };
    await handleRoom(storage, deps, {
      action: 'create', id: 'room', guestId: ANN, name: REFUSED, secret: 'brick', difficulty: 'medium', timeControl: '1d',
    }, NOW);
    const joined = await handleRoom(storage, deps, {
      action: 'join', guestId: BOB, name: 'Bob', secret: 'night', difficulty: 'medium',
    }, NOW);
    expect(joined.body).toMatchObject({ hostName: NO_NAME, guestName: 'Bob' });
    await handleRoom(storage, deps, { action: 'concede', guestId: ANN }, NOW + 1000);
    const toBob = notices.filter((n) => n.guestId === BOB).map((n) => n.message.title);
    expect(toBob).toContain(`${NO_NAME} gave up`);
    expect(JSON.stringify(notices)).not.toContain(REFUSED);
  });

  it("shows as \"A player\" in a lobby's notifications, but leaves computers' names alone", () => {
    let lobby = createLobby('ABCDEF', { id: ANN, name: REFUSED }, 'medium', NOW);
    lobby = must(joinLobby(lobby, { id: BOB, name: 'Bob' }, NOW));
    lobby = must(startLobby(lobby, ANN, WORDS, NOW, () => 0));
    const ann = lobby.game!.seats.findIndex((s) => s.id === ANN);
    seatWords(lobby.game!, ann).forEach((word, i) => {
      lobby = must(playLobby(lobby, ANN, { kind: 'guess', word }, NOW + 10_000 * (i + 1)));
    });
    expect(lobbyFinishedNotice(lobby, ANN, NOW + 41_000)[0].message.title).toBe(`${NO_NAME} finished the Crush`);
    lobby = must(playLobby(lobby, BOB, { kind: 'give-up' }, NOW + 50_000));
    const over = lobbyOverNotice(lobby, NOW + 51_000);
    expect(over.find((n) => n.guestId === BOB)!.message.body).toMatch(/^A player won with/);
    expect(JSON.stringify(over)).not.toContain(REFUSED);

    const seated = { ...lobby, game: { ...lobby.game!, seats: [...lobby.game!.seats, { ...lobby.game!.seats[0], id: 'computer-1', name: REFUSED, strength: 'skilled' as const }] } };
    expect(checkedLobby(seated).game!.seats.map((s) => s.name)).toEqual([NO_NAME, 'Bob', REFUSED]);
    expect(checkedLobby(lobby).players.map((p) => p.name)).toEqual([NO_NAME, 'Bob']);
  });

  it("shows as \"A player\" on a lobby's screen", async () => {
    const { db } = fakeD1();
    const lobbies = fakeLobbies({ db, now: () => NOW });
    const env: Env = {
      DB: db, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: undefined as unknown as DurableObjectNamespace,
      LOBBIES: lobbies.namespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: '',
    };
    const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init), env, NOW)) as typeof fetch;
    const as = (guestId: string) => lobbyApi('https://api.example', { guestId, token: null }, fetchFn);
    const { lobby } = await as(ANN).create('Ann', 'medium');
    await as(BOB).join(lobby.code, 'Bob');
    // The filter grew since Ann joined: the lobby keeps the name she joined under.
    for (const storage of lobbies.lobbies.values()) {
      const room = storage.data.get('lobby') as { lobby: LobbyRecord };
      storage.data.set('lobby', { ...room, lobby: { ...room.lobby, players: room.lobby.players.map((p) => (p.id === ANN ? { ...p, name: REFUSED } : p)) } });
    }
    const view = (await as(BOB).get(lobby.code)).lobby;
    expect(view.players.map((p) => p.name)).toEqual([NO_NAME, 'Bob']);
    expect(view.hostName).toBe(NO_NAME);
  });
});
