import { beforeEach, describe, expect, it } from 'vitest';
import { isUsage, type Usage } from '../../src/admin/usage';
import { DAY_MS } from '../../src/game';
import { forgetAccessKeys, teamHost, verifyAccessToken } from './access';
import { KEEP_FIGURES_MS, periodsTo } from './admin';
import { fakeD1 } from './fakeD1';
import { handle, type Env } from './index';
import { limitOf } from './limits';
import { apiFor } from '../../functions/admin/figures';
import { STAGING_API_URL } from '../../src/buildApiUrl';

/*
 * The usage dashboard (Dev Plan item 18m): its figures route answers only a
 * request carrying a token Cloudflare Access signed for the dashboard, and
 * answers totals only.
 */

// 11am on Friday 16 October 2026 in New York (summer time, UTC-4).
const NOW = Date.UTC(2026, 9, 16, 15);
const HOUR = 60 * 60 * 1000;
const TEAM = 'wm-team';
const AUD = 'aud-tag-of-the-dashboard';
const ISS = 'https://wm-team.cloudflareaccess.com';
const guestId = (n: number) => `0f8b6c2e-5d4a-4b1c-9e3f-${String(n).padStart(12, '0')}`;

const encode = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

async function keyPair(kid: string) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  const jwk: JsonWebKey & { kid: string } = { ...await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey, kid };
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid }) => {
    const body = `${encode(header)}.${encode(claims)}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body));
    return `${body}.${Buffer.from(signature).toString('base64url')}`;
  };
  return { jwk, sign };
}

const valid = { aud: [AUD], iss: ISS, email: 'owner@example.com', exp: NOW / 1000 + 3600, iat: NOW / 1000, nbf: NOW / 1000 };

async function setup(config = true) {
  forgetAccessKeys();
  const { db, sqlite } = fakeD1();
  const key = await keyPair('key-1');
  const fetched: string[] = [];
  let published = [key.jwk];
  const outside = (async (url: RequestInfo | URL) => {
    fetched.push(String(url));
    return new Response(JSON.stringify({ keys: published }));
  }) as typeof fetch;
  const none = undefined as unknown as DurableObjectNamespace;
  const env: Env = {
    DB: db, GAMES: none, DAILY: none, LOBBIES: none, QUEUES: none, ALLOWED_ORIGINS: 'https://app.example',
    ...(config ? { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } : {}),
  };
  const figures = (token?: string, now = NOW) => handle(new Request('https://api.example/api/admin/figures', {
    headers: token === undefined ? {} : { 'cf-access-jwt-assertion': token },
  }), env, now, outside);
  return { sqlite, key, fetched, figures, publish: (keys: typeof published) => { published = keys; } };
}

beforeEach(() => forgetAccessKeys());

describe('the figures route', () => {
  it('is off without the Access settings', async () => {
    const { key, figures } = await setup(false);
    const response = await figures(await key.sign(valid));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'off' });
  });

  it('refuses a request without a token', async () => {
    const { figures } = await setup();
    expect((await figures()).status).toBe(403);
  });

  it('refuses a token Access did not sign, or not for the dashboard', async () => {
    const { key, figures } = await setup();
    const other = await keyPair('key-1');
    const refused = [
      await other.sign(valid),
      await key.sign({ ...valid, aud: ['another-application'] }),
      await key.sign({ ...valid, iss: 'https://someone-else.cloudflareaccess.com' }),
      await key.sign({ ...valid, exp: NOW / 1000 - 120 }),
      await key.sign({ ...valid, nbf: NOW / 1000 + 120 }),
      await key.sign({ ...valid }, { alg: 'none', kid: 'key-1' }),
      await key.sign({ ...valid }, { alg: 'RS256', kid: 'key-2' }),
      'not.a.token',
      '',
    ];
    for (const token of refused) expect((await figures(token)).status, token).toBe(403);
  });

  it('answers a valid token, a minute either side of its times', async () => {
    const { key, figures } = await setup();
    expect((await figures(await key.sign(valid))).status).toBe(200);
    expect((await figures(await key.sign({ ...valid, aud: AUD, exp: NOW / 1000 - 30 }))).status).toBe(200);
  });

  it('fetches the team keys once, and again for a new key no more than every 5 minutes', async () => {
    const { key, fetched, figures, publish } = await setup();
    await figures(await key.sign(valid));
    await figures(await key.sign(valid));
    expect(fetched).toEqual([`https://${TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`]);
    const rotated = await keyPair('key-2');
    publish([key.jwk, rotated.jwk]);
    expect((await figures(await rotated.sign(valid), NOW + 60_000)).status).toBe(403);
    expect(fetched).toHaveLength(1);
    expect((await figures(await rotated.sign(valid), NOW + 6 * 60_000)).status).toBe(200);
    expect(fetched).toHaveLength(2);
  });

  it('says so when Access’s keys can’t be fetched', async () => {
    forgetAccessKeys();
    const failing = (async () => new Response('', { status: 500 })) as typeof fetch;
    const key = await keyPair('key-1');
    await expect(verifyAccessToken(await key.sign(valid), { teamDomain: TEAM, aud: AUD }, NOW, failing)).rejects.toThrow();
  });

  it('isn’t rate limited: a made-up token is turned away before counting', () => {
    expect(limitOf('GET', '/api/admin/figures')).toBeNull();
  });

  it('keeps counted figures for 5 minutes', async () => {
    const { sqlite, key, figures } = await setup();
    const players = async (now: number) => ((await (await figures(await key.sign(valid), now)).json()) as Usage).players.total;
    expect(await players(NOW)).toBe(0);
    sqlite.prepare('INSERT INTO guests (id, created_at, last_seen_at) VALUES (?, ?, ?)').run(guestId(9), NOW, NOW);
    expect(await players(NOW + KEEP_FIGURES_MS - 1)).toBe(0);
    expect(await players(NOW + KEEP_FIGURES_MS)).toBe(1);
  });

  it('is asked for by the site and previews only, each of their own server', () => {
    expect(apiFor('wordmastermind.app')).toBe('https://api.wordmastermind.app');
    expect(apiFor('www.wordmastermind.app')).toBe('https://api.wordmastermind.app');
    expect(apiFor('claude-item.word-mastermind.pages.dev')).toBe(STAGING_API_URL);
    expect(apiFor('word-mastermind.pages.dev')).toBeNull();
    expect(apiFor('example.com')).toBeNull();
  });
});

describe('the figures', () => {
  it('reads the team domain in any form', () => {
    expect(teamHost('wm-team')).toBe('wm-team.cloudflareaccess.com');
    expect(teamHost('wm-team.cloudflareaccess.com')).toBe('wm-team.cloudflareaccess.com');
    expect(teamHost('https://WM-team.cloudflareaccess.com/')).toBe('wm-team.cloudflareaccess.com');
  });

  it('lists 30 days, 12 weeks from Monday and 12 months', () => {
    const periods = periodsTo('2026-10-16');
    expect(periods.day).toHaveLength(30);
    expect(periods.day.at(-1)).toBe('2026-10-16');
    expect(periods.day[0]).toBe('2026-09-17');
    expect(periods.week.at(-1)).toBe('2026-10-12');
    expect(periods.week[0]).toBe('2026-07-27');
    expect(periods.month.at(-1)).toBe('2026-10-01');
    expect(periods.month[0]).toBe('2025-11-01');
  });

  it('counts players, games, daily entries and countries, and never names anyone', async () => {
    const { sqlite, key, figures } = await setup();
    const at = (daysAgo: number) => NOW - daysAgo * DAY_MS;
    const guest = (n: number, created: number, seen: number, account: string | null = null) => sqlite.prepare(
      'INSERT INTO guests (id, created_at, last_seen_at, account_id) VALUES (?, ?, ?, ?)',
    ).run(guestId(n), created, seen, account);
    // An account made on device 1 in May, which signed in on device 2 today.
    const account = guestId(1);
    sqlite.prepare(`INSERT INTO accounts (id, email, created_at, friend_code) VALUES (?, 'someone@example.com', ?, 'ABCD-EFGH')`)
      .run(account, Date.UTC(2026, 4, 2));
    guest(1, Date.UTC(2026, 3, 20), at(3), account);
    guest(2, at(0), at(0), account);
    // Guests: one new today (an hour after New York's midnight), one yesterday, one 20 days ago seen 10 days ago.
    guest(3, Date.UTC(2026, 9, 16, 5), at(0));
    guest(4, Date.UTC(2026, 9, 15, 23), at(0));
    guest(5, at(20), at(10));
    // Late on the 15th in New York, though the 16th in UTC.
    guest(6, Date.UTC(2026, 9, 16, 2), Date.UTC(2026, 9, 16, 2));
    sqlite.prepare(`INSERT INTO profiles (account_id, guest_name, name, country, member_since, settings, updated_at)
      VALUES (?, 'Guest-1234', 'Secret Name', 'GB', 0, '{}', 0)`).run(account);

    const game = (id: string, mode: string, record: unknown, started: number, players: string[]) => {
      sqlite.prepare('INSERT INTO games (id, mode, version, record, started_at, finished_at) VALUES (?, ?, 1, ?, ?, ?)')
        .run(id, mode, JSON.stringify(record), started, started + HOUR);
      for (const p of players) sqlite.prepare('INSERT INTO game_players (game_id, guest_id) VALUES (?, ?)').run(id, p);
    };
    game('f1', 'friend', {}, at(1), [guestId(2), guestId(3)]);
    game('l1', 'lobby', { kind: 'competitive' }, at(2), [guestId(1)]);
    game('l2', 'lobby', {}, at(40), [guestId(5)]);
    game('d1', 'daily', {}, at(0), [account]);
    sqlite.prepare(`INSERT INTO history_entries (account_id, id, mode, version, entry, started_at, uploaded_at)
      VALUES (?, 'h1', 'computer', 1, '{}', ?, ?), (?, 'h2', 'single', 1, '{}', ?, ?)`)
      .run(account, at(1), at(1), account, at(100), at(100));
    for (const [day, player, difficulty] of [['2026-10-16', account, 'medium'], ['2026-10-16', guestId(3), 'medium'], ['2026-10-15', guestId(4), 'hard']]) {
      sqlite.prepare(`INSERT INTO daily_results (day, player_id, difficulty, name, guesses, ms, finished_at) VALUES (?, ?, ?, 'Secret Name', 9, 1000, ?)`)
        .run(day, player, difficulty, NOW);
    }
    sqlite.prepare(`INSERT INTO daily_played (player_id, day, mode, played_at) VALUES (?, '2026-10-16', 'daily', ?), (?, '2026-10-16', 'daily', ?),
      (?, '2026-10-16', 'daily', ?), (?, '2026-10-16', 'dailyWord', ?)`)
      .run(account, at(0), guestId(3), at(0), guestId(6), at(0), guestId(3), at(0));

    const response = await figures(await key.sign(valid));
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    for (const secret of [guestId(1), guestId(3), 'someone@example.com', 'Secret Name', 'ABCD-EFGH', 'Guest-1234']) {
      expect(text).not.toContain(secret);
    }
    const usage = JSON.parse(text) as Usage;
    expect(isUsage(usage)).toBe(true);
    expect(usage.players).toEqual({ total: 5, guests: 4, accounts: 1, devices: 6 });
    // Seen in the last 24 hours: the account (device 2), guests 3, 4 and 6 (an hour short of 24); 5 in 30 days.
    expect(usage.active).toEqual({ day: 4, week: 4, month: 5 });

    const day = (periods: Usage['newPlayers'], period: string) => periods.day.find((p) => p.period === period)?.count;
    expect(day(usage.newPlayers, '2026-10-16')).toBe(1);
    expect(day(usage.newPlayers, '2026-10-15')).toBe(2);
    expect(usage.newPlayers.month.find((p) => p.period === '2026-10-01')?.count).toBe(3);
    expect(usage.newPlayers.month.find((p) => p.period === '2026-09-01')?.count).toBe(1);
    expect(usage.newPlayers.month.find((p) => p.period === '2026-04-01')?.count).toBe(1);
    expect(usage.newAccounts.month.find((p) => p.period === '2026-05-01')?.count).toBe(1);
    expect(usage.newPlayers.week.at(-1)).toEqual({ period: '2026-10-12', count: 3 });

    // Today: the account and guests 3 and 6, each starting a daily game.
    expect(day(usage.playing, '2026-10-16')).toBe(3);
    // Yesterday: the friend game (the account and guest 3) and the synced computer game (the account again).
    expect(day(usage.playing, '2026-10-15')).toBe(2);
    expect(usage.playing.month.at(-1)).toEqual({ period: '2026-10-01', count: 3 });

    expect(usage.games.online).toEqual(expect.arrayContaining([
      { mode: 'friend', total: 1, recent: 1 }, { mode: 'competitive', total: 1, recent: 1 },
      { mode: 'lobby', total: 1, recent: 0 }, { mode: 'daily', total: 1, recent: 1 },
    ]));
    expect(usage.games.synced).toEqual(expect.arrayContaining([{ mode: 'computer', total: 1, recent: 1 }, { mode: 'single', total: 1, recent: 0 }]));

    expect(usage.daily).toHaveLength(30);
    expect(usage.daily.at(-1)).toEqual({ day: '2026-10-16', started: 3, finished: { medium: 2 } });
    expect(usage.daily.at(-2)).toEqual({ day: '2026-10-15', started: 0, finished: { hard: 1 } });
    expect(usage.dailyWord.at(-1)).toEqual({ day: '2026-10-16', started: 1, finished: {} });
    expect(usage.countries).toEqual([{ country: 'GB', count: 1 }]);
    expect(usage.noCountry).toBe(0);
  });
});
