import { evaluateGuess, ordinal, otherSeat, runRankBy, type HistoryEntry, type RunRecord } from '../game';
import type { HistoryGame } from './historyDb';

/*
 * CSV export of the game history (README "Game history"): one row per move,
 * each repeating its game's details, so the file keeps everything the records
 * hold. It's for spreadsheets; the JSON backup is for restoring.
 */

/** Past this many rows, the app asks you to filter further. */
export const CSV_ROW_LIMIT = 20_000;

export const CSV_COLUMNS = [
  'game_id', 'mode', 'started_at', 'difficulty', 'scored_difficulty', 'strength', 'first', 'your_word',
  'secret_words', 'result', 'rush_score', 'move', 'side', 'kind', 'word_no', 'word', 'score', 'time', 'ranked_by',
] as const;

/**
 * A Word Set's `ranked_by` cell: `rush` (by time, its `rush_score` in seconds)
 * or `crush` (by guesses); `both` for the Daily Set, which is on both
 * boards. Empty for the other modes.
 */
function rankedBy(entry: HistoryEntry): Cell {
  if (entry.mode === 'daily') return 'both';
  return entry.mode === 'rush' || entry.mode === 'lobby' ? runRankBy(entry.record) : null;
}

type Cell = string | number | null;

/**
 * Quotes a cell when it needs it, and stops a spreadsheet running a cell as a
 * formula: one starting with =, +, - or @ gets a leading apostrophe. Nothing
 * exported starts that way today (words are letters only), but a column of
 * names, which players type, could.
 */
export function csvCell(value: Cell): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** The rows for one move each, before the game's details are added. */
interface MoveRow {
  side: 'you' | 'computer' | 'opponent';
  kind: string;
  wordNo: number | null;
  word: string | null;
  score: number | 'win' | null;
  at: number;
}

/** The word column: a guess or the word Suggest offered, or the difficulty changed to. */
const moveWord = (m: { kind: string; word?: string; difficulty?: string }): string | null =>
  m.kind === 'guess' || m.kind === 'suggest' ? m.word ?? null : m.kind === 'difficulty' ? m.difficulty ?? null : null;

const score = (guess: string, secret: string) => {
  const result = evaluateGuess(guess, secret);
  return result.isWin ? 'win' as const : result.score;
};

/** A Rush's moves: the word each was on moves on after it's found or given up. */
function runRows(record: RunRecord): MoveRow[] {
  const { words } = record;
  let current = 0;
  return record.moves.map((m) => {
    const wordNo = current < words.length ? current + 1 : null;
    const row: MoveRow = {
      side: 'you', kind: m.kind, wordNo,
      word: moveWord(m),
      score: m.kind === 'guess' ? score(m.word, words[current]) : null,
      at: m.at,
    };
    if (row.score === 'win' || m.kind === 'give-up-word') current++;
    return row;
  });
}

function moveRows(entry: HistoryEntry): MoveRow[] {
  switch (entry.mode) {
    case 'single':
      return entry.record.moves.map((m) => ({
        side: 'you', kind: m.kind, wordNo: null,
        word: moveWord(m),
        score: m.kind === 'guess' ? score(m.word, entry.record.secret) : null,
        at: m.at,
      }));
    case 'computer': {
      const { humanSecret, computerSecret } = entry.record;
      return entry.record.moves.map((m) => ({
        side: m.side === 'human' ? 'you' : 'computer', kind: m.kind, wordNo: null,
        word: moveWord(m),
        score: m.kind === 'guess' ? score(m.word, m.side === 'human' ? computerSecret : humanSecret) : null,
        at: m.at,
      }));
    }
    case 'friend': {
      const { secrets } = entry.record;
      return entry.record.moves.map((m) => ({
        side: m.seat === entry.seat ? 'you' : 'opponent', kind: m.kind, wordNo: null,
        word: moveWord(m),
        score: m.kind === 'guess' ? score(m.word, secrets[otherSeat(m.seat)]) : null,
        at: m.at,
      }));
    }
    case 'rush':
    case 'daily':
    case 'dailyWord':
    case 'lobby':
      return runRows(entry.record);
  }
}

/** A game's details, repeated on each of its rows. */
function gameCells({ entry, replayed, summary }: HistoryGame): Cell[] {
  const { record } = entry;
  const result = summary.mode === 'rush' ? summary.rush?.level ?? 'no score'
    : summary.place ? (summary.place.rank ? `${ordinal(summary.place.rank)} of ${summary.place.of}` : 'unplaced')
      : summary.mode === 'daily' || summary.mode === 'dailyWord' ? (summary.gaveUp ? 'no score' : 'finished')
        : summary.gaveUp ? 'gave up' : summary.result;
  return [
    entry.id,
    entry.mode,
    iso(record.startedAt),
    replayed.mode === 'friend' ? replayed.game.difficulty[replayed.seat] : entry.mode === 'friend' ? null : entry.record.difficulty,
    summary.difficulty,
    summary.strength,
    replayed.mode === 'computer' ? (replayed.game.first === 'human' ? 'you' : 'computer')
      : replayed.mode === 'friend' ? (replayed.game.first === replayed.seat ? 'you' : 'opponent') : null,
    replayed.mode === 'computer' ? replayed.game.humanSecret
      : replayed.mode === 'friend' ? replayed.game.secrets[replayed.seat] : null,
    replayed.mode === 'single' ? replayed.game.secret
      : replayed.mode === 'computer' ? replayed.game.computerSecret
        : replayed.mode === 'friend' ? replayed.game.secrets[otherSeat(replayed.seat)] : replayed.game.words.join(' '),
    result,
    summary.rush ? Number(summary.rush.score.toFixed(2)) : null,
  ];
}

/** How many rows the CSV of these games would have (one per move). */
export const csvRowCount = (games: readonly HistoryGame[]) =>
  games.reduce((sum, g) => sum + g.entry.record.moves.length, 0);

/** The CSV of these games, header first, one row per move, with CRLF line ends. */
export function historyCsv(games: readonly HistoryGame[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const game of games) {
    const details = gameCells(game);
    moveRows(game.entry).forEach((m, i) => {
      const cells: Cell[] = [...details, i + 1, m.side, m.kind, m.wordNo, m.word, m.score, iso(m.at), rankedBy(game.entry)];
      lines.push(cells.map(csvCell).join(','));
    });
  }
  return `${lines.join('\r\n')}\r\n`;
}
