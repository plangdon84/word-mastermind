import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, dailyDay, replayEntry, summarizeGame, type HistoryEntry } from '../game';
import { dailyEntry, lobbyEntry, soloEntry } from '../game/testGames';
import { FriendsApiError, parseSharedSummary, SHARED_FORMAT, type FriendsApi } from './friendsApi';
import { shareProfile } from './profileShare';
import { sharedSummary } from './sharedSummary';

/*
 * What a player shares with friends (Dev Plan item 18cb): worked out on
 * their own device, from the games friends can see.
 */

const NOW = Date.UTC(2026, 9, 9, 12);
const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
const games = (entries: HistoryEntry[]) => entries.map((entry) => ({ entry, replayed: replayEntry(entry)! }));
const words = [['beach'], ['crane'], ['storm'], ['house']];

describe('a shared summary', () => {
  it("leaves out a Daily Set until the day after it is over, from the count, stats and badges", () => {
    const today = dailyDay(NOW);
    const entries = [
      soloEntry('solo', NOW - 60_000, ['crane', 'beach']),
      dailyEntry('daily-old', addDays(today, -2), NOW - 3 * 86_400_000, words),
      dailyEntry('daily-yesterday', addDays(today, -1), NOW - 86_400_000, words),
      dailyEntry('daily-today', today, NOW - 120_000, words),
    ];
    const summary = sharedSummary(games(entries), [], NOW, dayOf);
    expect(summary.games).toBe(2);
    expect(summary.stats.modes.daily.played).toBe(1);
    expect(summary.badges.every((b) => !['daily-yesterday', 'daily-today'].includes(b.gameId))).toBe(true);
    expect(summary.format).toBe(SHARED_FORMAT);
  });

  it('points at its best and fastest games, without a rating, and reads back as sent', () => {
    const lobby = { ...lobbyEntry('lobby', NOW - 60_000, words, { rank: 1 }), rating: { before: 1500, after: 1520 } } as HistoryEntry;
    const summary = sharedSummary(games([soloEntry('solo', NOW - 60_000, ['crane', 'beach']), lobby]), [], NOW, dayOf);
    expect(summary.featured.map((e) => e.id).sort()).toEqual(['lobby', 'solo']);
    expect(JSON.stringify(summary)).not.toContain('1520');
    expect(parseSharedSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
  });

  it('reads as not shared in a shape this version does not know, and keeps only known badges, each once', () => {
    const summary = sharedSummary(games([soloEntry('solo', NOW - 60_000, ['crane', 'beach'])]), [], NOW, dayOf);
    const sent = JSON.parse(JSON.stringify(summary));
    expect(parseSharedSummary({ ...sent, format: SHARED_FORMAT + 1 })).toBeNull();
    const badge = summary.badges[0];
    const read = parseSharedSummary({ ...sent, badges: [badge, badge, { ...badge, id: 'from-a-newer-app' }] });
    expect(read!.badges).toEqual([badge]);
  });
});

describe('a round of sharing', () => {
  beforeEach(() => {
    // Tests run in Node, which has no browser storage.
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    });
  });
  const fakeApi = (answers: (() => Promise<{ done: boolean }>)[]) => {
    const shared: unknown[] = [];
    const api = {
      indexStep: () => answers.shift()!(),
      share: async (summary: unknown) => {
        shared.push(summary);
      },
    } as unknown as FriendsApi;
    return { api, shared };
  };
  const history = games([soloEntry('solo', NOW - 60_000, ['crane', 'beach'])]).map((g) => ({ ...g, summary: summarizeGame(g.replayed) }));

  it('indexes, waiting out the limit of requests a minute, then sends the summary once a day unless it changes', async () => {
    const waits: number[] = [];
    const wait = async (ms: number) => {
      waits.push(ms);
    };
    const limited = () => Promise.reject(new FriendsApiError('too-many-requests', 429));
    const notDone = async () => ({ done: false });
    const done = async () => ({ done: true });
    const first = fakeApi([notDone, limited, done]);
    await shareProfile(first.api, 'acct', history, [], NOW, wait);
    expect(waits).toHaveLength(1);
    expect(first.shared).toHaveLength(1);
    // Unchanged, it isn't sent again the same day; a day on, it is.
    const second = fakeApi([done]);
    await shareProfile(second.api, 'acct', history, [], NOW + 60_000, wait);
    expect(second.shared).toHaveLength(0);
    const third = fakeApi([done]);
    await shareProfile(third.api, 'acct', history, [], NOW + 25 * 60 * 60 * 1000, wait);
    expect(third.shared).toHaveLength(1);
  });

  it('stops at any other failure, for the next round to try again', async () => {
    const { api, shared } = fakeApi([() => Promise.reject(new FriendsApiError('unreachable', 0))]);
    await expect(shareProfile(api, 'acct', history, [], NOW, async () => undefined)).rejects.toBeInstanceOf(FriendsApiError);
    expect(shared).toHaveLength(0);
  });
});
