import {
  ageRating, COMPUTER_RATINGS, computerRating, hostScore, isProvisional, NEW_RATING, rateGame, rateVsComputer, replayPvp,
  updateRating, type PvpRecord, type Rating,
} from '../../src/game';

/*
 * Re-rating every rated game under today's rules (Dev Plan item 19zh,
 * `npm run rerate`): replays every rated two player game in the order it
 * was rated, from a new player's rating, with the weeks between games
 * widening RD as the worker does (`currentRating`), and each game's result
 * from its record. The replay is first run under the rules the games were
 * rated by, and must give back every stored rating, before anything is
 * written. Competitive Rush (`rush`) is left alone: its shared places
 * already counted as plain draws (`rateGroup`).
 */

/** A row of `rated_games`. */
export interface RatedGameRow {
  game_id: string;
  account_id: string;
  pool: string;
  rating_before: number;
  rd_before: number | null;
  rating_after: number;
  rd_after: number;
  rated_at: number;
  computer_recall: number | null;
}

/** A row of `ratings`. */
export interface RatingRow {
  account_id: string;
  pool: string;
  rating: number;
  rd: number;
  volatility: number;
  games: number;
  rated_at: number;
  computer_games: number;
}

/** The rules a replay rates by. */
export interface Rules {
  game: (a: Rating, b: Rating, scoreA: 0 | 0.5 | 1) => [Rating, Rating];
  computer: (player: Rating, computer: Rating, score: 0 | 0.5 | 1) => Rating;
}

/** Today's rules: a draw is a plain Glicko-2 result (item 19zh). */
export const NEW_RULES: Rules = { game: rateGame, computer: rateVsComputer };

/**
 * The rules the games so far were rated by (item 18t to item 19zh): a draw
 * left rating and volatility where they were, and only narrowed RD.
 */
export const OLD_RULES: Rules = {
  game(a, b, scoreA) {
    const scoreB = (1 - scoreA) as 0 | 0.5 | 1;
    const rated: [Rating, Rating] = [updateRating(a, [{ opponent: b, score: scoreA }]), updateRating(b, [{ opponent: a, score: scoreB }])];
    return scoreA === 0.5
      ? [{ ...rated[0], rating: a.rating, volatility: a.volatility }, { ...rated[1], rating: b.rating, volatility: b.volatility }]
      : rated;
  },
  computer(player, computer, score) {
    const after = updateRating(player, [{ opponent: computer, score }]);
    if (score === 0.5) return { ...after, rating: player.rating, volatility: player.volatility };
    return isProvisional(player) ? after : { ...after, rating: player.rating + (after.rating - player.rating) / 2 };
  },
};

/** The pool Competitive Rush rates into, which a re-rating leaves alone. */
export const RUSH_POOL = 'rush';

/** One rated game, ready to replay: its players' scores, and against a computer, that computer's rating. */
export interface RatedGame {
  id: string;
  pool: string;
  ratedAt: number;
  /** Each player's account ID and score, one (against a computer) or two. */
  players: { accountId: string; score: 0 | 0.5 | 1 }[];
  computer: Rating | null;
}

/** Each player's change in one game, by `${gameId} ${accountId}`. */
export type Changes = Map<string, { before: Rating; after: Rating }>;

/** A replay's outcome: every game's changes, and each player's rating at the end. */
export interface Replay {
  changes: Changes;
  /** By `${accountId} ${pool}`. */
  ratings: Map<string, { rating: Rating; ratedAt: number; games: number; computerGames: number }>;
}

const rowKey = (gameId: string, accountId: string) => `${gameId} ${accountId}`;
const poolKey = (accountId: string, pool: string) => `${accountId} ${pool}`;

/**
 * Every rated game from its `rated_games` rows and records (by game ID), in
 * the order they were rated, or what's wrong with them. Each result comes
 * from the record: a draw, else a win for the host. Against a person, the
 * record doesn't say which account was the host, so the winner is the
 * player whose rating went up, which a win always does.
 */
export function ratedGames(rows: readonly RatedGameRow[], records: ReadonlyMap<string, string>): { games: RatedGame[]; problems: string[] } {
  const problems: string[] = [];
  const byGame = new Map<string, RatedGameRow[]>();
  for (const row of rows) {
    if (row.pool === RUSH_POOL) continue;
    byGame.set(row.game_id, [...(byGame.get(row.game_id) ?? []), row]);
  }
  const games: RatedGame[] = [];
  let n = 0;
  for (const [id, gameRows] of byGame) {
    n++;
    const name = `Rated game ${n} (rated at ${new Date(gameRows[0].rated_at).toISOString()})`;
    const [first] = gameRows;
    if (gameRows.some((r) => r.pool !== first.pool || r.rated_at !== first.rated_at)) {
      problems.push(`${name}: its rows differ in pool or time.`);
      continue;
    }
    const recall = first.computer_recall;
    const vsComputer = recall !== null;
    if (gameRows.length !== (vsComputer ? 1 : 2) || gameRows.some((r) => (r.computer_recall !== null) !== vsComputer)) {
      problems.push(`${name}: has ${gameRows.length} rows${vsComputer ? ' against a computer' : ''}. A player's rows go when their account is deleted.`);
      continue;
    }
    const text = records.get(id);
    let replayed: ReturnType<typeof replayPvp> | null = null;
    try {
      replayed = text === undefined ? null : replayPvp(JSON.parse(text) as PvpRecord);
    } catch {
      replayed = null;
    }
    const outcome = replayed?.ok ? replayed.game.outcome : null;
    if (!outcome || outcome.reason === 'cancelled') {
      problems.push(`${name}: ${text === undefined ? 'has no record' : 'its record has no result'}.`);
      continue;
    }
    if (vsComputer) {
      const computer = COMPUTER_RATINGS.find((c) => c.recall === recall);
      if (!computer) {
        problems.push(`${name}: no computer has recall ${recall}.`);
        continue;
      }
      // The player is always the host against a computer.
      games.push({ id, pool: first.pool, ratedAt: first.rated_at, players: [{ accountId: first.account_id, score: hostScore(outcome) }], computer: computerRating(computer) });
      continue;
    }
    if (outcome.winner === null) {
      games.push({ id, pool: first.pool, ratedAt: first.rated_at, players: gameRows.map((r) => ({ accountId: r.account_id, score: 0.5 })), computer: null });
      continue;
    }
    const up = gameRows.filter((r) => r.rating_after > r.rating_before);
    if (up.length !== 1) {
      problems.push(`${name}: was won, but not by exactly one player's rating going up.`);
      continue;
    }
    games.push({
      id, pool: first.pool, ratedAt: first.rated_at,
      players: gameRows.map((r) => ({ accountId: r.account_id, score: r === up[0] ? 1 : 0 })), computer: null,
    });
  }
  games.sort((a, b) => a.ratedAt - b.ratedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { games, problems };
}

/** Every game rated again in order under `rules`, each player from a new rating, as the worker rates them. */
export function replay(games: readonly RatedGame[], rules: Rules): Replay {
  const changes: Changes = new Map();
  const ratings: Replay['ratings'] = new Map();
  const going = (accountId: string, pool: string, now: number): Rating => {
    const kept = ratings.get(poolKey(accountId, pool));
    return kept ? ageRating(kept.rating, now - kept.ratedAt) : NEW_RATING;
  };
  for (const game of games) {
    const before = game.players.map((p) => going(p.accountId, game.pool, game.ratedAt));
    const after = game.computer
      ? [rules.computer(before[0], game.computer, game.players[0].score)]
      : rules.game(before[0], before[1], game.players[0].score);
    game.players.forEach(({ accountId }, i) => {
      changes.set(rowKey(game.id, accountId), { before: before[i], after: after[i] });
      const kept = ratings.get(poolKey(accountId, game.pool));
      ratings.set(poolKey(accountId, game.pool), {
        rating: after[i], ratedAt: game.ratedAt, games: (kept?.games ?? 0) + 1,
        computerGames: (kept?.computerGames ?? 0) + (game.computer ? 1 : 0),
      });
    });
  }
  return { changes, ratings };
}

/**
 * Whether two numbers are the same: exactly, or with `loose`, to within
 * a billionth of a point, for a rating written as SQL text, which SQLite
 * may read back a last binary digit off.
 */
const same = (a: number, b: number, loose: boolean) => a === b || (loose && Math.abs(a - b) <= 1e-9);

type Kept = Replay['ratings'] extends Map<string, infer V> ? V : never;

/** Rows written before `rd_before` was kept (migration 0010) have none, so it isn't compared. */
const sameRow = (row: RatedGameRow, change: { before: Rating; after: Rating } | undefined, loose = false) =>
  change !== undefined && same(row.rating_before, change.before.rating, loose)
  && (row.rd_before === null || same(row.rd_before, change.before.rd, loose))
  && same(row.rating_after, change.after.rating, loose) && same(row.rd_after, change.after.rd, loose);

const sameRating = (row: RatingRow, kept: Kept | undefined, loose = false) =>
  kept !== undefined && same(row.rating, kept.rating.rating, loose) && same(row.rd, kept.rating.rd, loose)
  && same(row.volatility, kept.rating.volatility, loose)
  && row.games === kept.games && row.rated_at === kept.ratedAt && row.computer_games === kept.computerGames;

/** What a re-rating would do: what's wrong first, else the rows to change. */
export interface RerateCheck {
  problems: string[];
  games: number;
  draws: number;
  /** Rows already as the new rules have them, from an earlier, interrupted write. */
  alreadyNew: number;
  /** The `ratings` rows to change: each row as it is, and as it will be. */
  ratings: { row: RatingRow; rating: Rating }[];
  /** The `rated_games` rows to change. */
  rows: { row: RatedGameRow; before: Rating; after: Rating }[];
}

/**
 * Checks the stored ratings against both replays and lists what to
 * change. Every stored value must be exactly the old rules' (or, after an
 * earlier write, the new rules'); anything else stops the re-rating.
 */
export function checkRerate(rows: readonly RatedGameRow[], ratings: readonly RatingRow[], records: ReadonlyMap<string, string>): RerateCheck {
  const { games, problems } = ratedGames(rows, records);
  const old = replay(games, OLD_RULES);
  const next = replay(games, NEW_RULES);
  const check: RerateCheck = {
    problems, games: games.length, draws: games.filter((g) => g.players[0].score === 0.5).length, alreadyNew: 0, ratings: [], rows: [],
  };
  for (const row of rows) {
    if (row.pool === RUSH_POOL) continue;
    const key = rowKey(row.game_id, row.account_id);
    const now = next.changes.get(key)!;
    if (!old.changes.has(key)) continue; // A problem game, listed already.
    if (sameRow(row, now, true)) {
      if (!sameRow(row, old.changes.get(key))) check.alreadyNew++;
      if (row.rd_before !== null) continue;
    } else if (!sameRow(row, old.changes.get(key))) {
      problems.push(`A rated game's change (rated at ${new Date(row.rated_at).toISOString()}) isn't what the replay gives.`);
      continue;
    }
    check.rows.push({ row, before: now.before, after: now.after });
  }
  const seen = new Set<string>();
  for (const row of ratings) {
    if (row.pool === RUSH_POOL) continue;
    const key = poolKey(row.account_id, row.pool);
    seen.add(key);
    const now = next.ratings.get(key);
    if (sameRating(row, now, true)) {
      if (!sameRating(row, old.ratings.get(key))) check.alreadyNew++;
      continue;
    }
    if (!sameRating(row, old.ratings.get(key))) {
      problems.push(`A rating (last rated at ${new Date(row.rated_at).toISOString()}) isn't what the replay gives.`);
      continue;
    }
    check.ratings.push({ row, rating: now!.rating });
  }
  const unseen = [...next.ratings.keys()].filter((key) => !seen.has(key)).length;
  if (unseen > 0) problems.push(`${unseen} players' rated games have no rating.`);
  return check;
}

const quoted = (text: string) => `'${text.replaceAll("'", "''")}'`;

/** A number as SQL: the shortest text that reads back as the same number. */
const real = (value: number) => {
  if (!Number.isFinite(value)) throw new Error('Not a finite number');
  return String(value);
};

/**
 * The SQL that writes a re-rating. Each rating changes only while it's the
 * row it was read as (the same games and time), so a game rated meanwhile
 * keeps its rating, to be found by the check afterwards. `restore` gives
 * the SQL that puts every row back as it was read.
 */
export function rerateSql(check: RerateCheck, restore = false): string {
  const ratings = check.ratings.map(({ row, rating }) => {
    const set = restore ? row : rating;
    return `UPDATE ratings SET rating = ${real(set.rating)}, rd = ${real(set.rd)}, volatility = ${real(set.volatility)}`
      + ` WHERE account_id = ${quoted(row.account_id)} AND pool = ${quoted(row.pool)} AND games = ${row.games} AND rated_at = ${row.rated_at};`;
  });
  const rows = check.rows.map(({ row, before, after }) => {
    const [ratingBefore, rdBefore, ratingAfter, rdAfter] = restore
      ? [real(row.rating_before), row.rd_before === null ? 'NULL' : real(row.rd_before), real(row.rating_after), real(row.rd_after)]
      : [real(before.rating), real(before.rd), real(after.rating), real(after.rd)];
    return `UPDATE rated_games SET rating_before = ${ratingBefore}, rd_before = ${rdBefore}, rating_after = ${ratingAfter}, rd_after = ${rdAfter}`
      + ` WHERE game_id = ${quoted(row.game_id)} AND account_id = ${quoted(row.account_id)};`;
  });
  return [...ratings, ...rows].join('\n');
}
