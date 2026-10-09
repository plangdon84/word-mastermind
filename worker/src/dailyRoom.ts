import {
  createRun, DAILY_PAUSES, dailyTotals, finishedLate, pausesUsed, pauseRun, resumeRun, shuffled, dailyView, dayEnd, endRun, replayRun, submitRunGuess, suggestRun, toRunRecord, type DailyDay, type DailyTotals,
  type DailyMode, type DailyView, type Difficulty, type RunRecord,
} from '../../src/game';
import type { DailyError } from '../../src/app/dailyApi';
import type { DailyTheme } from './dailyThemes';
import type { RoomStorage } from './room';

/*
 * The referee for one day's daily games, run by that day's Durable Object
 * (`dailyRush.ts`): the Daily Set (Daily Rush, `daily`) and the Daily Word
 * (`dailyWord`), a run of one word. It holds every player's runs for the day,
 * answers each player with their own run only, and never sends a word until
 * it's found. Like the game logic, it never reads the clock: the time is
 * passed in.
 */

/** What the referee keeps for each player: their run is its record, replayed on each request. */
export interface DailyEntry {
  playerId: string;
  /** Their name on the leaderboard. */
  name: string;
  record: RunRecord;
}

/** What the referee needs from outside: keeping a finished run in D1, for the leaderboard, and shuffling. */
export interface DailyDeps {
  /** `late`: finished after the day ended, so kept in the history but not on the board. */
  saveFinished(mode: DailyMode, day: DailyDay, entry: DailyEntry, totals: DailyTotals, late: boolean, now: number): Promise<void>;
  /** Orders each player's words: a number in [0, 1). */
  random(): number;
  /** The day's theme (`themeFor`, from D1), or null on a day without one. */
  themeFor(day: DailyDay): Promise<DailyTheme | null>;
  /** The day's Daily Word (`pickWordFor`, from D1), picked the first time it's asked for. */
  wordFor(day: DailyDay): Promise<string>;
}

/** Who is asking: their player ID, and (signed in) their account's other guest IDs. */
interface Asker {
  playerId: string;
  aliases?: readonly string[];
}

/** `mode`: which of the day's games; the Daily Set when left out, as every request was before the Daily Word. */
export type DailyRequest = Asker & { day: DailyDay; mode?: DailyMode } & (
  | { action: 'get' }
  | { action: 'start'; name: string; difficulty: Difficulty }
  | { action: 'guess'; word: string }
  /** Easy's Suggest offered `word` (README "Easy"). */
  | { action: 'suggest'; word: string }
  | { action: 'give-up' }
  /** Stop and start the clock (README "Daily Rush"), recorded as moves so the run still replays. */
  | { action: 'pause' }
  | { action: 'resume' });

export type DailyResponse = { status: number; body: { run: DailyView | null } | { error: DailyError } };

/** Where a player's run is kept: the Daily Set's under `run:`, as before the Daily Word. */
const keyOf = (mode: DailyMode, playerId: string) => `${mode === 'daily' ? 'run' : 'word'}:${playerId}`;

const refuse = (status: number, error: DailyError): DailyResponse => ({ status, body: { error } });

/** The player's entry for the day, under any of their IDs: once a day means once for the account. */
async function findEntry(storage: RoomStorage, mode: DailyMode, asker: Asker): Promise<DailyEntry | null> {
  for (const id of [asker.playerId, ...(asker.aliases ?? [])]) {
    const entry = await storage.get<DailyEntry>(keyOf(mode, id));
    if (entry) return entry;
  }
  return null;
}

function replay(entry: DailyEntry) {
  const replayed = replayRun(entry.record);
  if (!replayed.ok) throw new Error(`${entry.playerId}'s Daily Rush doesn't replay: ${replayed.error}`);
  return replayed.game;
}

/** Handles one request for the day. */
export async function handleDaily(
  storage: RoomStorage, deps: DailyDeps, request: DailyRequest, now: number,
): Promise<DailyResponse> {
  const { day } = request;
  const mode = request.mode ?? 'daily';
  const entry = await findEntry(storage, mode, request);
  const answer = (e: DailyEntry | null): DailyResponse => ({ status: 200, body: { run: e && dailyView(day, replay(e)) } });
  if (request.action === 'get') return answer(entry);

  if (request.action === 'start') {
    if (now >= dayEnd(day)) return refuse(409, 'day-over');
    if (entry) return refuse(409, 'already-played');
    let created;
    if (mode === 'daily') {
      const theme = await deps.themeFor(day);
      if (!theme) return refuse(404, 'no-theme');
      // The clock pauses only when you press Pause, and there's no time limit. Everyone gets the day's words in
      // their own order, kept in their run's record, so nobody learns the first word from someone else.
      created = createRun(shuffled(theme.words, deps.random), now, { difficulty: request.difficulty, pausable: true });
      if (!created.ok) throw new Error(`${day}'s theme ${theme.id} isn't a valid run: ${created.error}`);
    } else {
      // One word, with no time limit and no Pause (owner, 9 October 2026: time only breaks ties).
      created = createRun([await deps.wordFor(day)], now, { difficulty: request.difficulty });
      if (!created.ok) throw new Error(`${day}'s Daily Word isn't a valid run: ${created.error}`);
    }
    const started: DailyEntry = { playerId: request.playerId, name: request.name, record: toRunRecord(created.game) };
    await storage.put(keyOf(mode, started.playerId), started);
    return answer(started);
  }

  if (!entry) return refuse(409, 'not-started');
  // A run still going when the day changes can be finished (the worker allows a day late), off the board.
  const run = replay(entry);
  // Two pauses a run (README "Daily Rush"); Solo Rush's engine has no limit.
  if (request.action === 'pause' && run.pausable && run.status === 'playing' && run.pausedAt === null
    && pausesUsed(run) >= DAILY_PAUSES) return refuse(409, 'no-pauses-left');
  const result = request.action === 'guess' ? submitRunGuess(run, request.word, now)
    : request.action === 'suggest' ? suggestRun(run, request.word, now)
    : request.action === 'pause' ? pauseRun(run, now)
    : request.action === 'resume' ? resumeRun(run, now) : endRun(run, now);
  if (!result.ok) {
    if (result.error === 'game-over' || result.error === 'paused' || result.error === 'not-paused'
      || result.error === 'not-pausable') return refuse(409, result.error);
    if (result.error === 'not-easy' || result.error === 'no-suggestions') return refuse(409, result.error);
    if (result.error === 'wrong-length' || result.error === 'not-letters' || result.error === 'not-in-word-list'
      || result.error === 'repeated-letters') return refuse(400, result.error);
    throw new Error(`A Daily Rush refused a move: ${result.error}`);
  }
  const next: DailyEntry = { ...entry, record: toRunRecord(result.game) };
  await storage.put(keyOf(mode, next.playerId), next);
  const totals = dailyTotals(result.game);
  if (totals) await deps.saveFinished(mode, day, next, totals, finishedLate(day, result.game), now);
  return answer(next);
}

/** Each daily game's leaderboard table. */
export const RESULTS_TABLE: Readonly<Record<DailyMode, string>> = { daily: 'daily_results', dailyWord: 'daily_word_results' };

/**
 * Saves a finished run to D1: its leaderboard row (unless it finished after
 * the day ended), and the game history as other server games are.
 */
export async function saveFinishedDaily(
  db: D1Database, mode: DailyMode, day: DailyDay, entry: DailyEntry, totals: DailyTotals, late: boolean, historyVersion: number,
  now: number,
): Promise<void> {
  const { playerId, name, record } = entry;
  if (!late) await db.prepare(
    `INSERT OR IGNORE INTO ${RESULTS_TABLE[mode]} (day, player_id, difficulty, name, guesses, ms, finished_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(day, playerId, record.difficulty, name, totals.guesses, totals.ms, now).run();
  const gameId = `${mode}:${day}:${playerId}`;
  await db.prepare(
    `INSERT OR IGNORE INTO games (id, mode, version, record, started_at, finished_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(gameId, mode, historyVersion, JSON.stringify(record), record.startedAt, now).run();
  await db.prepare('INSERT OR IGNORE INTO game_players (game_id, guest_id) VALUES (?1, ?2)').bind(gameId, playerId).run();
}
