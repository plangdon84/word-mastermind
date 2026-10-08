import { describe, expect, it } from 'vitest';
import { friendApi, FriendApiError, type FriendApi } from '../../src/app/friendApi';
import { DAY_MS, MINUTE_MS, replayPvp, type PvpRecord, type TimeControl } from '../../src/game';
import { fakeD1 } from './fakeD1';
import { fakeRooms } from './fakeRooms';
import { handle, type Env } from './index';

const HOST = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const GUEST = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const STRANGER = '9f8e7d6c-5b4a-4c3d-a2e1-f0e9d8c7b6a5';
const NOW = Date.UTC(2026, 8, 28);

function setup(random = () => 0) {
  const { db, sqlite } = fakeD1();
  let clock = NOW;
  const { namespace, rooms, runAlarms, notices } = fakeRooms({ db, now: () => clock, random });
  const env: Env = { DB: db, GAMES: namespace, DAILY: undefined as unknown as DurableObjectNamespace, LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: '' };
  // The app's own client, answered by the worker in process.
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init), env, clock)) as typeof fetch;
  const as = (guestId: string): FriendApi => friendApi('https://api.example', { guestId, token: null }, fetchFn);
  /** Notifications sent since the last call, as [who, title, body]. */
  const sent = () => notices.splice(0).map((n) => [n.guestId === HOST ? 'host' : 'guest', n.message.title, n.message.body]);
  return { env, sqlite, as, rooms, runAlarms, sent, tick: (ms: number) => { clock += ms; } };
}

const invite = { name: 'Ann', secret: 'storm', difficulty: 'medium', timeControl: '1d' } as const;
const answer = { name: 'Bob', secret: 'beach', difficulty: 'hard' } as const;

/** The error a call rejects with. */
async function refusal(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (e) {
    if (e instanceof FriendApiError) return e.code;
    throw e;
  }
  throw new Error('the call was accepted');
}

describe('inviting a friend', () => {
  it('creates a game waiting for the friend, with an unguessable ID', async () => {
    const { as } = setup();
    const game = await as(HOST).create(invite);
    expect(game).toMatchObject({ seat: 'host', state: 'waiting', hostName: 'Ann', guestName: null, timeControl: '1d', view: null });
    expect(game.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a secret word the rules don't allow", async () => {
    const { as } = setup();
    expect(await refusal(as(HOST).create({ ...invite, secret: 'bunny' }))).toBe('repeated-letters');
    expect(await refusal(as(HOST).create({ ...invite, secret: 'nacre' }))).toBe('not-in-word-list');
  });

  it('refuses a malformed invite', async () => {
    const { as } = setup();
    expect(await refusal(as(HOST).create({ ...invite, timeControl: '2d' as '1d' }))).toBe('bad-request');
    expect(await refusal(as(HOST).create({ ...invite, name: 'x' }))).toBe('bad-request');
    expect(await refusal(as('nobody').create(invite))).toBe('bad-guest-id');
  });

  it('shows the invite to whoever opens the link, without the game', async () => {
    const { as } = setup();
    const { id } = await as(HOST).create(invite);
    expect(await as(GUEST).get(id)).toMatchObject({ seat: null, state: 'waiting', hostName: 'Ann', view: null });
    expect(JSON.stringify(await as(GUEST).get(id))).not.toContain('storm');
  });

  it("answers an unknown game with not-found", async () => {
    const { as } = setup();
    expect(await refusal(as(HOST).get('b'.repeat(64)))).toBe('not-found');
    expect(await refusal(as(HOST).get('not-an-id'))).toBe('not-found');
  });
});

describe('accepting an invite', () => {
  it('starts the game, with the first player picked at random', async () => {
    const { as } = setup(() => 0.9);
    const { id } = await as(HOST).create(invite);
    const game = await as(GUEST).join(id, answer);
    expect(game).toMatchObject({ seat: 'guest', state: 'playing', guestName: 'Bob' });
    expect(game.view).toMatchObject({ first: 'you', turn: 'you', yourSecret: 'beach', theirSecret: null, difficulty: 'hard' });
    expect((await as(HOST).get(id)).view).toMatchObject({ first: 'opponent', turn: 'opponent', yourSecret: 'storm' });
  });

  it('is open to one friend only, and not to the host', async () => {
    const { as } = setup();
    const { id } = await as(HOST).create(invite);
    expect(await refusal(as(HOST).join(id, answer))).toBe('own-invite');
    await as(GUEST).join(id, answer);
    expect(await refusal(as(STRANGER).join(id, answer))).toBe('invite-taken');
    // Accepting twice (a double tap) just shows the game.
    expect((await as(GUEST).join(id, answer)).state).toBe('playing');
  });

  it("refuses a secret word the rules don't allow, leaving the invite open", async () => {
    const { as } = setup();
    const { id } = await as(HOST).create(invite);
    expect(await refusal(as(GUEST).join(id, { ...answer, secret: 'bunny' }))).toBe('repeated-letters');
    expect((await as(GUEST).get(id)).state).toBe('waiting');
  });

  it('is closed once the host cancels the invite', async () => {
    const { as } = setup();
    const { id } = await as(HOST).create(invite);
    expect((await as(HOST).concede(id)).state).toBe('cancelled');
    expect(await refusal(as(GUEST).join(id, answer))).toBe('invite-closed');
  });
});

describe('playing', () => {
  async function started() {
    const s = setup();
    const { id } = await s.as(HOST).create(invite);
    await s.as(GUEST).join(id, answer);
    return { ...s, id };
  }

  it('takes turns, scoring each guess against the other word', async () => {
    const { as, id } = await started();
    expect(await refusal(as(GUEST).guess(id, 'crane'))).toBe('not-your-turn');
    const after = await as(HOST).guess(id, 'bunny');
    expect(after.view).toMatchObject({ yourGuesses: [{ guess: 'bunny', score: 1, isWin: false }], turn: 'opponent' });
    expect((await as(GUEST).get(id)).view).toMatchObject({ theirGuesses: [{ guess: 'bunny', score: 1 }], turn: 'you' });
  });

  it("refuses a guess that isn't a word, without using the turn", async () => {
    const { as, id } = await started();
    expect(await refusal(as(HOST).guess(id, 'qzxvj'))).toBe('not-in-word-list');
    expect((await as(HOST).get(id)).view?.turn).toBe('you');
  });

  it("keeps strangers out, and never shows them either word", async () => {
    const { as, id } = await started();
    expect(await refusal(as(STRANGER).guess(id, 'crane'))).toBe('not-a-player');
    const seen = await as(STRANGER).get(id);
    expect(seen).toMatchObject({ seat: null, state: 'playing', view: null });
    expect(JSON.stringify(seen)).not.toMatch(/storm|beach/);
  });

  it("shares a Medium player's marks with their opponent, and each player's difficulty", async () => {
    const { as, id } = await started();
    await as(HOST).guess(id, 'bunny', { b: 'in', u: 'out', zz: 'in' } as never);
    expect((await as(GUEST).get(id)).view).toMatchObject({ theirDifficulty: 'medium', theirMarks: { b: 'in', u: 'out' } });
    // The guest plays at Hard, so marks they send aren't kept.
    await as(GUEST).guess(id, 'crane', { c: 'in' });
    expect((await as(HOST).get(id)).view).toMatchObject({ theirDifficulty: 'hard', theirMarks: null });
  });

  it('refuses marks that are not an object', async () => {
    const { env, id } = await started();
    const response = await handle(new Request(`https://api.example/api/games/${id}/guess`, {
      method: 'POST', headers: { 'x-guest-id': HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ word: 'bunny', marks: ['b'] }),
    }), env, NOW);
    expect(response.status).toBe(400);
  });

  it('records difficulty changes per player', async () => {
    const { as, id } = await started();
    expect((await as(GUEST).setDifficulty(id, 'extreme')).view?.difficulty).toBe('extreme');
    expect((await as(HOST).get(id)).view?.difficulty).toBe('medium');
  });

  it('saves a finished game to the history, where it replays', async () => {
    const { as, id, sqlite } = await started();
    await as(HOST).guess(id, 'beach');
    const last = await as(GUEST).guess(id, 'crane');
    expect(last).toMatchObject({ state: 'over', view: { theirSecret: 'storm', outcome: { result: 'lost', reason: 'found' } } });
    const row = sqlite.prepare('SELECT mode, record, finished_at FROM games WHERE id = ?').get(id) as
      { mode: string; record: string; finished_at: number };
    expect(row.mode).toBe('friend');
    const replayed = replayPvp(JSON.parse(row.record) as PvpRecord);
    expect(replayed.ok && replayed.game.outcome).toEqual({ winner: 'host', reason: 'found' });
    const players = sqlite.prepare('SELECT guest_id FROM game_players WHERE game_id = ? ORDER BY guest_id').all(id);
    expect(players).toEqual([{ guest_id: HOST }, { guest_id: GUEST }].sort((a, b) => a.guest_id.localeCompare(b.guest_id)));
  });

  it('lets either player concede, which loses', async () => {
    const { as, id } = await started();
    const game = await as(GUEST).concede(id);
    expect(game.view?.outcome).toEqual({ result: 'lost', reason: 'conceded' });
    expect((await as(HOST).get(id)).view?.outcome).toEqual({ result: 'won', reason: 'conceded' });
    expect(await refusal(as(HOST).guess(id, 'beach'))).toBe('game-over');
  });
});

describe('the time per guess', () => {
  async function started(timeControl: TimeControl = '1d') {
    const s = setup();
    const { id } = await s.as(HOST).create({ ...invite, timeControl });
    await s.as(GUEST).join(id, answer);
    return { ...s, id };
  }

  it('is shown to both players as a deadline, reset by each guess', async () => {
    const { as, id, tick } = await started();
    expect((await as(HOST).get(id)).view?.deadline).toBe(NOW + DAY_MS);
    tick(60_000);
    await as(HOST).guess(id, 'crane');
    expect((await as(GUEST).get(id)).view?.deadline).toBe(NOW + 60_000 + DAY_MS);
  });

  it("concedes for a player who runs out, when the room's alarm goes off", async () => {
    const { as, id, tick, rooms, runAlarms, sqlite } = await started('3d');
    expect(rooms.get(id)?.alarm).toBe(NOW + 3 * DAY_MS);
    tick(3 * DAY_MS);
    await runAlarms();
    expect(rooms.get(id)?.alarm).toBeNull();
    expect((await as(GUEST).get(id)).view?.outcome).toEqual({ result: 'won', reason: 'timed-out' });
    expect((await as(HOST).get(id)).view).toMatchObject({ outcome: { result: 'lost', reason: 'timed-out' }, deadline: null });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM games WHERE id = ?').get(id)).toEqual({ n: 1 });
  });

  it('is enforced on the next request if the alarm is late', async () => {
    const { as, id, tick } = await started();
    tick(DAY_MS + 1);
    expect(await refusal(as(HOST).guess(id, 'crane'))).toBe('game-over');
    expect((await as(HOST).get(id)).view?.outcome).toEqual({ result: 'lost', reason: 'timed-out' });
  });

  it("doesn't start until the invite is accepted", async () => {
    const { as, rooms, tick } = setup();
    const { id } = await as(HOST).create(invite);
    tick(DAY_MS - 1);
    await as(GUEST).join(id, answer);
    // The invite's alarm is replaced by the first player's deadline.
    expect(rooms.get(id)?.alarm).toBe(NOW + DAY_MS - 1 + DAY_MS);
  });
});

describe('live games', () => {
  async function started(random = () => 0) {
    const s = setup(random);
    const { id } = await s.as(HOST).create({ ...invite, timeControl: '5m' });
    await s.as(GUEST).join(id, answer);
    return { ...s, id };
  }

  it("run each player's chess clock only on their turn, with the server's time to allow for the device's", async () => {
    const { as, id, tick } = await started();
    expect(await as(GUEST).get(id)).toMatchObject({
      timeControl: '5m', serverNow: NOW, view: { deadline: NOW + 5 * MINUTE_MS, clocks: { you: 5 * MINUTE_MS, opponent: 5 * MINUTE_MS } },
    });
    tick(40_000);
    await as(HOST).guess(id, 'crane');
    tick(10_000);
    expect((await as(HOST).get(id)).view).toMatchObject({
      turn: 'opponent', deadline: NOW + 40_000 + 5 * MINUTE_MS, clocks: { you: 5 * MINUTE_MS - 40_000, opponent: 5 * MINUTE_MS },
    });
  });

  it("lose on time when the room's alarm goes off at a clock's end", async () => {
    const { as, id, tick, rooms, runAlarms, sent } = await started();
    sent();
    await as(HOST).guess(id, 'crane');
    expect(rooms.get(id)?.alarm).toBe(NOW + 5 * MINUTE_MS);
    tick(5 * MINUTE_MS);
    await runAlarms();
    expect((await as(HOST).get(id)).view?.outcome).toEqual({ result: 'won', reason: 'timed-out' });
    // Both are watching a live game, so a guess isn't notified; its end is.
    expect(sent()).toEqual([['host', 'Bob ran out of time', 'You win!'], ['guest', 'You ran out of time against Ann', 'Ann wins.']]);
  });

  it('tell the host their clock is running when the invite is accepted', async () => {
    expect((await started()).sent()).toEqual([['host', 'Bob accepted your invite', 'You go first, and your clock is running.']]);
  });

  it('have invite links that expire after an hour', async () => {
    const { as } = setup();
    const game = await as(HOST).create({ ...invite, timeControl: '15m' });
    expect(game.expiresAt).toBe(NOW + 60 * MINUTE_MS);
  });

  it('still take an invite from an app that sends days per guess', async () => {
    const { env } = setup();
    const response = await handle(new Request('https://api.example/api/games', {
      method: 'POST', headers: { 'x-guest-id': HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ann', secret: 'storm', difficulty: 'medium', turnDays: 3 }),
    }), env, NOW);
    expect(await response.json()).toMatchObject({ timeControl: '3d' });
  });

  it("refuse an open page's WebSocket from another site", async () => {
    const { env } = setup();
    const socket = (origin: string) => handle(new Request(`https://api.example/api/games/${'a'.repeat(64)}/live`, {
      headers: { upgrade: 'websocket', origin },
    }), { ...env, ALLOWED_ORIGINS: 'https://word-mastermind.pages.dev' }, NOW);
    expect((await socket('https://evil.example')).status).toBe(403);
  });
});

describe('invites', () => {
  it('expire after 24 hours, telling the host', async () => {
    const { as, rooms, tick, runAlarms, sent } = setup();
    const { id, expiresAt } = await as(HOST).create(invite);
    expect(expiresAt).toBe(NOW + DAY_MS);
    expect(rooms.get(id)?.alarm).toBe(NOW + DAY_MS);
    tick(DAY_MS);
    await runAlarms();
    expect(await as(HOST).get(id)).toMatchObject({ state: 'expired', expiresAt: null });
    expect(sent()).toEqual([['host', 'Your invite expired', 'Nobody accepted it within 24 hours. Send a new one to play.']]);
    expect(await refusal(as(GUEST).join(id, answer))).toBe('invite-expired');
    expect(await refusal(as(HOST).concede(id))).toBe('invite-expired');
  });

  it('expire on the next request if the alarm is late', async () => {
    const { as, tick } = setup();
    const { id } = await as(HOST).create(invite);
    tick(DAY_MS + 5);
    expect(await refusal(as(GUEST).join(id, answer))).toBe('invite-expired');
  });

  it('stop expiring once cancelled', async () => {
    const { as, rooms } = setup();
    const { id } = await as(HOST).create(invite);
    await as(HOST).concede(id);
    expect(rooms.get(id)?.alarm).toBeNull();
  });
});

describe('turn notifications', () => {
  async function started(random: () => number) {
    const s = setup(random);
    const { id } = await s.as(HOST).create(invite);
    await s.as(GUEST).join(id, answer);
    return { ...s, id };
  }

  it('tell the host their invite was accepted, and who goes first', async () => {
    expect((await started(() => 0)).sent()).toEqual([['host', 'Bob accepted your invite', 'You go first. You have 1 day to guess.']]);
    expect((await started(() => 0.9)).sent()).toEqual([['host', 'Bob accepted your invite', 'Bob goes first.']]);
  });

  it("tell the other player it's their turn, with the guess and its score", async () => {
    const { as, id, sent } = await started(() => 0);
    sent();
    await as(HOST).guess(id, 'bunny');
    expect(sent()).toEqual([['guest', 'Your turn against Ann', 'Ann guessed BUNNY – 1. You have 1 day to reply.']]);
    await as(GUEST).setDifficulty(id, 'medium');
    expect(sent()).toEqual([]);
  });

  it('announce a last chance, and how the game ended', async () => {
    const { as, id, sent } = await started(() => 0);
    await as(HOST).guess(id, 'beach');
    expect(sent().at(-1)).toEqual(['guest', 'Last chance against Ann', 'Ann found BEACH. One guess to tie the game.']);
    await as(GUEST).guess(id, 'storm');
    expect(sent()).toEqual([['host', 'Bob tied it', "Bob found STORM with their last guess. It's a draw."]]);
  });

  it('tell the loser their word was found', async () => {
    const { as, id, sent } = await started(() => 0);
    await as(HOST).guess(id, 'crane');
    await as(GUEST).guess(id, 'storm');
    expect(sent().at(-1)).toEqual(['host', 'Bob found your word', 'Bob found STORM in 1 guess. You lose.']);
  });

  it('tell the winner of a final guess that missed', async () => {
    const { as, id, sent } = await started(() => 0);
    await as(HOST).guess(id, 'beach');
    await as(GUEST).guess(id, 'crane');
    expect(sent().at(-1)).toEqual(['host', 'You beat Bob', 'Their last guess, CRANE, missed. You win!']);
  });

  it('tell the other player about a give-up, and both about a timeout', async () => {
    const giveUp = await started(() => 0);
    await giveUp.as(GUEST).concede(giveUp.id);
    expect(giveUp.sent().at(-1)).toEqual(['host', 'Bob gave up', 'You win!']);

    const late = await started(() => 0);
    late.sent();
    late.tick(DAY_MS);
    await late.runAlarms();
    expect(late.sent()).toEqual([
      ['guest', 'Ann ran out of time', 'You win!'],
      ['host', 'You ran out of time against Bob', 'Bob wins.'],
    ]);
  });

  it("aren't sent for a cancelled invite", async () => {
    const { as, sent } = setup();
    const { id } = await as(HOST).create(invite);
    await as(HOST).concede(id);
    expect(sent()).toEqual([]);
  });
});

describe('rematch', () => {
  /** A finished game: Ann (host, Medium) goes first and finds Bob's word; Bob (Hard) misses his last guess. */
  async function finished() {
    const s = setup();
    const { id } = await s.as(HOST).create(invite);
    await s.as(GUEST).join(id, answer);
    await s.as(HOST).guess(id, 'beach');
    await s.as(GUEST).guess(id, 'crane');
    s.sent();
    return { ...s, id };
  }
  const again = { name: 'Bob', secret: 'crane' };

  it('challenges the other player only, with the same clock and each side keeping their difficulty', async () => {
    const { as, id, sqlite } = await finished();
    const rematch = await as(GUEST).rematch(id, again);
    expect(rematch).toMatchObject({
      seat: 'host', state: 'waiting', hostName: 'Bob', inviteeName: 'Ann', timeControl: '1d', rematchOf: id, rated: false,
    });
    expect(await as(HOST).get(rematch.id)).toMatchObject({ seat: null, invitedYou: true, inviteeDifficulty: 'medium' });
    expect(await as(STRANGER).get(rematch.id)).toMatchObject({ invitedYou: false });
    expect(await refusal(as(STRANGER).join(rematch.id, { ...answer, name: 'Cat' }))).toBe('not-invited');
    // It's in Ann's list of games at once.
    expect((await as(HOST).list()).map((g) => g.id)).toContain(rematch.id);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM friend_game_players WHERE game_id = ?').get(rematch.id)).toEqual({ n: 2 });
    // Ann accepts at Hard on this device, but keeps her Medium from the last game.
    const joined = await as(HOST).join(rematch.id, { name: 'Ann', secret: 'storm', difficulty: 'hard' });
    expect(joined).toMatchObject({ seat: 'guest', state: 'playing', view: { difficulty: 'medium' } });
    expect((await as(GUEST).get(rematch.id)).view).toMatchObject({ difficulty: 'hard', yourSecret: 'crane' });
  });

  it('shows on the old game to both players', async () => {
    const { as, id } = await finished();
    const rematch = await as(GUEST).rematch(id, again);
    expect((await as(GUEST).get(id)).rematch).toEqual({ id: rematch.id, byYou: true });
    expect((await as(HOST).get(id)).rematch).toEqual({ id: rematch.id, byYou: false });
    expect((await as(STRANGER).get(id)).rematch).toBeNull();
  });

  it('is one per game: asking again shows it, and asking second accepts the first with your word', async () => {
    const { as, id } = await finished();
    const rematch = await as(GUEST).rematch(id, again);
    expect((await as(GUEST).rematch(id, again)).id).toBe(rematch.id);
    const accepted = await as(HOST).rematch(id, { name: 'Ann', secret: 'storm' });
    expect(accepted).toMatchObject({ id: rematch.id, seat: 'guest', state: 'playing' });
  });

  it('accepts the other rematch with your word when theirs is recorded while yours is being made', async () => {
    const s = await finished();
    // Ann's rematch is made and recorded just as Bob's new game is being made.
    const games = s.env.GAMES;
    let raced = false;
    s.env.GAMES = {
      ...games,
      newUniqueId: () => games.newUniqueId(),
      idFromString: (id: string) => games.idFromString(id),
      get: (id: DurableObjectId) => ({
        fetch: async (url: string, init: RequestInit) => {
          const body = JSON.parse(String(init.body)) as { action: string; rematchOf?: string };
          if (body.action === 'create' && body.rematchOf && !raced) {
            raced = true;
            await s.as(HOST).rematch(s.id, { name: 'Ann', secret: 'storm' });
          }
          return games.get(id).fetch(url, init);
        },
      }),
    } as unknown as DurableObjectNamespace;
    const joined = await s.as(GUEST).rematch(s.id, again);
    expect(joined).toMatchObject({ seat: 'guest', state: 'playing', hostName: 'Ann' });
    expect((await s.as(GUEST).get(s.id)).rematch).toEqual({ id: joined.id, byYou: false });
    // Only Ann's rematch is in Bob's list; his own was withdrawn before anyone was told.
    const listed = (await s.as(GUEST).list()).map((g) => g.id);
    expect(listed).toContain(joined.id);
    expect(listed.filter((id) => id !== s.id)).toEqual([joined.id]);
  });

  it('sends a new rematch when the other one closes while you are accepting it (#119)', async () => {
    const s = await finished();
    const theirs = await s.as(GUEST).rematch(s.id, again);
    // Bob's rematch runs out just as Ann's answer to it arrives.
    const games = s.env.GAMES;
    let raced = false;
    s.env.GAMES = {
      ...games,
      newUniqueId: () => games.newUniqueId(),
      idFromString: (id: string) => games.idFromString(id),
      get: (id: DurableObjectId) => ({
        fetch: async (url: string, init: RequestInit) => {
          const body = JSON.parse(String(init.body)) as { action: string };
          if (body.action === 'join' && id.toString() === theirs.id && !raced) {
            raced = true;
            s.tick(DAY_MS);
          }
          return games.get(id).fetch(url, init);
        },
      }),
    } as unknown as DurableObjectNamespace;
    const mine = await s.as(HOST).rematch(s.id, { name: 'Ann', secret: 'storm' });
    expect(raced).toBe(true);
    expect(mine).toMatchObject({ seat: 'host', state: 'waiting', inviteeName: 'Bob' });
    expect(mine.id).not.toBe(theirs.id);
    expect((await s.as(GUEST).get(s.id)).rematch).toEqual({ id: mine.id, byYou: false });
  });

  it("isn't recorded on the old game until its own game is made", async () => {
    const { as, id, env } = await finished();
    const room = env.GAMES.get(env.GAMES.idFromString(id));
    const planned = await room.fetch('https://room/', {
      method: 'POST', body: JSON.stringify({ action: 'rematch', guestId: GUEST, newId: 'f'.repeat(64), record: false }),
    });
    expect(await planned.json()).toMatchObject({ kind: 'new', id: 'f'.repeat(64) });
    // Planning alone (say the new game then failed to start) leaves the game free to rematch.
    expect((await as(HOST).get(id)).rematch).toBeNull();
    expect((await as(HOST).rematch(id, { name: 'Ann', secret: 'storm' })).state).toBe('waiting');
  });

  it('can be declined by the friend it is for, telling the sender', async () => {
    const { as, id, sent, rooms } = await finished();
    const rematch = await as(GUEST).rematch(id, again);
    expect(await refusal(as(STRANGER).decline(rematch.id))).toBe('not-invited');
    expect(await refusal(as(GUEST).decline(rematch.id))).toBe('not-invited');
    expect(await as(HOST).decline(rematch.id)).toMatchObject({ state: 'declined', invitedYou: false });
    expect(sent()).toEqual([['guest', 'Ann declined your rematch', 'Maybe another time.']]);
    expect(rooms.get(rematch.id)?.alarm).toBeNull();
    expect(await as(GUEST).get(rematch.id)).toMatchObject({ state: 'declined', expiresAt: null });
    expect(await refusal(as(HOST).join(rematch.id, { ...answer, name: 'Ann' }))).toBe('invite-closed');
    expect(await refusal(as(HOST).decline(rematch.id))).toBe('invite-closed');
    // Once declined, either player can ask for a new rematch.
    const another = await as(HOST).rematch(id, { name: 'Ann', secret: 'storm' });
    expect(another).toMatchObject({ seat: 'host', state: 'waiting', inviteeName: 'Bob' });
    expect(another.id).not.toBe(rematch.id);
    expect((await as(GUEST).get(id)).rematch).toEqual({ id: another.id, byYou: false });
  });

  it('expires like an invite, telling the sender', async () => {
    const { as, id, sent, tick, runAlarms } = await finished();
    const rematch = await as(GUEST).rematch(id, again);
    tick(DAY_MS);
    await runAlarms();
    expect(sent()).toEqual([['guest', 'Your rematch expired', "Ann didn't accept it within 24 hours. Send a new one to play."]]);
    expect((await as(GUEST).get(rematch.id)).state).toBe('expired');
    // A new one can be sent; one that's still open can't be replaced.
    const another = await as(GUEST).rematch(id, again);
    expect(another.id).not.toBe(rematch.id);
    expect((await as(GUEST).rematch(id, again)).id).toBe(another.id);
  });

  it("can't be sent again once its sender cancels it, so cancelling can't repeat the notification", async () => {
    const { as, id } = await finished();
    const rematch = await as(GUEST).rematch(id, again);
    expect((await as(GUEST).concede(rematch.id)).state).toBe('cancelled');
    expect((await as(GUEST).rematch(id, again))).toMatchObject({ id: rematch.id, state: 'cancelled' });
    expect(await refusal(as(HOST).rematch(id, { name: 'Ann', secret: 'storm' }))).toBe('invite-closed');
  });

  it("isn't open before the game is over, to strangers, or with a word the rules refuse", async () => {
    const s = setup();
    const { id } = await s.as(HOST).create(invite);
    expect(await refusal(s.as(HOST).rematch(id, again))).toBe('not-over');
    await s.as(GUEST).join(id, answer);
    expect(await refusal(s.as(HOST).rematch(id, again))).toBe('not-over');
    await s.as(GUEST).concede(id);
    expect(await refusal(s.as(STRANGER).rematch(id, again))).toBe('not-a-player');
    expect(await refusal(s.as(HOST).rematch(id, { ...again, secret: 'bunny' }))).toBe('repeated-letters');
    // A refused word leaves the rematch unasked.
    expect((await s.as(HOST).get(id)).rematch).toBeNull();
  });
});

describe('declining a challenge', () => {
  it("isn't possible for an invite link, which has no invitee", async () => {
    const { as } = setup();
    const { id } = await as(HOST).create(invite);
    expect(await refusal(as(GUEST).decline(id))).toBe('not-invited');
    expect((await as(GUEST).get(id)).state).toBe('waiting');
  });
});

describe('requests', () => {
  it('need a guest ID', async () => {
    const { env } = setup();
    const response = await handle(new Request('https://api.example/api/games', {
      method: 'POST', body: JSON.stringify(invite),
    }), env, NOW);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad-guest-id' });
  });
});
