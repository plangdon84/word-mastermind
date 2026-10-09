import { describe, expect, it } from 'vitest';
import { authApi, type Session } from '../../src/app/account';
import { dailyApi } from '../../src/app/dailyApi';
import { friendApi, FriendApiError } from '../../src/app/friendApi';
import {
  friendsApi, FriendsApiError, isFriendCode, isInviteKey, loadFriendProfile, normalizeFriendCode, formatFriendCode,
} from '../../src/app/friendsApi';
import { addDays, dailyDay, type HistoryFilter } from '../../src/game';
import { dailyEntry, soloEntry } from '../../src/game/testGames';
import { lobbyApi, LobbyApiError } from '../../src/app/lobbyApi';
import { fetchRatings } from '../../src/app/ratingsApi';
import { syncApi } from '../../src/app/syncApi';
import { fakeD1 } from './fakeD1';
import { fakeLobbies } from './fakeLobbies';
import { fakeRooms } from './fakeRooms';
import { newFriendCode } from './friends';
import { handle, type Env } from './index';
import { saveSubscription, toBase64Url, topicOf, type VapidKeys } from './push';

/*
 * Friends (README "Friends"): signed-in players add each other by friend
 * code, then challenge each other or invite each other to a lobby.
 */

const NOW = Date.UTC(2026, 8, 28);
const APP = 'https://app.example';
const ANN = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const BOB = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const CAT = '9f8e7d6c-5b4a-4c3d-a2e1-f0e9d8c7b6a5';
const DAN = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

async function vapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  return { publicKey: toBase64Url(publicKey), privateKey: jwk.d!, subject: APP };
}

/** A device's push keys (p256dh, auth), as a browser makes them. */
async function deviceKeys(): Promise<{ p256dh: string; auth: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  return { p256dh: toBase64Url(p256dh), auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))) };
}

async function setup() {
  const { db, sqlite } = fakeD1();
  let clock = NOW;
  const { namespace: rooms } = fakeRooms({ db, now: () => clock });
  // Counts what's asked of game rooms, to check a friend's profile asks about each game once.
  let roomAsks = 0;
  const games = { ...rooms, get: (id: DurableObjectId) => {
    const room = rooms.get(id);
    return { fetch: (url: string, init: RequestInit) => (roomAsks++, room.fetch(url, init)) };
  } } as unknown as DurableObjectNamespace;
  const lobbies = fakeLobbies({ db, now: () => clock });
  const keys = await vapidKeys();
  const emails: string[] = [];
  /** Pushes sent, as [endpoint, topic] (a hash of what the notification is about: `topicOf`). */
  const pushes: [string, string][] = [];
  const outside = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith('https://fcm.googleapis.com/')) {
      pushes.push([String(url), new Headers(init?.headers).get('topic') ?? '']);
      return new Response(null, { status: 201 });
    }
    emails.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response('{}');
  }) as typeof fetch;
  const env: Env = {
    DB: db, GAMES: games, DAILY: undefined as unknown as DurableObjectNamespace, LOBBIES: lobbies.namespace, QUEUES: undefined as unknown as DurableObjectNamespace,
    ALLOWED_ORIGINS: APP, RESEND_API_KEY: 'key', EMAIL_FROM: 'play@example.com',
    VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: APP,
  };
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init), env, clock, outside)) as typeof fetch;
  const identity = (guestId: string, session: Session | null) => ({ guestId, token: session?.token ?? null });

  /** Signs a device in, with a synced name and a device that gets turn alerts. */
  const player = async (guestId: string, name: string) => {
    clock += 60_000;
    const email = `${name.toLowerCase()}@example.com`;
    await authApi('https://api.example', guestId, fetchFn).sendLink(email, APP);
    const token = /\?login=([\w-]+)/.exec(emails[emails.length - 1])![1];
    const session = await authApi('https://api.example', guestId, fetchFn).signIn(token);
    const id = identity(guestId, session);
    await syncApi('https://api.example', id, fetchFn).putProfile({
      guestName: 'Guest-1234', name, country: null, memberSince: NOW,
      settings: { difficulty: 'medium', newestFirst: { easy: false, medium: false, hard: false, extreme: false }, showTutorial: true, shareMarks: true },
    });
    await saveSubscription(db, guestId, { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, ...await deviceKeys() }, NOW);
    return {
      guestId,
      session,
      ratings: () => fetchRatings('https://api.example', id, fetchFn),
      friends: friendsApi('https://api.example', id, fetchFn),
      games: friendApi('https://api.example', id, fetchFn),
      lobbies: lobbyApi('https://api.example', id, fetchFn),
      sync: syncApi('https://api.example', id, fetchFn),
    };
  };
  /** Pushes sent since the last call, as [who, topic]. */
  const pushed = () => pushes.splice(0).map(([url, topic]) => [url.split('/').pop(), topic]);
  return {
    sqlite, fetchFn, player, pushed, guest: (guestId: string) => identity(guestId, null), now: () => clock, roomAsks: () => roomAsks,
  };
}

describe('friend codes', () => {
  it('are 8 letters and digits, read however they are typed', () => {
    const code = newFriendCode(() => 0.5);
    expect(isFriendCode(code)).toBe(true);
    expect(normalizeFriendCode(` ${formatFriendCode(code).toLowerCase()} `)).toBe(code);
    expect(normalizeFriendCode('ABCD-O1I0')).toBeNull();
  });
});

describe('the friends list', () => {
  it('is for accounts only', async () => {
    const { fetchFn, guest } = await setup();
    await expect(friendsApi('https://api.example', guest(ANN), fetchFn).list()).rejects.toMatchObject({ code: 'signed-out' });
  });

  it('adds a friend once they accept the request, telling each of them', async () => {
    const { player, pushed } = await setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const bobCode = (await bob.friends.list()).code;
    const annCode = (await ann.friends.list()).code;
    expect(annCode).not.toBe(bobCode);

    const sent = await ann.friends.add(bobCode);
    expect(sent.sent).toMatchObject([{ code: bobCode, name: 'Bob' }]);
    expect((await bob.friends.list()).received).toMatchObject([{ code: annCode, name: 'Ann' }]);
    expect(pushed()).toEqual([['Bob', await topicOf('friends')]]);

    // Adding again changes nothing; Bob adding Ann back accepts.
    await ann.friends.add(bobCode);
    expect(pushed()).toEqual([]);
    const accepted = await bob.friends.add(annCode);
    expect(accepted).toMatchObject({ friends: [{ code: annCode, name: 'Ann' }], received: [], sent: [] });
    expect((await ann.friends.list()).friends).toMatchObject([{ code: bobCode, name: 'Bob' }]);
    expect(pushed()).toEqual([['Ann', await topicOf('friends')]]);
  });

  it('refuses an unknown code or your own', async () => {
    const { player } = await setup();
    const ann = await player(ANN, 'Ann');
    const refusal = (call: Promise<unknown>) => call.then(() => 'accepted', (e: FriendsApiError) => e.code);
    expect(await refusal(ann.friends.add('ZZZZZZZZ'))).toBe('not-found');
    expect(await refusal(ann.friends.add((await ann.friends.list()).code))).toBe('own-code');
  });

  it('removes a friend, or a request, from both sides', async () => {
    const { player } = await setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const bobCode = (await bob.friends.list()).code;
    await ann.friends.add(bobCode);
    expect(await bob.friends.remove((await ann.friends.list()).code)).toMatchObject({ received: [] });
    expect((await ann.friends.list()).sent).toEqual([]);
  });
});

describe('private invite links', () => {
  const refusal = (call: Promise<unknown>) => call.then(() => 'accepted', (e: FriendsApiError) => e.code);

  it('make friends at once, telling the link\'s owner', async () => {
    const { player, pushed } = await setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const annList = await ann.friends.list();
    expect(isInviteKey(annList.invite)).toBe(true);
    expect(annList.invite).not.toBe((await bob.friends.list()).invite);
    pushed();

    const { list, friend } = await bob.friends.acceptInvite(annList.invite!);
    expect(friend).toMatchObject({ code: annList.code, name: 'Ann' });
    expect(list).toMatchObject({ friends: [{ code: annList.code, name: 'Ann' }], received: [], sent: [] });
    expect((await ann.friends.list()).friends).toMatchObject([{ name: 'Bob' }]);
    expect(pushed()).toEqual([['Ann', await topicOf('friends')]]);

    // Opening it again changes nothing, and tells nobody.
    expect((await bob.friends.acceptInvite(annList.invite!)).friend).toMatchObject({ name: 'Ann' });
    expect(pushed()).toEqual([]);
  });

  it("name their owner first, so the app can ask, and change nothing by it", async () => {
    const { player } = await setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const key = (await ann.friends.list()).invite!;
    expect(await bob.friends.peekInvite(key)).toEqual({ name: 'Ann' });
    expect((await bob.friends.list()).friends).toEqual([]);
    expect(await refusal(ann.friends.peekInvite(key))).toBe('own-code');
    expect(await refusal(bob.friends.peekInvite('ABCDEFGHJKLMNPQR'))).toBe('not-found');
  });

  it('settle a request either way', async () => {
    const { player } = await setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const annList = await ann.friends.list();
    await ann.friends.add((await bob.friends.list()).code);
    await bob.friends.acceptInvite(annList.invite!);
    expect(await ann.friends.list()).toMatchObject({ friends: [{ name: 'Bob' }], sent: [], received: [] });
    expect(await bob.friends.list()).toMatchObject({ friends: [{ name: 'Ann' }], sent: [], received: [] });
  });

  it('stop working once reset, and never add yourself', async () => {
    const { player } = await setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const old = (await ann.friends.list()).invite!;
    expect(await refusal(ann.friends.acceptInvite(old))).toBe('own-code');
    const reset = await ann.friends.resetInvite();
    expect(reset.invite).not.toBe(old);
    expect(await refusal(bob.friends.acceptInvite(old))).toBe('not-found');
    expect(await refusal(bob.friends.acceptInvite(reset.invite!))).toBe('accepted');
  });

  it('renew when you remove a friend, so the old link can\'t bring them back', async () => {
    const { player } = await setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const annList = await ann.friends.list();
    await bob.friends.acceptInvite(annList.invite!);
    const after = await ann.friends.remove((await bob.friends.list()).code);
    expect(after.friends).toEqual([]);
    expect(after.invite).not.toBe(annList.invite);
    expect(await refusal(bob.friends.acceptInvite(annList.invite!))).toBe('not-found');
  });

  it('are made once, however many ask at the same time', async () => {
    const { player } = await setup();
    const ann = await player(ANN, 'Ann');
    const lists = await Promise.all([ann.friends.list(), ann.friends.list(), ann.friends.list()]);
    expect(new Set(lists.map((l) => l.invite)).size).toBe(1);
    expect((await ann.friends.list()).invite).toBe(lists[0].invite);
  });

  it('are for accounts only', async () => {
    const { player, fetchFn, guest } = await setup();
    const ann = await player(ANN, 'Ann');
    const key = (await ann.friends.list()).invite!;
    expect(await refusal(friendsApi('https://api.example', guest(BOB), fetchFn).acceptInvite(key))).toBe('signed-out');
  });
});

describe('challenging a friend', () => {
  async function friends() {
    const s = await setup();
    const ann = await s.player(ANN, 'Ann');
    const bob = await s.player(BOB, 'Bob');
    const cat = await s.player(CAT, 'Cat');
    const bobCode = (await bob.friends.list()).code;
    await ann.friends.add(bobCode);
    await bob.friends.add((await ann.friends.list()).code);
    s.pushed();
    return { ...s, ann, bob, cat, bobCode };
  }
  const invite = { name: 'Ann', secret: 'storm', difficulty: 'medium', timeControl: '1d' } as const;

  it("puts the challenge in the friend's list, tells them, and lets only them accept", async () => {
    const { ann, bob, cat, bobCode, pushed } = await friends();
    const game = await ann.games.create({ ...invite, friend: bobCode });
    expect(game).toMatchObject({ seat: 'host', state: 'waiting', inviteeName: 'Bob' });
    expect(pushed()).toEqual([['Bob', await topicOf(game.id)]]);
    expect((await bob.games.list()).map((g) => g.id)).toEqual([game.id]);
    expect(await bob.games.get(game.id)).toMatchObject({ seat: null, hostName: 'Ann', inviteeName: 'Bob' });

    const refused = await cat.games.join(game.id, { name: 'Cat', secret: 'beach', difficulty: 'medium' })
      .catch((e: FriendApiError) => e.code);
    expect(refused).toBe('not-invited');
    expect(await bob.games.join(game.id, { name: 'Bob', secret: 'beach', difficulty: 'medium' }))
      .toMatchObject({ seat: 'guest', state: 'playing' });
  });

  it('can be rated: the difficulty is fixed, and the result changes both ratings once', async () => {
    const { ann, bob, bobCode, pushed, sqlite } = await friends();
    const { id } = await ann.games.create({ ...invite, friend: bobCode, rated: true });
    expect(pushed()).toEqual([['Bob', await topicOf(id)]]);
    expect(await bob.games.get(id)).toMatchObject({ seat: null, rated: true, ratings: null });
    const joined = await bob.games.join(id, { name: 'Bob', secret: 'beach', difficulty: 'hard' });
    const fresh = { rating: 1500, provisional: true, after: null };
    expect(joined).toMatchObject({ rated: true, ratings: { you: fresh, opponent: fresh }, view: { rated: true } });
    expect(await bob.games.setDifficulty(id, 'medium').catch((e: FriendApiError) => e.code)).toBe('difficulty-fixed');

    // Ann goes first and finds Bob's word; Bob's final guess misses.
    await ann.games.guess(id, 'beach');
    const over = await bob.games.guess(id, 'crane');
    expect(over.view?.outcome).toEqual({ result: 'lost', reason: 'found' });
    expect(over.ratings).toEqual({
      you: { ...fresh, after: { rating: 1338, provisional: true } },
      opponent: { ...fresh, after: { rating: 1662, provisional: true } },
    });
    await ann.games.get(id);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM rated_games WHERE game_id = ?').get(id)).toEqual({ n: 2 });
    expect(await ann.ratings()).toEqual([{ pool: 'correspondence', rating: 1662, provisional: true, games: 1 }]);
    expect(await bob.ratings()).toEqual([{ pool: 'correspondence', rating: 1338, provisional: true, games: 1 }]);
  });

  it("shows each rated game's own change, when another finished while it was going (#156)", async () => {
    const { ann, bob, bobCode } = await friends();
    const first = await ann.games.create({ ...invite, friend: bobCode, rated: true });
    const second = await ann.games.create({ ...invite, friend: bobCode, rated: true });
    await bob.games.join(first.id, { name: 'Bob', secret: 'beach', difficulty: 'medium' });
    await bob.games.join(second.id, { name: 'Bob', secret: 'beach', difficulty: 'medium' });
    // Bob gives up the second game first, so Ann starts the first one's rating at 1662.
    await bob.games.concede(second.id);
    await ann.games.guess(first.id, 'beach');
    const over = await bob.games.guess(first.id, 'crane');
    const [annNow] = (await ann.ratings())!;
    expect(over.ratings?.opponent.rating).toBe(1662);
    expect(over.ratings?.opponent.after?.rating).toBe(annNow.rating);
    expect(annNow.rating).toBeGreaterThan(1662);
    expect(over.ratings!.you.after!.rating).toBeLessThan(over.ratings!.you.rating);
  });

  it('leaves both ratings where they were after a rated draw, which still counts as a game', async () => {
    const { ann, bob, bobCode } = await friends();
    const { id } = await ann.games.create({ ...invite, friend: bobCode, rated: true });
    await bob.games.join(id, { name: 'Bob', secret: 'beach', difficulty: 'medium' });
    // Ann goes first and finds Bob's word; Bob's final guess finds hers.
    await ann.games.guess(id, 'beach');
    const over = await bob.games.guess(id, 'storm');
    expect(over.view?.outcome).toMatchObject({ result: 'draw' });
    expect(over.ratings?.you).toMatchObject({ rating: 1500, after: { rating: 1500 } });
    expect(await ann.ratings()).toEqual([{ pool: 'correspondence', rating: 1500, provisional: true, games: 1 }]);
  });

  it("rematches a rated game rated, telling the other player, whichever device they're on", async () => {
    const { ann, bob, bobCode, pushed } = await friends();
    const { id } = await ann.games.create({ ...invite, friend: bobCode, rated: true });
    await bob.games.join(id, { name: 'Bob', secret: 'beach', difficulty: 'hard' });
    await bob.games.concede(id);
    pushed();
    const rematch = await bob.games.rematch(id, { name: 'Bob', secret: 'crane' });
    expect(rematch).toMatchObject({ rated: true, inviteeName: 'Ann', rematchOf: id });
    expect(pushed()).toEqual([['Ann', await topicOf(rematch.id)]]);
    expect(await ann.games.get(rematch.id)).toMatchObject({ seat: null, invitedYou: true, rated: true });
  });

  it('refuses Easy in a rated game, from either player, but not in an unrated one', async () => {
    const { ann, bob, bobCode } = await friends();
    const code = (e: FriendApiError) => e.code;
    expect(await ann.games.create({ ...invite, difficulty: 'easy', friend: bobCode, rated: true }).catch(code)).toBe('easy-unrated');
    const { id } = await ann.games.create({ ...invite, friend: bobCode, rated: true });
    expect(await bob.games.join(id, { name: 'Bob', secret: 'beach', difficulty: 'easy' }).catch(code)).toBe('easy-unrated');
    const unrated = await ann.games.create({ ...invite, difficulty: 'easy', friend: bobCode });
    expect(await bob.games.join(unrated.id, { name: 'Bob', secret: 'beach', difficulty: 'easy' }))
      .toMatchObject({ state: 'playing', view: { difficulty: 'easy' } });
    // Easy's suggestions are recorded for each player, whoever's turn it is.
    expect(await bob.games.suggest(unrated.id, 'crane')).toMatchObject({ view: { suggested: 1, yourGuesses: [] } });
    expect(await ann.games.get(unrated.id)).toMatchObject({ view: { suggested: 0 } });
  });

  it('leaves an unrated challenge, and an invite link, out of ratings', async () => {
    const { ann, bob, bobCode } = await friends();
    const { id } = await ann.games.create({ ...invite, friend: bobCode });
    await bob.games.join(id, { name: 'Bob', secret: 'beach', difficulty: 'hard' });
    await ann.games.concede(id);
    expect(await ann.ratings()).toEqual([]);
    // Only a challenge to a friend can be rated.
    expect(await ann.games.create({ ...invite, rated: true }).catch((e: FriendApiError) => e.code)).toBe('bad-request');
  });

  it('only challenges friends', async () => {
    const { cat, bobCode } = await friends();
    expect(await cat.games.create({ ...invite, name: 'Cat', friend: bobCode }).catch((e: FriendApiError) => e.code))
      .toBe('not-a-friend');
  });
});

describe("a friend game's names", () => {
  const profile = (name: string | null) => ({
    guestName: 'Guest-1234', name, country: null, memberSince: NOW,
    settings: { difficulty: 'medium', newestFirst: { easy: false, medium: false, hard: false, extreme: false }, showTutorial: true, shareMarks: true },
  } as const);

  it("are each player's current one: a guest who signs in, and a renamed profile (#133)", async () => {
    const { player, fetchFn, guest } = await setup();
    const asGuest = friendApi('https://api.example', guest(CAT), fetchFn);
    const { id } = await asGuest.create({ name: 'Guest-5678', secret: 'storm', difficulty: 'medium', timeControl: '1d' });
    const bob = await player(BOB, 'Bob');
    expect(await bob.games.join(id, { name: 'Bob', secret: 'beach', difficulty: 'medium' }))
      .toMatchObject({ hostName: 'Guest-5678', guestName: 'Bob' });

    // The guest signs in on that device and names their profile.
    const cat = await player(CAT, 'Cat');
    expect(await bob.games.get(id)).toMatchObject({ hostName: 'Cat', guestName: 'Bob' });
    await syncApi('https://api.example', { guestId: BOB, token: bob.session.token }, fetchFn).putProfile(profile('Robert'));
    expect(await cat.games.get(id)).toMatchObject({ hostName: 'Cat', guestName: 'Robert' });
    // Without a profile name, the guest name the profile has.
    await syncApi('https://api.example', { guestId: BOB, token: bob.session.token }, fetchFn).putProfile(profile(null));
    expect(await cat.games.get(id)).toMatchObject({ guestName: 'Guest-1234' });
  });

  it('keep the name played under when the current one no longer passes the filter', async () => {
    const { player, sqlite } = await setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const { id } = await ann.games.create({ name: 'Ann', secret: 'storm', difficulty: 'medium', timeControl: '1d' });
    await bob.games.join(id, { name: 'Bob', secret: 'beach', difficulty: 'medium' });
    sqlite.prepare("UPDATE profiles SET name = 'Shithead' WHERE name = 'Ann'").run();
    expect(await bob.games.get(id)).toMatchObject({ hostName: 'Ann' });
  });
});

describe('inviting a friend to a lobby', () => {
  it("lists the invite on the friend's title screen until they join, and tells them", async () => {
    const { player, pushed } = await setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const cat = await player(CAT, 'Cat');
    const bobCode = (await bob.friends.list()).code;
    await ann.friends.add(bobCode);
    await bob.friends.add((await ann.friends.list()).code);
    pushed();

    const { lobby } = await ann.lobbies.create('Ann', 'medium');
    await ann.lobbies.invite(lobby.code, bobCode);
    expect(pushed()).toEqual([['Bob', await topicOf(`lobby-${lobby.code}`)]]);
    expect((await bob.friends.list()).lobbyInvites).toMatchObject([{ code: lobby.code, fromName: 'Ann' }]);

    // Only the host, and only friends.
    const refusal = (call: Promise<unknown>) => call.then(() => 'accepted', (e: LobbyApiError) => e.code);
    expect(await refusal(cat.lobbies.invite(lobby.code, bobCode))).toBe('not-a-friend');
    await cat.lobbies.join(lobby.code, 'Cat');

    await bob.lobbies.join(lobby.code, 'Bob');
    expect((await bob.friends.list()).lobbyInvites).toEqual([]);
  });
});

describe('ratings', () => {
  it('are for accounts only', async () => {
    const { fetchFn, guest } = await setup();
    expect(await fetchRatings('https://api.example', guest(ANN), fetchFn)).toBeNull();
  });
});

describe('deleting an account', () => {
  it("takes it off its friends' lists", async () => {
    const { player, fetchFn } = await setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    await ann.friends.add((await bob.friends.list()).code);
    expect((await bob.friends.list()).received).toHaveLength(1);
    await authApi('https://api.example', ANN, fetchFn).deleteAccount(ann.session.token);
    expect((await bob.friends.list()).received).toEqual([]);
  });
});

describe("a friend's profile (Dev Plan items 18c and 18cb)", () => {
  async function friends() {
    const s = await setup();
    const ann = await s.player(ANN, 'Ann');
    const bob = await s.player(BOB, 'Bob');
    const cat = await s.player(CAT, 'Cat');
    const bobCode = (await bob.friends.list()).code;
    await ann.friends.add(bobCode);
    await bob.friends.add((await ann.friends.list()).code);
    return { ...s, ann, bob, cat, bobCode };
  }
  const everything = { filter: {}, offset: 0, limit: 50 };

  /** A Daily Set Bob played on `day`, as the server keeps it. */
  function bobsDaily(sqlite: ReturnType<typeof fakeD1>['sqlite'], day: string, at: number, player = BOB) {
    const { record } = dailyEntry('x', day, at - 120_000, [['beach'], ['crane'], ['storm'], ['house']]) as { record: unknown };
    const id = `daily:${day}:${player}`;
    sqlite.prepare("INSERT INTO games (id, mode, version, record, started_at, finished_at) VALUES (?, 'daily', 1, ?, ?, ?)")
      .run(id, JSON.stringify(record), at - 120_000, at - 60_000);
    sqlite.prepare('INSERT INTO game_players (game_id, guest_id) VALUES (?, ?)').run(id, player);
  }

  it("is only a friend's: not a stranger's, a request's or a guest's", async () => {
    const { ann, cat, bob, bobCode, fetchFn, guest } = await friends();
    const refused = (p: Promise<unknown>) => p.then(() => 'ok', (e: FriendsApiError) => e.code);
    expect(await refused(cat.friends.profile(bobCode))).toBe('not-found');
    expect(await refused(cat.friends.profileGames(bobCode, everything))).toBe('not-found');
    // Cat asks Bob to be friends: until Bob accepts, neither sees the other's profile.
    const catCode = (await cat.friends.list()).code;
    await cat.friends.add(bobCode);
    expect(await refused(cat.friends.profile(bobCode))).toBe('not-found');
    expect(await refused(bob.friends.profile(catCode))).toBe('not-found');
    expect(await refused(friendsApi('https://api.example', guest(CAT), fetchFn).profile(bobCode))).toBe('sign-in-needed');
    expect(await refused(ann.friends.profile(bobCode))).toBe('ok');
    expect(await refused(ann.friends.profileGames(bobCode, everything))).toBe('ok');
  });

  it('shows their name, country, stats, badges and games from their side, your record against them, and nothing else of theirs', async () => {
    const { ann, bob, bobCode, now } = await friends();
    await bob.sync.putProfile({
      guestName: 'Guest-1234', name: 'Bob', country: 'GB', memberSince: NOW,
      settings: { difficulty: 'hard', newestFirst: { easy: false, medium: false, hard: false, extreme: false }, showTutorial: true, shareMarks: true },
    });
    await bob.sync.upload([soloEntry('bob-solo-1', now() - 60_000, ['crane', 'beach'])]);
    // A game against Ann: she goes first and finds Bob's word, and his final guess misses.
    const game = await ann.games.create({ name: 'Ann', secret: 'storm', difficulty: 'medium', timeControl: '1d', friend: bobCode, rated: true });
    await bob.games.join(game.id, { name: 'Bob', secret: 'beach', difficulty: 'medium' });
    await ann.games.guess(game.id, 'beach');
    await bob.games.guess(game.id, 'crane');

    const { profile, summary } = await loadFriendProfile(ann.friends, bobCode);
    expect(profile).toEqual({ name: 'Bob', country: 'GB', memberSince: NOW, placements: [] });
    expect(summary.games).toBe(2);
    expect(summary.stats.played).toBe(2);
    expect(summary.stats.modes.friend.record).toMatchObject({ wins: 0, losses: 1 });
    expect(summary.badges.length).toBeGreaterThan(0);
    // The games the stats point at, to open: his single player game is his best and fastest.
    expect(summary.featured.map((e) => e.id)).toEqual(['bob-solo-1']);
    // Ann won their one game.
    expect(summary.versus).toEqual({ friend: { wins: 1, draws: 0, losses: 0 }, lobby: { wins: 0, draws: 0, losses: 0 } });

    const { games, next } = await ann.friends.profileGames(bobCode, everything);
    expect(next).toBeNull();
    // Newest first.
    expect(games.map((g) => g.mode)).toEqual(['friend', 'single']);
    // Rated, but their rating isn't shown to friends.
    expect(games[0]).toMatchObject({ mode: 'friend', seat: 'guest', opponent: 'Ann', rating: null });

    // Nothing that's a credential or private: no game ID, guest ID, email or setting.
    const raw = JSON.stringify(await ann.friends.profile(bobCode)) + JSON.stringify(await ann.friends.profileGames(bobCode, everything));
    for (const secret of [game.id, ANN, BOB, 'bob@example.com', 'shareMarks', '"ref"']) expect(raw).not.toContain(secret);
  });

  it('keeps up as games finish, and asks a game room about each game once', async () => {
    const { ann, bob, bobCode, now, roomAsks } = await friends();
    await bob.sync.upload([soloEntry('bob-solo-1', now() - 60_000, ['crane', 'beach'])]);
    expect((await loadFriendProfile(ann.friends, bobCode)).summary.games).toBe(1);
    const game = await ann.games.create({ name: 'Ann', secret: 'storm', difficulty: 'medium', timeControl: '1d', friend: bobCode });
    await bob.games.join(game.id, { name: 'Bob', secret: 'beach', difficulty: 'medium' });
    await ann.games.guess(game.id, 'beach');
    await bob.games.guess(game.id, 'crane');
    await bob.sync.upload([soloEntry('bob-solo-2', now() - 30_000, ['storm', 'beach'])]);

    const before = roomAsks();
    expect((await loadFriendProfile(ann.friends, bobCode)).summary.games).toBe(3);
    // Bob's side, and Ann's for your record against him.
    expect(roomAsks() - before).toBe(2);
    await loadFriendProfile(ann.friends, bobCode);
    await bob.friends.profile((await ann.friends.list()).code);
    expect(roomAsks() - before).toBe(2);
  });

  it('pages their history, newest first, with the filters and search', async () => {
    const { ann, bob, bobCode, now } = await friends();
    const entries = Array.from({ length: 25 }, (_, i) =>
      soloEntry(`bob-solo-${i}`, now() - (100 - i) * 60_000, i === 24 ? ['crane'] : i % 2 ? ['crane', 'beach'] : ['storm', 'beach'], {
        difficulty: i < 5 ? 'hard' : 'medium', gaveUp: i === 24,
      }));
    await bob.sync.upload(entries);
    await loadFriendProfile(ann.friends, bobCode);
    const first = await ann.friends.profileGames(bobCode, { filter: {}, offset: 0, limit: 20 });
    expect(first.games.map((g) => g.id)).toEqual(entries.slice(5).reverse().map((e) => e.id));
    expect(first.next).toBe(20);
    const second = await ann.friends.profileGames(bobCode, { filter: {}, offset: 20, limit: 20 });
    expect(second.games.map((g) => g.id)).toEqual(entries.slice(0, 5).reverse().map((e) => e.id));
    expect(second.next).toBeNull();
    const ids = async (filter: HistoryFilter) => (await ann.friends.profileGames(bobCode, { filter, offset: 0, limit: 50 })).games.length;
    expect(await ids({ difficulty: 'hard' })).toBe(5);
    expect(await ids({ result: 'lost' })).toBe(1);
    expect(await ids({ mode: 'friend' })).toBe(0);
    expect(await ids({ search: 'cra' })).toBe(13);
    expect(await ids({ search: 'BEACH ' })).toBe(25);
    expect(await ids({ search: 'nope!' })).toBe(0);
  });

  it("leaves out a Daily Set until the day after it is over, and gives the places of days that are over", async () => {
    const { ann, bobCode, sqlite, now } = await friends();
    const today = dailyDay(now());
    const yesterday = addDays(today, -1);
    const before = addDays(today, -2);
    for (const day of [before, yesterday, today]) {
      bobsDaily(sqlite, day, now());
      sqlite.prepare('INSERT INTO daily_results (day, player_id, difficulty, name, guesses, ms, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(day, BOB, 'medium', 'Bob', 4, 60_000, now() - 60_000);
    }
    const { profile, summary } = await loadFriendProfile(ann.friends, bobCode);
    // Yesterday's can still be finished by someone who started it before midnight.
    expect(summary.games).toBe(1);
    const { games } = await ann.friends.profileGames(bobCode, everything);
    expect(games.map((g) => g.mode === 'daily' && g.day)).toEqual([before]);
    expect(profile.placements.map((p) => [p.day, p.rank, p.rankBy])).toEqual([
      [before, 1, undefined], [before, 1, 'rush'], [yesterday, 1, undefined], [yesterday, 1, 'rush'],
    ]);
  });

  it('shows the games of a guest ID linked later, and catches up on many games over a few requests', async () => {
    const { ann, bobCode, sqlite, now } = await friends();
    const today = dailyDay(now());
    for (let i = 2; i < 132; i++) bobsDaily(sqlite, addDays(today, -i), now());
    // The first answers come while the server is still copying them.
    expect((await ann.friends.profile(bobCode)).summary).toBeNull();
    expect((await loadFriendProfile(ann.friends, bobCode)).summary.games).toBe(130);

    // A guest's game, from before they signed in on that device.
    sqlite.prepare('INSERT INTO guests (id, created_at, last_seen_at) VALUES (?, ?, ?)').run(DAN, NOW, NOW);
    bobsDaily(sqlite, addDays(today, -200), now(), DAN);
    expect((await loadFriendProfile(ann.friends, bobCode)).summary.games).toBe(130);
    const bobId = sqlite.prepare('SELECT account_id FROM guests WHERE id = ?').get(BOB) as { account_id: string };
    sqlite.prepare('UPDATE guests SET account_id = ? WHERE id = ?').run(bobId.account_id, DAN);
    expect((await loadFriendProfile(ann.friends, bobCode)).summary.games).toBe(131);
  });

  it('refuses a query or code that is no such thing', async () => {
    const { fetchFn, ann, bobCode } = await friends();
    const headers = { 'x-guest-id': ANN, authorization: `Bearer ${ann.session.token}` };
    for (const path of [
      'profile?code=nope', 'profile/games?code=nope&offset=0&limit=20', `profile/games?code=${bobCode}&offset=-1&limit=20`,
      `profile/games?code=${bobCode}&offset=0&limit=51`, `profile/games?code=${bobCode}&offset=0`,
      `profile/games?code=${bobCode}&offset=0&limit=20&mode=chess`, `profile/games?code=${bobCode}&offset=0&limit=20&result=won!`,
      `profile/games?code=${bobCode}&offset=0&limit=20&difficulty=easyish`,
    ]) {
      const response = await fetchFn(`https://api.example/api/friends/${path}`, { headers });
      expect(response.status, path).toBe(400);
    }
  });
});

describe("which names are friends' (Dev Plan item 18ca)", () => {
  /** Ann and Bob are friends; Cat is a stranger to both, and Dan only asked to be Ann's friend. */
  async function circle() {
    const s = await setup();
    const ann = await s.player(ANN, 'Ann');
    const bob = await s.player(BOB, 'Bob');
    const cat = await s.player(CAT, 'Cat');
    const dan = await s.player(DAN, 'Dan');
    const annCode = (await ann.friends.list()).code;
    const bobCode = (await bob.friends.list()).code;
    await ann.friends.add(bobCode);
    await bob.friends.add(annCode);
    await dan.friends.add(annCode);
    return { ...s, ann, bob, cat, dan, annCode, bobCode };
  }
  const answer = { secret: 'beach', difficulty: 'medium' } as const;
  const invite = { name: 'Ann', secret: 'storm', difficulty: 'medium', timeControl: '1d' } as const;

  it("give your opponent's friend code in a game against a friend, to each of you, and nobody else's", async () => {
    const { ann, bob, cat, dan, annCode, bobCode } = await circle();
    const { id } = await ann.games.create({ ...invite, friend: bobCode });
    expect(await bob.games.join(id, { name: 'Bob', ...answer })).toMatchObject({ opponentCode: annCode });
    expect(await ann.games.get(id)).toMatchObject({ opponentCode: bobCode });

    // An invite link taken by a stranger, or by someone whose request you haven't accepted.
    for (const [them, name] of [[cat, 'Cat'], [dan, 'Dan']] as const) {
      const game = await ann.games.create(invite);
      expect(await them.games.join(game.id, { name, ...answer })).toMatchObject({ opponentCode: null });
      expect(await ann.games.get(game.id)).toMatchObject({ opponentCode: null });
    }
  });

  it('find a friend who played as a guest on a device they later signed in on, but never for a guest asking', async () => {
    const { player, fetchFn, guest } = await setup();
    const asGuest = friendApi('https://api.example', guest(CAT), fetchFn);
    const { id } = await asGuest.create({ name: 'Guest-5678', ...answer, timeControl: '1d' });
    const ann = await player(ANN, 'Ann');
    await ann.games.join(id, { name: 'Ann', secret: 'storm', difficulty: 'medium' });
    expect(await asGuest.get(id)).toMatchObject({ opponentCode: null });

    const cat = await player(CAT, 'Cat');
    const catCode = (await cat.friends.list()).code;
    await ann.friends.add(catCode);
    await cat.friends.add((await ann.friends.list()).code);
    expect(await ann.games.get(id)).toMatchObject({ opponentCode: catCode });
  });

  it("give friends' codes in a finished lobby's standings, and not before you've finished", async () => {
    const { ann, bob, cat, bobCode } = await circle();
    const { lobby: { code } } = await ann.lobbies.create('Ann', 'medium');
    await bob.lobbies.join(code, 'Bob');
    await cat.lobbies.join(code, 'Cat');
    await ann.lobbies.start(code);
    const codes = (standings: readonly { name: string; friendCode: string | null }[] | null) =>
      Object.fromEntries(standings!.map((s) => [s.name, s.friendCode]));
    expect(codes((await ann.lobbies.get(code)).lobby.standings)).toEqual({ Ann: null, Bob: null, Cat: null });

    await ann.lobbies.giveUp(code);
    expect(codes((await ann.lobbies.get(code)).lobby.standings)).toEqual({ Ann: null, Bob: bobCode, Cat: null });
    // Bob hasn't finished, and Cat is nobody's friend.
    expect(codes((await bob.lobbies.get(code)).lobby.standings)).toEqual({ Ann: null, Bob: null, Cat: null });
    await bob.lobbies.giveUp(code);
    await cat.lobbies.giveUp(code);
    expect((await cat.lobbies.get(code)).lobby.state).toBe('over');
    expect(codes((await cat.lobbies.get(code)).lobby.standings)).toEqual({ Ann: null, Bob: null, Cat: null });
  });

  it("give friends' codes on the Daily Set board's Friends view only", async () => {
    const { sqlite, fetchFn, now, ann, cat, bobCode } = await circle();
    const day = dailyDay(now());
    sqlite.prepare("INSERT INTO daily_themes (day, theme_id, theme, words) VALUES (?, 't', 'Test set', 'storm,beach,flame,quick')").run(day);
    // Bob's result is under the guest ID of the device he signed in on.
    const result = sqlite.prepare("INSERT INTO daily_results (day, player_id, difficulty, name, guesses, ms, finished_at) VALUES (?, ?, 'medium', ?, ?, 60000, 0)");
    for (const [id, name, guesses] of [[BOB, 'Bob', 20], [CAT, 'Cat', 21], [DAN, 'Dan', 22]] as const) result.run(day, id, name, guesses);
    const board = (who: typeof ann, circle: 'everyone' | 'friends') =>
      dailyApi('https://api.example', { guestId: who.guestId, token: who.session.token }, fetchFn).board(day, 'medium', circle);
    const codes = async (who: typeof ann, circle: 'everyone' | 'friends') =>
      Object.fromEntries((await board(who, circle)).top.map((r) => [r.name, r.friendCode]));
    expect(await codes(ann, 'friends')).toEqual({ Bob: bobCode });
    expect(await codes(ann, 'everyone')).toEqual({ Bob: null, Cat: null, Dan: null });
    expect(await codes(cat, 'friends')).toEqual({ Cat: null });
  });
});
