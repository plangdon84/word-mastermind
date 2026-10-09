import type { Strength } from './computer';
import { addDays, finishedLate, isTopTen, isTopTenPercent, type DailyPlacement } from './daily';
import { DIFFICULTIES, type Difficulty } from './difficulty';
import { FEATURES, type Feature, type Features } from './features';
import { summarizeGame, type GameSummary } from './history';
import { otherSeat } from './pvp';
import { STRENGTHS } from './records';
import { runRankBy, summarizeSoloRun } from './run';
import { RANK_BYS, type RankBy } from './scoring';
import type { StatsGame } from './stats';
import { computeUnlocks, type UnlockStep } from './unlocks';

/*
 * Achievements (README "Achievements"): each badge is a rule over the saved
 * games, checked in the order the games ended, so a badge's date is when the
 * game that earned it ended. Nothing is stored; the server can reuse this.
 */

export type Metal = 'jade' | 'bronze' | 'silver' | 'gold' | 'ruby';

/** The badge's shape: circle, hexagon, shield, and the two families added later. */
export type BadgeFamily = 'difficulty' | 'rush' | 'guesses' | 'streak' | 'feat';

export interface Badge {
  id: string;
  family: BadgeFamily;
  metal: Metal;
  /**
   * SOLO or VS CPU, for badges earned separately in each; DAILY for the
   * Daily Rush's places, DAILY SET and DAILY WORD for finishing them; FRIENDS and
   * COMPETITIVE for the lobbies' and friend games'; RUSH and CRUSH for a
   * Word Set's level, by time or by guesses.
   */
  tag: 'SOLO' | 'VS CPU' | 'DAILY' | 'DAILY SET' | 'DAILY WORD' | 'FRIENDS' | 'COMPETITIVE' | 'UNLOCKED' | 'RUSH' | 'CRUSH' | null;
  /** The word across the bottom, e.g. HARD, GUESSES, WINS. */
  label: string;
  /** What earns it, e.g. "Beat the Expert computer at Hard or harder". */
  title: string;
  /**
   * Difficulty: which. Rush: the level's pips (1–4); VS CPU difficulty: the
   * computer's strength as pips (1–4). Guesses and streaks: the number.
   */
  difficulty?: Difficulty;
  pips?: number;
  count?: number;
  /** The launch switch its mode needs: while that's off, the badge isn't offered. */
  feature?: Feature;
  /**
   * Added after Achievement Hunter's levels could be reached (Dev Plan item
   * 18o): it counts only toward a level not yet reached without it, so a
   * Hunter badge already earned stays earned.
   */
  addedLater?: true;
}

const DIFFICULTY_METAL: Record<Difficulty, Metal> = { easy: 'jade', medium: 'bronze', hard: 'silver', extreme: 'gold' };
const LEVEL_METAL: Record<Strength, Metal> = { casual: 'bronze', skilled: 'silver', expert: 'gold', mastermind: 'ruby' };
const COUNT_METALS: readonly Metal[] = ['bronze', 'silver', 'gold'];
const title = (word: string) => word[0].toUpperCase() + word.slice(1);

/** Guess counts for the few-guesses badges, easiest first. */
export const FEW_GUESSES = [20, 15, 10] as const;
export const WIN_STREAKS = [3, 5, 10] as const;

/**
 * Whether Suggest kept a found word from a few-guesses badge it would have
 * earned (README "Achievements"), so the result can say so.
 */
export const suggestVoidedFewGuesses = (found: boolean, guesses: number, suggested: number) =>
  found && suggested > 0 && guesses <= FEW_GUESSES[0];
export const DAILY_STREAKS = [7, 30, 100] as const;
/** Achievement Hunter: this percentage of every other badge. */
export const HUNTER_PERCENTS = [25, 50, 75, 100] as const;
const HUNTER_METALS: readonly Metal[] = ['bronze', 'silver', 'gold', 'ruby'];

const SIDES = [
  { key: 'solo', tag: 'SOLO', verb: 'Solve a word' },
  { key: 'cpu', tag: 'VS CPU', verb: 'Beat the computer' },
] as const;

/**
 * A Word Set's level badge: a Crush's by guesses (`rush-skilled`, the ID
 * from before Rush and Crush) or a Rush's by time (`rush-time-skilled`).
 */
export const levelBadgeId = (rankBy: RankBy, strength: Strength) =>
  rankBy === 'crush' ? `rush-${strength}` : `rush-time-${strength}`;

/** A VS CPU difficulty badge: beat this computer at this difficulty or harder. */
export const cpuBadgeId = (strength: Strength, difficulty: Difficulty) => `${strength}-cpu-${difficulty}`;

/** The badge for each step of unlocking modes (README "Unlocking modes"), and what its toast names. */
export const UNLOCKS: readonly { step: UnlockStep; label: string; title: string; how: string }[] = [
  { step: 'two-player', label: 'TWO PLAYER', title: 'Two player', how: 'win a Practice game' },
  { step: 'solo-rush', label: 'WORD SETS', title: 'Word Sets', how: 'win a two player game' },
  { step: 'all-rush', label: 'ALL SETS', title: 'Daily Set, Daily Word and With friends', how: 'finish a Solo Rush or Solo Crush with every word solved, none given up' },
];

/** Every badge, including those of modes switched off, in the order the profile shows them. */
const ALL_BADGES: readonly Badge[] = [
  ...DIFFICULTIES.map((d): Badge => ({
    id: `solo-${d}`, family: 'difficulty', metal: DIFFICULTY_METAL[d], tag: 'SOLO', label: d.toUpperCase(),
    title: `Solve a word at ${title(d)} or harder`, difficulty: d,
  })),
  ...STRENGTHS.flatMap((s, i) => DIFFICULTIES.map((d): Badge => ({
    id: cpuBadgeId(s, d), family: 'difficulty', metal: DIFFICULTY_METAL[d], tag: 'VS CPU', label: d.toUpperCase(),
    title: `Beat the ${title(s)} computer at ${title(d)} or harder`, difficulty: d, pips: i + 1,
  }))),
  // A Crush's level, by guesses: every Rush was scored that way before Rush and Crush, so these keep their IDs.
  ...STRENGTHS.map((s, i): Badge => ({
    id: levelBadgeId('crush', s), family: 'rush', metal: LEVEL_METAL[s], tag: 'CRUSH', label: s.toUpperCase(),
    title: `Finish a Crush at ${title(s)} level or better`, pips: i + 1,
  })),
  // A Rush's level, by time (Dev Plan item 18z).
  ...STRENGTHS.map((s, i): Badge => ({
    id: levelBadgeId('rush', s), family: 'rush', metal: LEVEL_METAL[s], tag: 'RUSH', label: s.toUpperCase(),
    title: `Finish a Rush at ${title(s)} level or better, by time`, pips: i + 1, addedLater: true,
  })),
  ...SIDES.flatMap(({ key, tag, verb }) => FEW_GUESSES.map((n, i): Badge => ({
    id: `${key}-guesses-${n}`, family: 'guesses', metal: COUNT_METALS[i], tag, label: 'GUESSES',
    title: `${verb} in ${n} guesses or fewer, without Suggest`, count: n,
  }))),
  ...WIN_STREAKS.map((n, i): Badge => ({
    id: `win-streak-${n}`, family: 'streak', metal: COUNT_METALS[i], tag: null, label: 'WINS',
    title: `Win ${n} two-player games in a row`, count: n,
  })),
  ...DAILY_STREAKS.map((n, i): Badge => ({
    id: `daily-${n}`, family: 'streak', metal: COUNT_METALS[i], tag: null, label: 'DAYS',
    title: `Finish a game ${n} days in a row`, count: n,
  })),
  {
    id: 'clutch', family: 'feat', metal: 'gold', tag: null, label: 'CLUTCH',
    title: 'Tie the game with your last chance',
  },
  {
    id: 'daily-top-10', family: 'feat', metal: 'gold', tag: 'DAILY', label: 'TOP 10',
    title: "Finish in the top 10 of a day's Daily Set leaderboard", count: 10,
  },
  {
    id: 'daily-top-10-percent', family: 'feat', metal: 'silver', tag: 'DAILY', label: 'TOP 10%',
    title: "Finish in the top 10% of a day's Daily Set leaderboard", count: 10, feature: 'dailyTopTenPercent',
  },
  // Each difficulty is its own day's run, so a harder one doesn't award the easier.
  ...DIFFICULTIES.map((d): Badge => ({
    id: `daily-rush-${d}`, family: 'difficulty', metal: DIFFICULTY_METAL[d], tag: 'DAILY SET', label: d.toUpperCase(),
    title: `Finish the Daily Set at ${title(d)}`, difficulty: d,
  })),
  ...DAILY_STREAKS.map((n, i): Badge => ({
    id: `daily-rush-streak-${n}`, family: 'streak', metal: COUNT_METALS[i], tag: 'DAILY SET', label: 'DAYS',
    title: `Finish the Daily Set ${n} days in a row`, count: n,
  })),
  // The Daily Word (Dev Plan item 7b): its own streak, on its own days.
  ...DAILY_STREAKS.map((n, i): Badge => ({
    id: `daily-word-streak-${n}`, family: 'streak', metal: COUNT_METALS[i], tag: 'DAILY WORD', label: 'DAYS',
    title: `Find the Daily Word ${n} days in a row`, count: n, addedLater: true,
  })),
  {
    id: 'friend-win', family: 'feat', metal: 'silver', tag: 'FRIENDS', label: 'VS WIN',
    title: 'Win a game against a friend',
  },
  {
    id: 'friend-harder', family: 'feat', metal: 'gold', tag: 'FRIENDS', label: 'HARDER',
    title: 'Beat a friend while playing at a harder level than them', count: 1, addedLater: true,
  },
  {
    id: 'friend-harder-2', family: 'feat', metal: 'ruby', tag: 'FRIENDS', label: 'HARDER',
    title: 'Beat a friend while playing two or more levels harder than them', count: 2, addedLater: true,
  },
  {
    id: 'clairvoyant', family: 'feat', metal: 'gold', tag: null, label: 'CLAIRVOYANT',
    title: 'Clairvoyant: find a word with your first guess, without Suggest', addedLater: true,
  },
  {
    id: 'lobby-win', family: 'feat', metal: 'gold', tag: 'FRIENDS', label: 'FIRST',
    title: 'Finish first in a Rush or Crush with Friends', count: 1,
  },
  {
    id: 'competitive-win', family: 'feat', metal: 'ruby', tag: 'COMPETITIVE', label: 'FIRST',
    title: 'Finish first in a Competitive Rush or Crush against another player', count: 1, feature: 'competitiveRush',
  },
  ...UNLOCKS.map(({ step, label, title: name, how }, i): Badge => ({
    id: `unlock-${step}`, family: 'feat', metal: COUNT_METALS[i], tag: 'UNLOCKED', label, title: `${name} unlocked: ${how}`,
  })),
  ...HUNTER_PERCENTS.map((n, i): Badge => ({
    id: `hunter-${n}`, family: 'feat', metal: HUNTER_METALS[i], tag: null, label: 'HUNTER',
    title: `Earn ${n === 100 ? 'every other badge' : `${n}% of the other badges`}`, count: n,
  })),
];

/** The badges offered with these launch switches: a mode that's off can't earn one, so it isn't counted either. */
export const badgesFor = (features: Features): readonly Badge[] => ALL_BADGES.filter((b) => !b.feature || features[b.feature]);

/** Every badge that can be earned now, in the order the profile shows them. */
export const BADGES: readonly Badge[] = badgesFor(FEATURES);

/** How many badges Achievement Hunter counts: every one offered but its own. */
export const HUNTED_BADGES = BADGES.filter((b) => !b.id.startsWith('hunter-')).length;

/** How many it counted before the badges `addedLater`, which a Hunter level already reached doesn't need. */
const HUNTED_BEFORE = BADGES.filter((b) => !b.id.startsWith('hunter-') && !b.addedLater).length;

export const BADGE_BY_ID: ReadonlyMap<string, Badge> = new Map(BADGES.map((b) => [b.id, b]));

export interface EarnedBadge {
  id: string;
  /** When the game that earned it ended. */
  at: number;
  /** The game that earned it. */
  gameId: string;
}

const harderOrEqual = (played: Difficulty, badge: Difficulty) => DIFFICULTIES.indexOf(played) >= DIFFICULTIES.indexOf(badge);

/** How many levels harder `yours` is than `theirs` (Easy < Medium < Hard < Extreme); negative if easier. */
const levelsHarder = (yours: Difficulty, theirs: Difficulty) => DIFFICULTIES.indexOf(yours) - DIFFICULTIES.indexOf(theirs);

/** A word you found (README "Achievements"), with the difficulty it counts at and whether Suggest helped. */
interface Solve {
  guesses: number;
  difficulty: Difficulty;
  suggested: boolean;
}

/**
 * Every word you solved in a game, in any mode: single player's word if you
 * won, each word found in a Rush, and in two player the opponent's word if
 * you found it (a win, or a draw on your final guess).
 */
function solves(game: StatsGame, summary: GameSummary): Solve[] {
  const { replayed } = game;
  switch (replayed.mode) {
    case 'single': {
      const { game: g } = replayed;
      return g.status === 'won' ? [{ guesses: g.guesses.length, difficulty: summary.difficulty, suggested: g.suggested > 0 }] : [];
    }
    case 'computer': {
      const { game: g } = replayed;
      return g.humanGuesses.some((r) => r.isWin)
        ? [{ guesses: g.humanGuesses.length, difficulty: summary.difficulty, suggested: g.suggested > 0 }]
        : [];
    }
    case 'friend': {
      const { game: g, seat } = replayed;
      return g.guesses[seat].some((r) => r.isWin)
        ? [{ guesses: g.guesses[seat].length, difficulty: summary.difficulty, suggested: g.suggested[seat] > 0 }]
        : [];
    }
    case 'rush':
    case 'daily':
    case 'dailyWord':
    case 'lobby':
      return replayed.game.results
        .filter((r) => r.outcome === 'solved')
        .map((r) => ({ guesses: r.guesses.length, difficulty: summary.difficulty, suggested: r.suggested > 0 }));
  }
}

/** Whether you used Suggest in a game against the computer. */
const suggestedVsCpu = (game: StatsGame) => game.replayed.mode === 'computer' && game.replayed.game.suggested > 0;

/** The badges one game earns on its own, whatever came before. */
function gameBadges(game: StatsGame, summary: GameSummary): string[] {
  const ids: string[] = [];
  for (const { guesses, difficulty, suggested } of solves(game, summary)) {
    for (const d of DIFFICULTIES) if (harderOrEqual(difficulty, d)) ids.push(`solo-${d}`);
    // Suggest found the word for you, or near enough: no few-guesses badge, and no Clairvoyant.
    if (!suggested) for (const n of FEW_GUESSES) if (guesses <= n) ids.push(`solo-guesses-${n}`);
    if (!suggested && guesses === 1) ids.push('clairvoyant');
  }
  const { replayed } = game;
  if (replayed.mode === 'computer') {
    if (summary.result === 'won' && summary.strength) {
      // A stronger computer also awards the weaker ones, and a harder difficulty the easier.
      const beaten = STRENGTHS.indexOf(summary.strength);
      for (const s of STRENGTHS.slice(0, beaten + 1)) {
        for (const d of DIFFICULTIES) if (harderOrEqual(summary.difficulty, d)) ids.push(cpuBadgeId(s, d));
      }
      if (!suggestedVsCpu(game)) for (const n of FEW_GUESSES) if (summary.yourGuesses <= n) ids.push(`cpu-guesses-${n}`);
    }
    // A draw where the computer found your word first: you tied it with your final guess.
    if (summary.result === 'drawn' && replayed.game.first === 'computer') ids.push('clutch');
  }
  if (replayed.mode === 'friend') {
    if (summary.result === 'won') {
      ids.push('friend-win');
      // Only a win where you found their word: not their giving up or running out of time before you did
      // (their time running out on the final guess after you found it still counts). Each at the easiest
      // level they used, as scoring counts it, so switching mid-game can't earn it.
      const { game: g, seat } = replayed;
      const harder = levelsHarder(g.scoredDifficulty[seat], g.scoredDifficulty[otherSeat(seat)]);
      if (g.guesses[seat].some((r) => r.isWin)) {
        if (harder >= 1) ids.push('friend-harder');
        if (harder >= 2) ids.push('friend-harder-2');
      }
    }
    // Your friend found your word first, and you tied it with your final guess.
    if (summary.result === 'drawn' && replayed.game.first !== replayed.seat) ids.push('clutch');
  }
  // Every Word Set's level, scored from your own run alone as Solo Rush is: a Rush's by time, a Crush's by
  // guesses. The Daily Set is on both boards, so it earns both.
  if (replayed.mode === 'rush' || replayed.mode === 'daily' || replayed.mode === 'lobby') {
    const rankBys = replayed.mode === 'daily' ? RANK_BYS : [runRankBy(replayed.game)];
    for (const rankBy of rankBys) {
      const run = summarizeSoloRun(replayed.game, rankBy);
      if (!run) continue;
      const level = STRENGTHS.indexOf(run.level);
      STRENGTHS.forEach((s, i) => i <= level && ids.push(levelBadgeId(rankBy, s)));
    }
  }
  if (replayed.mode === 'daily') ids.push(`daily-rush-${summary.difficulty}`);
  if (replayed.mode === 'lobby' && summary.place?.rank === 1) {
    const people = replayed.places.filter((p) => p.strength === null).length;
    if (replayed.kind === 'friends' && replayed.places.length >= 2) ids.push('lobby-win');
    // Competitive Rush is rated only against people, so its win needs one.
    if (replayed.kind === 'competitive' && people >= 2) ids.push('competitive-win');
  }
  return ids;
}

/** The ID a Daily Rush day's badges are earned by: the run is on the server, not in the history. */
export const dailyGameId = (day: string) => `daily:${day}`;

/**
 * Every badge earned, in the order they were earned. `dayOf` turns a time into
 * a local day number (consecutive days differ by 1), for the daily streak.
 * `daily` is your final places on past days' Daily Rush leaderboards (on your
 * difficulty), from the server.
 */
export function computeAchievements(
  games: readonly StatsGame[], dayOf: (ms: number) => number, daily: readonly DailyPlacement[] = [],
): EarnedBadge[] {
  const rows = games
    .map((game) => ({ game, summary: summarizeGame(game.replayed) }))
    .sort((a, b) => a.summary.endedAt - b.summary.endedAt);
  const earned = new Map<string, EarnedBadge>();
  const earn = (id: string, row: (typeof rows)[number]) => {
    // A switched-off mode's badge (from a game played before) isn't offered.
    if (!earned.has(id) && BADGE_BY_ID.has(id)) earned.set(id, { id, at: row.summary.endedAt, gameId: row.game.id });
  };
  let winStreak = 0;
  let lastDay: number | null = null;
  let dayStreak = 0;
  /** Each daily game's streak, on its own days, which change at midnight in New York. */
  const dailyStreaks = {
    daily: { last: null as string | null, run: 0, badge: 'daily-rush-streak' },
    dailyWord: { last: null as string | null, run: 0, badge: 'daily-word-streak' },
  };
  for (const row of rows) {
    for (const id of gameBadges(row.game, row.summary)) earn(id, row);
    if (row.summary.result !== null && (row.summary.mode === 'computer' || row.summary.mode === 'friend')) {
      winStreak = row.summary.result === 'won' ? winStreak + 1 : 0;
      for (const n of WIN_STREAKS) if (winStreak >= n) earn(`win-streak-${n}`, row);
    }
    const day = dayOf(row.summary.endedAt);
    if (day !== lastDay) {
      dayStreak = lastDay !== null && day === lastDay + 1 ? dayStreak + 1 : 1;
      lastDay = day;
    }
    for (const n of DAILY_STREAKS) if (dayStreak >= n) earn(`daily-${n}`, row);
    // The Daily Set and Daily Word streaks count their own days, which change at midnight in New York.
    const { replayed } = row.game;
    // A run finished after its day ended isn't on the streak (README "Daily Rush").
    if (replayed.mode === 'daily' || replayed.mode === 'dailyWord') {
      const streak = dailyStreaks[replayed.mode];
      if (replayed.day !== streak.last && !finishedLate(replayed.day, replayed.game)) {
        streak.run = streak.last !== null && replayed.day === addDays(streak.last, 1) ? streak.run + 1 : 1;
        streak.last = replayed.day;
        for (const n of DAILY_STREAKS) if (streak.run >= n) earn(`${streak.badge}-${n}`, row);
      }
    }
  }
  // The top 10 badges are the Daily Set's: a place on the Daily Word's board doesn't count.
  const places = daily.filter((p) => p.mode !== 'dailyWord').sort((a, b) => a.finishedAt - b.finishedAt);
  for (const [id, rule] of [['daily-top-10', isTopTen], ['daily-top-10-percent', isTopTenPercent]] as const) {
    const first = places.find(rule);
    if (first && !earned.has(id) && BADGE_BY_ID.has(id)) earned.set(id, { id, at: first.finishedAt, gameId: dailyGameId(first.day) });
  }
  for (const unlock of computeUnlocks(games)) {
    earned.set(`unlock-${unlock.step}`, { id: `unlock-${unlock.step}`, at: unlock.at, gameId: unlock.gameId });
  }
  // Achievement Hunter, earned with the badge that takes you past each share of the rest. A level reached
  // counting only the badges from before `addedLater` ones stays reached, so it's whichever comes first.
  const others = [...earned.values()].sort((a, b) => a.at - b.at);
  const before = others.filter((e) => !BADGE_BY_ID.get(e.id)?.addedLater);
  for (const n of HUNTER_PERCENTS) {
    const reached = [before[Math.ceil((HUNTED_BEFORE * n) / 100) - 1], others[Math.ceil((HUNTED_BADGES * n) / 100) - 1]]
      .filter((e) => e !== undefined)
      .sort((a, b) => a.at - b.at)[0];
    if (reached) earned.set(`hunter-${n}`, { id: `hunter-${n}`, at: reached.at, gameId: reached.gameId });
  }
  return [...earned.values()].sort((a, b) => a.at - b.at);
}
