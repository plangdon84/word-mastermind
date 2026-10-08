import type { Strength } from './computer';
import { addDays, isTopTen, isTopTenPercent, type DailyPlacement } from './daily';
import { DIFFICULTIES, type Difficulty } from './difficulty';
import { FEATURES, type Feature, type Features } from './features';
import { summarizeGame, type GameSummary } from './history';
import { STRENGTHS } from './records';
import { summarizeSoloRun } from './run';
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
   * Daily Rush's places, DAILY RUSH for finishing it; FRIENDS and
   * COMPETITIVE for the lobbies' and friend games'.
   */
  tag: 'SOLO' | 'VS CPU' | 'DAILY' | 'DAILY RUSH' | 'FRIENDS' | 'COMPETITIVE' | 'UNLOCKED' | null;
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

/** A VS CPU difficulty badge: beat this computer at this difficulty or harder. */
export const cpuBadgeId = (strength: Strength, difficulty: Difficulty) => `${strength}-cpu-${difficulty}`;

/** The badge for each step of unlocking modes (README "Unlocking modes"), and what its toast names. */
export const UNLOCKS: readonly { step: UnlockStep; label: string; title: string; how: string }[] = [
  { step: 'two-player', label: 'TWO PLAYER', title: 'Two player', how: 'win a single player game' },
  { step: 'solo-rush', label: 'SOLO RUSH', title: 'Solo Rush', how: 'win a two player game' },
  { step: 'all-rush', label: 'ALL RUSH', title: 'Every Rush', how: 'finish a Solo Rush with every word solved, none given up' },
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
  ...STRENGTHS.map((s, i): Badge => ({
    id: `rush-${s}`, family: 'rush', metal: LEVEL_METAL[s], tag: null, label: s.toUpperCase(),
    title: `Finish a Rush at ${title(s)} level or better`, pips: i + 1,
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
    title: "Finish in the top 10 of a day's Daily Rush leaderboard", count: 10,
  },
  {
    id: 'daily-top-10-percent', family: 'feat', metal: 'silver', tag: 'DAILY', label: 'TOP 10%',
    title: "Finish in the top 10% of a day's Daily Rush leaderboard", count: 10, feature: 'dailyTopTenPercent',
  },
  // Each difficulty is its own day's run, so a harder one doesn't award the easier.
  ...DIFFICULTIES.map((d): Badge => ({
    id: `daily-rush-${d}`, family: 'difficulty', metal: DIFFICULTY_METAL[d], tag: 'DAILY RUSH', label: d.toUpperCase(),
    title: `Finish the Daily Rush at ${title(d)}`, difficulty: d,
  })),
  ...DAILY_STREAKS.map((n, i): Badge => ({
    id: `daily-rush-streak-${n}`, family: 'streak', metal: COUNT_METALS[i], tag: 'DAILY RUSH', label: 'DAYS',
    title: `Finish the Daily Rush ${n} days in a row`, count: n,
  })),
  {
    id: 'friend-win', family: 'feat', metal: 'silver', tag: 'FRIENDS', label: 'VS WIN',
    title: 'Win a game against a friend',
  },
  {
    id: 'lobby-win', family: 'feat', metal: 'gold', tag: 'FRIENDS', label: 'FIRST',
    title: 'Finish first in a Rush with Friends', count: 1,
  },
  {
    id: 'competitive-win', family: 'feat', metal: 'ruby', tag: 'COMPETITIVE', label: 'FIRST',
    title: 'Finish first in a Competitive Rush against another player', count: 1, feature: 'competitiveRush',
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

export const BADGE_BY_ID: ReadonlyMap<string, Badge> = new Map(BADGES.map((b) => [b.id, b]));

export interface EarnedBadge {
  id: string;
  /** When the game that earned it ended. */
  at: number;
  /** The game that earned it. */
  gameId: string;
}

const harderOrEqual = (played: Difficulty, badge: Difficulty) => DIFFICULTIES.indexOf(played) >= DIFFICULTIES.indexOf(badge);

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
    // Suggest found the word for you, or near enough: no few-guesses badge.
    if (!suggested) for (const n of FEW_GUESSES) if (guesses <= n) ids.push(`solo-guesses-${n}`);
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
    if (summary.result === 'won') ids.push('friend-win');
    // Your friend found your word first, and you tied it with your final guess.
    if (summary.result === 'drawn' && replayed.game.first !== replayed.seat) ids.push('clutch');
  }
  // Every Rush's level, scored from your own run alone as Solo Rush is.
  if (replayed.mode === 'rush' || replayed.mode === 'daily' || replayed.mode === 'lobby') {
    const run = summarizeSoloRun(replayed.game);
    if (run) {
      const level = STRENGTHS.indexOf(run.level);
      STRENGTHS.forEach((s, i) => i <= level && ids.push(`rush-${s}`));
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
  let lastRushDay: string | null = null;
  let rushStreak = 0;
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
    // The Daily Rush streak counts its own days, which are UTC's.
    const { replayed } = row.game;
    if (replayed.mode === 'daily' && replayed.day !== lastRushDay) {
      rushStreak = lastRushDay !== null && replayed.day === addDays(lastRushDay, 1) ? rushStreak + 1 : 1;
      lastRushDay = replayed.day;
      for (const n of DAILY_STREAKS) if (rushStreak >= n) earn(`daily-rush-streak-${n}`, row);
    }
  }
  const places = [...daily].sort((a, b) => a.finishedAt - b.finishedAt);
  for (const [id, rule] of [['daily-top-10', isTopTen], ['daily-top-10-percent', isTopTenPercent]] as const) {
    const first = places.find(rule);
    if (first && !earned.has(id) && BADGE_BY_ID.has(id)) earned.set(id, { id, at: first.finishedAt, gameId: dailyGameId(first.day) });
  }
  for (const unlock of computeUnlocks(games)) {
    earned.set(`unlock-${unlock.step}`, { id: `unlock-${unlock.step}`, at: unlock.at, gameId: unlock.gameId });
  }
  // Achievement Hunter, earned with the badge that takes you past each share of the rest.
  const others = [...earned.values()].sort((a, b) => a.at - b.at);
  for (const n of HUNTER_PERCENTS) {
    const needed = Math.ceil((HUNTED_BADGES * n) / 100);
    const reached = others[needed - 1];
    if (reached) earned.set(`hunter-${n}`, { id: `hunter-${n}`, at: reached.at, gameId: reached.gameId });
  }
  return [...earned.values()].sort((a, b) => a.at - b.at);
}
