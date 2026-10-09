import {
  DIFFICULTIES, FEATURES, isRankBy, isTimeControl, isTurnDays, type Difficulty, type Features, type RankBy, type Strength,
  type TimeControl,
} from '../game';

export type { Difficulty };

export type Mode = 'single' | 'two' | 'rush';
export type Opponent = 'computer' | 'friend' | 'random';
/** Which kind of Rush (README "Rush modes"). */
/** `daily` is the Daily Set and `dailyWord` the Daily Word, on the Daily card; the others are Word Sets. */
export type RushKind = 'solo' | 'daily' | 'dailyWord' | 'friends' | 'competitive';
export type { Strength };

/**
 * The choices made on the title screen, remembered so the next visit
 * pre-selects them, plus the in-game view preferences.
 */
export interface Settings {
  mode: Mode;
  opponent: Opponent;
  rushKind: RushKind;
  strength: Strength;
  /** Against a person: a live chess clock, or days per guess. */
  timeControl: TimeControl;
  /** Your difficulty: how much the app helps you track your own guesses. */
  difficulty: Difficulty;
  /** What a Word Set you start (Solo, or a lobby you open) ranks by: Rush or Crush. */
  rankBy: RankBy;
  /** Which Daily Set board opens: the last one picked, Crush the first time. */
  boardRankBy: RankBy;
  /**
   * Per difficulty: show the newest guess at the top instead of the bottom,
   * e.g. newest first on Hard and Extreme but oldest first on Medium.
   */
  newestFirst: Readonly<Record<Difficulty, boolean>>;
  /** Offer the tutorial on the title screen. Turned off from the tutorial's last step, or the profile. */
  showTutorial: boolean;
  /** The game keyboard's Enter on the right of the bottom row, Backspace on the left. Kept on this device only. */
  enterRight: boolean;
  /** Against a friend at Medium, send your marks with each guess for them to see (README "Two player vs. a friend"). */
  shareMarks: boolean;
  /** Signed in, other players can find you by searching for your name (README "Friends"). Synced. */
  findByName: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'single',
  opponent: 'computer',
  rushKind: 'solo',
  strength: 'skilled',
  timeControl: '1d',
  difficulty: 'medium',
  rankBy: 'crush',
  boardRankBy: 'crush',
  newestFirst: { easy: false, medium: false, hard: false, extreme: false },
  showTutorial: true,
  enterRight: false,
  shareMarks: true,
  findByName: true,
};

/** One guess order for every difficulty. */
const everyDifficulty = (value: boolean) =>
  Object.fromEntries(DIFFICULTIES.map((d) => [d, value])) as Record<Difficulty, boolean>;

const KEY = 'word-mastermind:settings:v1';
/** Before settings had their own key, difficulty and guess order were saved with the solo game. */
const LEGACY_SOLO_KEY = 'word-mastermind:solo:v1';

const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const parseJson = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    return typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/** Before guess order was set per difficulty, one choice applied to all. */
function parseNewestFirst(value: unknown): Record<Difficulty, boolean> {
  if (typeof value !== 'object' || value === null) return everyDifficulty(value === true);
  const byDifficulty = value as Record<string, unknown>;
  return Object.fromEntries(DIFFICULTIES.map((d) => [d, byDifficulty[d] === true])) as Record<Difficulty, boolean>;
}

/**
 * Reads settings defensively; anything missing or unknown falls back to the
 * default. Without saved settings, the legacy solo save's preferences are used.
 * A choice switched off for the launch (`features`) falls back too.
 */
export function parseSettings(raw: string | null, legacySoloRaw: string | null = null, features: Features = FEATURES): Settings {
  const data = parseJson(raw) ?? parseJson(legacySoloRaw)?.prefs;
  const s = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    mode: pick(s.mode, ['single', 'two', 'rush'] as const, d.mode),
    opponent: pick<Opponent>(s.opponent, ['computer', 'friend', ...(features.randomOpponent ? ['random' as const] : [])], d.opponent),
    rushKind: pick<RushKind>(s.rushKind, ['solo', 'daily', 'dailyWord', 'friends', ...(features.competitiveRush ? ['competitive' as const] : [])], d.rushKind),
    strength: pick(s.strength, ['casual', 'skilled', 'expert', 'mastermind'] as const, d.strength),
    // Before live games, only the days per guess were kept.
    timeControl: isTimeControl(s.timeControl) ? s.timeControl : isTurnDays(s.turnDays) ? `${s.turnDays}d` : d.timeControl,
    difficulty: pick(s.difficulty, DIFFICULTIES, d.difficulty),
    rankBy: isRankBy(s.rankBy) ? s.rankBy : d.rankBy,
    boardRankBy: isRankBy(s.boardRankBy) ? s.boardRankBy : d.boardRankBy,
    newestFirst: parseNewestFirst(s.newestFirst),
    showTutorial: s.showTutorial !== false,
    enterRight: s.enterRight === true,
    shareMarks: s.shareMarks !== false,
    findByName: s.findByName !== false,
  };
}

/** Browser storage can be missing or blocked (private windows), so failures are ignored. */
export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY), localStorage.getItem(LEGACY_SOLO_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage is a convenience; the game works without it.
  }
}
