import { describe, expect, it } from 'vitest';
import { authApi, type Session } from '../../src/app/account';
import { friendApi, FriendApiError, type FriendApi } from '../../src/app/friendApi';
import { newId } from '../../src/app/ids';
import { fakeD1 } from './fakeD1';
import { fakeRooms } from './fakeRooms';
import { handle, type Env } from './index';
import { notifyGuest, toBase64Url, type VapidKeys } from './push';

/*
 * Upgrading a guest to an account (README "Accounts"): the games a guest
 * played carry over, a signed-in player's games follow them to every
 * device, and a guest ID that's an account's needs its session.
 */

const NOW = Date.UTC(2026, 8, 28);
const APP = 'https://app.example';

function setup() {
  const { db, sqlite } = fakeD1();
  let clock = NOW;
  const { namespace } = fakeRooms({ db, now: () => clock });
  const emails: string[] = [];
  // The worker's own calls out: the sign-in email.
  const outside = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    emails.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response('{}');
  }) as typeof fetch;
  const env: Env = {
    DB: db, GAMES: namespace, DAILY: undefined as unknown as DurableObjectNamespace, LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: APP, RESEND_API_KEY: 'key', EMAIL_FROM: 'play@example.com',
  };
  // The app's clients, answered by the worker in process.
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init), env, clock, outside)) as typeof fetch;
  const auth = (guestId: string) => authApi('https://api.example', guestId, fetchFn);
  const games = (guestId: string, session: Session | null = null): FriendApi =>
    friendApi('https://api.example', { guestId, token: session?.token ?? null }, fetchFn);
  /** Signs a device in by email, as someone opening the emailed link on it would. */
  const signIn = async (guestId: string, email: string): Promise<Session> => {
    // An address gets a link at most once a minute.
    clock += 60_000;
    await auth(guestId).sendLink(email, APP);
    const token = /\?login=([\w-]+)/.exec(emails[emails.length - 1])![1];
    return auth(guestId).signIn(token);
  };
  return { sqlite, db, auth, games, signIn };
}

async function vapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  return { publicKey: toBase64Url(publicKey), privateKey: jwk.d!, subject: APP };
}

/** A device's push keys (p256dh, auth), as a browser makes them. */
async function deviceKeys(): Promise<[string, string]> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  return [toBase64Url(p256dh), toBase64Url(crypto.getRandomValues(new Uint8Array(16)))];
}

const invite = { name: 'Ann', secret: 'storm', difficulty: 'medium', timeControl: '1d' } as const;
const answer = { name: 'Bob', secret: 'beach', difficulty: 'medium' } as const;

async function refusal(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (e) {
    if (e instanceof FriendApiError) return e.code;
    throw e;
  }
  throw new Error('the call was accepted');
}

describe('upgrading a guest to an account', () => {
  it("keeps the guest's games: the account takes the guest's ID", async () => {
    const { games, signIn } = setup();
    const [phone, bob] = [newId(), newId()];
    const { id } = await games(phone).create(invite);
    await games(bob).join(id, answer);
    const session = await signIn(phone, 'ann@example.com');
    expect(session.account.id).toBe(phone);
    expect(await games(phone, session).get(id)).toMatchObject({ seat: 'host', state: 'playing' });
  });

  it("needs the session for a guest ID that's an account's", async () => {
    const { games, signIn, auth } = setup();
    const phone = newId();
    const { id } = await games(phone).create(invite);
    await signIn(phone, 'ann@example.com');
    expect(await refusal(games(phone).get(id))).toBe('sign-in-needed');
    expect(await refusal(games(phone).create(invite))).toBe('sign-in-needed');
    await expect(auth(phone).me(null)).rejects.toMatchObject({ code: 'sign-in-needed' });
  });

  it('plays the same games from every device signed in', async () => {
    const { games, signIn } = setup();
    const [phone, laptop, bob] = [newId(), newId(), newId()];
    const onPhone = await signIn(phone, 'ann@example.com');
    const { id } = await games(phone, onPhone).create(invite);
    await games(bob).join(id, answer);
    const onLaptop = await signIn(laptop, 'ann@example.com');
    const seen = await games(laptop, onLaptop).get(id);
    expect(seen).toMatchObject({ seat: 'host', state: 'playing' });
    const guessed = await games(laptop, onLaptop).guess(id, 'crane');
    expect(guessed.view?.yourGuesses).toHaveLength(1);
    expect((await games(phone, onPhone).get(id)).view?.yourGuesses).toHaveLength(1);
    // On the laptop the account is one player: it can't accept its own invite.
    const other = await games(phone, onPhone).create(invite);
    expect(await refusal(games(laptop, onLaptop).join(other.id, answer))).toBe('own-invite');
  });

  it("brings games a device played as a guest into the account, on every device", async () => {
    const { games, signIn } = setup();
    const [phone, laptop, bob] = [newId(), newId(), newId()];
    const onPhone = await signIn(phone, 'ann@example.com');
    // Before signing in there, the laptop accepted Bob's invite as its own guest.
    const fromBob = await games(bob).create({ ...invite, name: 'Bob' });
    await games(laptop).join(fromBob.id, { ...answer, name: 'Ann' });
    const onLaptop = await signIn(laptop, 'ann@example.com');
    expect(await games(laptop, onLaptop).get(fromBob.id)).toMatchObject({ seat: 'guest' });
    expect(await games(phone, onPhone).get(fromBob.id)).toMatchObject({ seat: 'guest' });
  });

  it('lists your games from every device', async () => {
    const { games, signIn } = setup();
    const [phone, laptop, bob] = [newId(), newId(), newId()];
    const first = await games(laptop).create(invite);
    const onPhone = await signIn(phone, 'ann@example.com');
    const second = await games(phone, onPhone).create(invite);
    const fromBob = await games(bob).create({ ...invite, name: 'Bob' });
    await games(phone, onPhone).join(fromBob.id, answer);
    expect((await games(phone, onPhone).list()).map((g) => g.id)).toEqual(
      expect.arrayContaining([second.id, fromBob.id]));
    expect((await games(phone, onPhone).list()).map((g) => g.id)).not.toContain(first.id);
    const onLaptop = await signIn(laptop, 'ann@example.com');
    expect(new Set((await games(laptop, onLaptop).list()).map((g) => g.id)))
      .toEqual(new Set([first.id, second.id, fromBob.id]));
    // A guest sees only their own.
    expect((await games(bob).list()).map((g) => g.id)).toEqual([fromBob.id]);
  });

  it('sends turn alerts to every device of the account, and no one else', async () => {
    const { db, sqlite, signIn } = setup();
    const [phone, laptop, bob] = [newId(), newId(), newId()];
    await signIn(phone, 'ann@example.com');
    await signIn(laptop, 'ann@example.com');
    sqlite.prepare('INSERT INTO guests (id, created_at, last_seen_at) VALUES (?, 0, 0)').run(bob);
    const keys = await vapidKeys();
    for (const guest of [phone, laptop, bob]) {
      sqlite.prepare('INSERT INTO push_subscriptions (endpoint, guest_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`https://fcm.googleapis.com/${guest}`, guest, ...await deviceKeys(), NOW);
    }
    const reached: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      reached.push(new URL(String(input instanceof Request ? input.url : input)).pathname.slice(1));
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    // A seat taken on the laptop before signing in reaches the phone too.
    await notifyGuest(db, keys, laptop, { title: 't', body: 'b', gameId: 'c'.repeat(64) }, NOW, fetchFn);
    expect(reached.sort()).toEqual([phone, laptop].sort());
  });
});

describe('signing out', () => {
  it("ends this device's session and its turn alerts; the account plays on elsewhere", async () => {
    const { sqlite, games, auth, signIn } = setup();
    const [phone, laptop] = [newId(), newId()];
    const onPhone = await signIn(phone, 'ann@example.com');
    const onLaptop = await signIn(laptop, 'ann@example.com');
    const { id } = await games(phone, onPhone).create(invite);
    sqlite.prepare('INSERT INTO push_subscriptions (endpoint, guest_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('https://fcm.googleapis.com/a', laptop, 'p', 'a', NOW);
    await auth(laptop).signOut(onLaptop.token);
    expect(await refusal(games(laptop, onLaptop).get(id))).toBe('signed-out');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
    // The laptop plays on as a new guest; the phone is still signed in.
    expect(await games(newId()).get(id)).toMatchObject({ seat: null });
    expect(await games(phone, onPhone).get(id)).toMatchObject({ seat: 'host' });
  });
});

describe('deleting an account', () => {
  it('signs out every device, forgets the email, and leaves the guest IDs as guests', async () => {
    const { sqlite, games, auth, signIn } = setup();
    const [phone, laptop] = [newId(), newId()];
    const onPhone = await signIn(phone, 'ann@example.com');
    const onLaptop = await signIn(laptop, 'ann@example.com');
    const { id } = await games(phone, onPhone).create(invite);
    await auth(laptop).deleteAccount(onLaptop.token);
    await expect(auth(phone).me(onPhone.token)).rejects.toMatchObject({ code: 'signed-out' });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM login_links').get()).toEqual({ n: 0 });
    // The phone's guest ID is a plain guest's again, with its games.
    expect(await games(phone).get(id)).toMatchObject({ seat: 'host' });
    // Signing in again makes a new account.
    const again = await signIn(laptop, 'ann@example.com');
    expect(again.account.id).toBe(laptop);
  });

  it('needs a session', async () => {
    const { auth } = setup();
    await expect(auth(newId()).deleteAccount('a'.repeat(43))).rejects.toMatchObject({ code: 'signed-out' });
  });
});
