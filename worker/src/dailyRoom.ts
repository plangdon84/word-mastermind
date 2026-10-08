import {
  createRun, dailyTotals, finishedLate, shuffled, dailyView, dayEnd, endRun, replayRun, submitRunGuess, suggestRun, toRunRecord, type DailyDay, type DailyTotals,
  type DailyView, type Difficulty, type RunRecord,
} from '../../src/game';
import type { DailyError } from '../../src/app/dailyApi';
import type { DailyTheme } from './dailyThemes';
import type { RoomStorage } from './room';

/*
 * The referee for one day's Daily Rush, run by that day's Durable Object
 * (`dailyRush.ts`). It holds every player's run for the day, answers each
 * player with their own run only, and never sends a word until it's found.
 * Like the game logic, it never reads the clock: the time is passed in.
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
  saveFinished(day: DailyDay, entry: DailyEntry, totals: DailyTotals, late: boolean, now: number): Promise<void>;
  /** Orders each player's words: a number in [0, 1). */
  random(): number;
  /** The day's theme (`themeFor`, from D1), or null on a day without one. */
  themeFor(day: DailyDay): Promise<DailyTheme | null>;
}

/** Who is asking: their player ID, and (signed in) their account's other guest IDs. */
interface Asker {
  playerId: string;
  aliases?: readonly string[];
}

export type DailyRequest = Asker & { day: DailyDay } & (
  | { action: 'get' }
  | { action: 'start'; name: string; difficulty: Difficulty }
  | { action: 'guess'; word: string }
  /** Easy's Suggest offered `word` (README "Easy"). */
  | { action: 'suggest'; word: string }
  | { action: 'give-up' });

export type DailyResponse = { status: number; body: { run: DailyView | null } | { error: DailyError } };

const keyOf = (playerId: string) => `run:${playerId}`;

const refuse = (status: number, error: DailyError): DailyResponse => ({ status, body: { error } });

/** The player's entry for the day, under any of their IDs: once a day means once for the account. */
async function findEntry(storage: RoomStorage, asker: Asker): Promise<DailyEntry | null> {
  for (const id of [asker.playerId, ...(asker.aliases ?? [])]) {
    const entry = await storage.get<DailyEntry>(keyOf(id));
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
  const entry = await findEntry(storage, request);
  const answer = (e: DailyEntry | null): DailyResponse => ({ status: 200, body: { run: e && dailyView(day, replay(e)) } });
  if (request.action === 'get') return answer(entry);

  if (request.action === 'start') {
    if (now >= dayEnd(day)) return refuse(409, 'day-over');
    if (entry) return refuse(409, 'already-played');
    const theme = await deps.themeFor(day);
    if (!theme) return refuse(404, 'no-theme');
    // The clock never pauses, and there's no time limit but the day's end. Everyone gets the day's words in
    // their own order, kept in their run's record, so nobody learns the first word from someone else.
    const created = createRun(shuffled(theme.words, deps.random), now, { difficulty: request.difficulty });
    if (!created.ok) throw new Error(`${day}'s theme ${theme.id} isn't a valid run: ${created.error}`);
    const started: DailyEntry = { playerId: request.playerId, name: request.name, record: toRunRecord(created.game) };
    await storage.put(keyOf(started.playerId), started);
    return answer(started);
  }

  if (!entry) return refuse(409, 'not-started');
  // A run still going when the day changes can be finished (the worker allows a day late), off the board.
  const run = replay(entry);
  const result = request.action === 'guess' ? submitRunGuess(run, request.word, now)
    : request.action === 'suggest' ? suggestRun(run, request.word, now) : endRun(run, now);
  if (!result.ok) {
    if (result.error === 'game-over') return refuse(409, 'game-over');
    if (result.error === 'not-easy' || result.error === 'no-suggestions') return refuse(409, result.error);
    if (result.error === 'wrong-length' || result.error === 'not-letters' || result.error === 'not-in-word-list'
      || result.error === 'repeated-letters') return refuse(400, result.error);
    throw new Error(`A Daily Rush refused a move: ${result.error}`);
  }
  const next: DailyEntry = { ...entry, record: toRunRecord(result.game) };
  await storage.put(keyOf(next.playerId), next);
  const totals = dailyTotals(result.game);
  if (totals) await deps.saveFinished(day, next, totals, finishedLate(day, result.game), now);
  return answer(next);
}

/**
 * Saves a finished run to D1: its leaderboard row (unless it finished after
 * the day ended), and the game history as other server games are.
 */
export async function saveFinishedDaily(
  db: D1Database, day: DailyDay, entry: DailyEntry, totals: DailyTotals, late: boolean, historyVersion: number, now: number,
): Promise<void> {
  const { playerId, name, record } = entry;
  if (!late) await db.prepare(
    `INSERT OR IGNORE INTO daily_results (day, player_id, difficulty, name, guesses, ms, finished_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(day, playerId, record.difficulty, name, totals.guesses, totals.ms, now).run();
  const gameId = `daily:${day}:${playerId}`;
  await db.prepare(
    `INSERT OR IGNORE INTO games (id, mode, version, record, started_at, finished_at) VALUES (?1, 'daily', ?2, ?3, ?4, ?5)`,
  ).bind(gameId, historyVersion, JSON.stringify(record), record.startedAt, now).run();
  await db.prepare('INSERT OR IGNORE INTO game_players (game_id, guest_id) VALUES (?1, ?2)').bind(gameId, playerId).run();
}
