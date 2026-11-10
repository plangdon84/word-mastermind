import { describe, expect, it } from 'vitest';
import {
  computerRating, COMPUTER_RATINGS, concedePvp, createPvpGame, DAY_MS, submitPvpGuess, toPvpRecord, type PvpGame, type PvpResult, type Rating,
} from '../../src/game';
import { fakeD1 } from './fakeD1';
import { currentRating, ratingStatements, type PlayerChange } from './ratings';
import { checkRerate, NEW_RULES, OLD_RULES, parseRuleTime, rerateSql, type RatedGameRow, type RatingRow, type Rules } from './rerate';

const T = Date.UTC(2026, 9, 1);
const POOL = 'correspondence';

const ok = (result: PvpResult): PvpGame => {
  if (!result.ok) throw new Error(result.error);
  return result.game;
};

/** A finished game's record: the host wins, the guest wins (the host gives up) or a draw (both find the word). */
function record(result: 'host' | 'guest' | 'draw', at: number): string {
  let game = ok(createPvpGame({ host: 'storm', guest: 'beach' }, 'host', at, '1d', { host: 'medium', guest: 'medium' }, true));
  if (result === 'guest') game = ok(concedePvp(game, 'host', at + 1));
  else {
    game = ok(submitPvpGuess(game, 'host', 'beach', at + 1));
    game = ok(submitPvpGuess(game, 'guest', result === 'draw' ? 'storm' : 'crane', at + 2));
  }
  expect(game.status).toBe('over');
  return JSON.stringify(toPvpRecord(game));
}

/** A database whose rated games were rated by `rules` (or the rules at each game's time), the way the worker rates them. */
async function history(rulesAt: Rules | ((now: number) => Rules)) {
  const rulesOf = (now: number) => (typeof rulesAt === 'function' ? rulesAt(now) : rulesAt);
  const { db, sqlite } = fakeD1();
  for (const id of ['ann', 'bob', 'cat']) {
    sqlite.prepare('INSERT INTO accounts (id, email, created_at) VALUES (?, ?, 0)').run(id, `${id}@example.com`);
  }
  let n = 0;
  const save = async (now: number, result: 'host' | 'guest' | 'draw', changes: PlayerChange[], recall?: number) => {
    const id = `game-${++n}`;
    await db.batch([
      db.prepare(`INSERT INTO games (id, mode, version, record, started_at, finished_at) VALUES (?1, 'friend', 1, ?2, ?3, ?3)`)
        .bind(id, record(result, now - 10), now),
      ...ratingStatements(db, id, POOL, changes, now, recall),
    ]);
  };
  const score = (result: 'host' | 'guest' | 'draw'): 0 | 0.5 | 1 => (result === 'host' ? 1 : result === 'draw' ? 0.5 : 0);
  // Rated by `by`, as the worker does since it keeps each result (`score`), or else as before it did.
  const versus = async (now: number, host: string, guest: string, result: 'host' | 'guest' | 'draw', by?: Rules) => {
    const before = [await currentRating(db, host, POOL, now), await currentRating(db, guest, POOL, now)];
    const after = (by ?? rulesOf(now)).game(before[0], before[1], score(result));
    const scores = by ? { host: score(result), guest: (1 - score(result)) as 0 | 0.5 | 1 } : { host: undefined, guest: undefined };
    await save(now, result, [
      { accountId: host, before: before[0], after: after[0], score: scores.host },
      { accountId: guest, before: before[1], after: after[1], score: scores.guest },
    ]);
  };
  const computer = COMPUTER_RATINGS[2];
  const vsComputer = async (now: number, player: string, result: 'host' | 'guest' | 'draw') => {
    const before = await currentRating(db, player, POOL, now);
    await save(now, result, [{ accountId: player, before, after: rulesOf(now).computer(before, computerRating(computer), score(result)) }], computer.recall);
  };
  // Enough decisive games to settle Ann and Bob, then draws between unequal players, a week away, and the computer.
  for (let i = 0; i < 12; i++) await versus(T + i * 60_000, 'ann', 'bob', i % 3 === 2 ? 'guest' : 'host');
  await versus(T + DAY_MS, 'bob', 'ann', 'draw');
  await versus(T + DAY_MS + 1, 'cat', 'ann', 'draw');
  await versus(T + 9 * DAY_MS, 'ann', 'cat', 'guest');
  for (let i = 0; i < 10; i++) await vsComputer(T + 10 * DAY_MS + i, 'ann', i === 4 ? 'draw' : i % 2 ? 'host' : 'guest');
  await vsComputer(T + 30 * DAY_MS, 'cat', 'draw');
  return { db, sqlite, versus };
}

function read(sqlite: ReturnType<typeof fakeD1>['sqlite']) {
  const rows = sqlite.prepare('SELECT * FROM rated_games').all() as unknown as RatedGameRow[];
  const ratings = sqlite.prepare('SELECT * FROM ratings').all() as unknown as RatingRow[];
  const records = new Map((sqlite.prepare('SELECT id, record FROM games').all() as unknown as { id: string; record: string }[]).map((g) => [g.id, g.record]));
  return { rows, ratings, records };
}

const ratingOf = (sqlite: ReturnType<typeof fakeD1>['sqlite'], id: string) =>
  sqlite.prepare('SELECT rating, rd, volatility, games, computer_games FROM ratings WHERE account_id = ?').get(id) as unknown as Rating & { games: number };

describe('re-rating every rated game (Dev Plan item 19zh)', () => {
  it('replays the old rules to every stored rating, then writes what the new rules give, the same as rating the games afresh', async () => {
    const { sqlite } = await history(OLD_RULES);
    const { rows, ratings, records } = read(sqlite);
    const check = checkRerate(rows, ratings, records);
    expect(check.problems).toEqual([]);
    expect(check).toMatchObject({ games: 26, draws: 4, alreadyNew: 0 });
    expect(check.ratings.length).toBe(3);
    sqlite.exec(rerateSql(check));

    const fresh = await history(NEW_RULES);
    for (const id of ['ann', 'bob', 'cat']) {
      const now = ratingOf(sqlite, id);
      const want = ratingOf(fresh.sqlite, id);
      expect(now.games).toBe(want.games);
      for (const key of ['rating', 'rd', 'volatility'] as const) expect(now[key]).toBeCloseTo(want[key], 9);
    }
    const order = 'SELECT game_id, account_id, rating_before, rd_before, rating_after, rd_after FROM rated_games ORDER BY game_id, account_id';
    const written = sqlite.prepare(order).all() as unknown as Record<string, number>[];
    const wanted = fresh.sqlite.prepare(order).all() as unknown as Record<string, number>[];
    expect(written.length).toBe(wanted.length);
    written.forEach((row, i) => {
      for (const key of ['rating_before', 'rd_before', 'rating_after', 'rd_after']) expect(row[key]).toBeCloseTo(wanted[i][key], 9);
    });
    // Every row now keeps its result, for the usage dashboard.
    const scores = sqlite.prepare("SELECT game_id, account_id, score FROM rated_games WHERE game_id IN ('game-1', 'game-13', 'game-3')").all();
    expect(scores).toEqual(expect.arrayContaining([
      { game_id: 'game-1', account_id: 'ann', score: 1 }, { game_id: 'game-1', account_id: 'bob', score: 0 },
      { game_id: 'game-3', account_id: 'ann', score: 0 }, { game_id: 'game-3', account_id: 'bob', score: 1 },
      { game_id: 'game-13', account_id: 'bob', score: 0.5 }, { game_id: 'game-13', account_id: 'ann', score: 0.5 },
    ]));

    // Run again, it finds the work done and changes nothing.
    const again = read(sqlite);
    const after = checkRerate(again.rows, again.ratings, again.records);
    expect(after.problems).toEqual([]);
    expect(after.ratings).toEqual([]);
    expect(after.rows).toEqual([]);
    expect(after.alreadyNew).toBeGreaterThan(0);
  });

  it('takes a draw rated by the new rules after the deploy, given its time, and still ends as rating every game afresh', async () => {
    const { sqlite, versus } = await history(OLD_RULES);
    const deploy = T + 40 * DAY_MS;
    await versus(deploy + 1, 'bob', 'ann', 'draw', NEW_RULES);
    const { rows, ratings, records } = read(sqlite);
    // Without the deploy's time, the new draw matches neither replay.
    expect(checkRerate(rows, ratings, records).problems.length).toBeGreaterThan(0);
    const check = checkRerate(rows, ratings, records, { newRuleFrom: deploy });
    expect(check.problems).toEqual([]);
    sqlite.exec(rerateSql(check));

    const fresh = await history(NEW_RULES);
    await fresh.versus(deploy + 1, 'bob', 'ann', 'draw', NEW_RULES);
    for (const id of ['ann', 'bob']) {
      for (const key of ['rating', 'rd', 'volatility'] as const) expect(ratingOf(sqlite, id)[key]).toBeCloseTo(ratingOf(fresh.sqlite, id)[key], 9);
    }
    const again = read(sqlite);
    expect(checkRerate(again.rows, again.ratings, again.records, { newRuleFrom: deploy })).toMatchObject({ problems: [], ratings: [], rows: [] });
  });

  it("takes draws rated plainly before the old rule began (item 18t), given its time, as production's first draws were", async () => {
    // The day-1 draws are rated plainly, everything from day 5 by the old rule.
    const oldRuleFrom = T + 5 * DAY_MS;
    const { sqlite } = await history((now) => (now < oldRuleFrom ? NEW_RULES : OLD_RULES));
    const { rows, ratings, records } = read(sqlite);
    expect(checkRerate(rows, ratings, records).problems.length).toBeGreaterThan(0);
    const check = checkRerate(rows, ratings, records, { oldRuleFrom });
    expect(check.problems).toEqual([]);
    sqlite.exec(rerateSql(check));
    const fresh = await history(NEW_RULES);
    for (const id of ['ann', 'bob', 'cat']) {
      for (const key of ['rating', 'rd', 'volatility'] as const) expect(ratingOf(sqlite, id)[key]).toBeCloseTo(ratingOf(fresh.sqlite, id)[key], 9);
    }
    const again = read(sqlite);
    expect(checkRerate(again.rows, again.ratings, again.records, { oldRuleFrom })).toMatchObject({ problems: [], ratings: [], rows: [] });
  });

  it('takes all three periods: plain draws, then the old rule, then plain again after the deploy', async () => {
    const oldRuleFrom = T + 5 * DAY_MS;
    const newRuleFrom = T + 20 * DAY_MS;
    // The day-1 draws are plain, the computer draw on day 10 is the old rule's, Cat's on day 30 plain again.
    const { sqlite } = await history((now) => (now < oldRuleFrom || now >= newRuleFrom ? NEW_RULES : OLD_RULES));
    const { rows, ratings, records } = read(sqlite);
    // Without the old rule's start the day-1 draws match neither replay. (Cat's day-30 draw matches the new rules
    // even without the deploy's time, since nothing before it differs for Cat.)
    expect(checkRerate(rows, ratings, records, { newRuleFrom }).problems.length).toBeGreaterThan(0);
    const check = checkRerate(rows, ratings, records, { oldRuleFrom, newRuleFrom });
    expect(check.problems).toEqual([]);
    sqlite.exec(rerateSql(check));
    const fresh = await history(NEW_RULES);
    for (const id of ['ann', 'bob', 'cat']) {
      for (const key of ['rating', 'rd', 'volatility'] as const) expect(ratingOf(sqlite, id)[key]).toBeCloseTo(ratingOf(fresh.sqlite, id)[key], 9);
    }
  });

  it("accepts a stored value a last digit off the replay, as production's are, but nothing near a real rule difference", async () => {
    const { sqlite } = await history(OLD_RULES);
    const { rows, ratings, records } = read(sqlite);
    const offRating = (key: 'rating' | 'rd' | 'volatility', by: number) =>
      checkRerate(rows, ratings.map((r) => (r.account_id === 'cat' ? { ...r, [key]: r[key] * (1 + by) } : r)), records).problems;
    const offRow = (by: number) => checkRerate(rows.map((r) => (r.game_id === 'game-5' ? { ...r, rating_after: r.rating_after * (1 + by) } : r)), ratings, records).problems;
    for (const by of [5e-11, -5e-11]) {
      for (const key of ['rating', 'rd', 'volatility'] as const) expect(offRating(key, by)).toEqual([]);
      expect(offRow(by)).toEqual([]);
    }
    // A draw between two new players differs only in volatility, by 1.7e-5 of it; a much smaller gap is still caught.
    for (const by of [2e-9, -2e-9, 1.7e-5]) {
      for (const key of ['rating', 'rd', 'volatility'] as const) expect(offRating(key, by)).toHaveLength(1);
      expect(offRow(by).length).toBeGreaterThan(0);
    }
  });

  it('reads a rule time only as full ISO 8601 with its zone', () => {
    expect(parseRuleTime(undefined, -Infinity)).toBe(-Infinity);
    expect(parseRuleTime('2026-10-08T00:00:00Z', 0)).toBe(Date.UTC(2026, 9, 8));
    expect(parseRuleTime('2026-10-08T01:00+01:00', 0)).toBe(Date.UTC(2026, 9, 8));
    expect(parseRuleTime('2026-11-10T04:25:00.500Z', 0)).toBe(Date.UTC(2026, 10, 10, 4, 25, 0, 500));
    for (const bad of ['2026-10-08', '2026-10-08T00:00:00', '2026-10-08T00:00+0000', '1z', '12345Z', 'Oct 8 2026 +00:00']) {
      expect(parseRuleTime(bad, 0), bad).toBeNaN();
    }
  });

  it('moves a draw between unequal ratings: the lower rated player ends higher than before', async () => {
    const { sqlite } = await history(OLD_RULES);
    const { rows, ratings, records } = read(sqlite);
    const check = checkRerate(rows, ratings, records);
    // Bob, rated below Ann, drew her: under the old rules his rating didn't move.
    const draw = check.rows.find(({ row }) => row.game_id === 'game-13' && row.account_id === 'bob')!;
    expect(draw.row.rating_after).toBe(draw.row.rating_before);
    expect(draw.after.rating).toBeGreaterThan(draw.before.rating);
  });

  it('puts every row back as it was read with the restore SQL', async () => {
    const { sqlite } = await history(OLD_RULES);
    const before = read(sqlite);
    const check = checkRerate(before.rows, before.ratings, before.records);
    sqlite.exec(rerateSql(check));
    sqlite.exec(rerateSql(check, true));
    const restored = read(sqlite);
    expect(restored.ratings).toEqual(before.ratings);
    expect(restored.rows).toEqual(before.rows);
  });

  it("stops at a stored rating the old rules don't give, and writes nothing to a rating changed since it was read", async () => {
    const { sqlite } = await history(OLD_RULES);
    const { rows, ratings, records } = read(sqlite);
    const nudged = ratings.map((r) => (r.account_id === 'cat' ? { ...r, rating: r.rating + 0.001 } : r));
    expect(checkRerate(rows, nudged, records).problems).toHaveLength(1);

    const check = checkRerate(rows, ratings, records);
    // Another game is rated for Ann between the read and the write.
    sqlite.prepare('UPDATE ratings SET games = games + 1 WHERE account_id = ?').run('ann');
    const ann = ratingOf(sqlite, 'ann');
    sqlite.exec(rerateSql(check));
    expect(ratingOf(sqlite, 'ann')).toEqual(ann);
  });

  it('stops at a game missing a player (a deleted account), without a record, or without a result', async () => {
    const { sqlite } = await history(OLD_RULES);
    const { rows, ratings, records } = read(sqlite);
    const missing = rows.filter((r) => !(r.game_id === 'game-1' && r.account_id === 'bob'));
    expect(checkRerate(missing, ratings, records).problems.join(' ')).toContain('has 1 rows');
    const noRecord = new Map(records);
    noRecord.delete('game-2');
    expect(checkRerate(rows, ratings, noRecord).problems.join(' ')).toContain('has no record');
    const unfinished = new Map(records);
    const game = ok(createPvpGame({ host: 'storm', guest: 'beach' }, 'host', T, '1d', { host: 'medium', guest: 'medium' }, true));
    unfinished.set('game-3', JSON.stringify(toPvpRecord(game)));
    expect(checkRerate(rows, ratings, unfinished).problems.join(' ')).toContain('no result');
  });

  it('leaves Competitive Rush alone', async () => {
    const { sqlite } = await history(OLD_RULES);
    sqlite.prepare(`INSERT INTO ratings (account_id, pool, rating, rd, volatility, games, rated_at) VALUES ('ann', 'rush', 1600, 200, 0.06, 1, ?)`).run(T);
    sqlite.prepare(`INSERT INTO rated_games (game_id, account_id, pool, rating_before, rd_before, rating_after, rd_after, rated_at)
      VALUES ('lobby', 'ann', 'rush', 1500, 350, 1600, 200, ?)`).run(T);
    const { rows, ratings, records } = read(sqlite);
    const check = checkRerate(rows, ratings, records);
    expect(check.problems).toEqual([]);
    expect(rerateSql(check)).not.toContain("'rush'");
  });
});
