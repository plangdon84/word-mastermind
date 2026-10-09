import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DIFFICULTIES, HISTORY_MODES, isServerMode, ordinal, runRankBy, wordSetName, type Difficulty, type HistoryFilter,
  type DailyPlacement, type HistoryMode, type HistoryResult, type RatingChange,
} from '../game';
import { API_URL } from './config';
import { loadPlacements } from './dailyStorage';
import { DIFFICULTY_LABEL, STRENGTH_LABEL } from './components';
import { downloadFile } from './backup';
import { formatClock } from './rushParts';
import { loadAllMatching, loadGamesPage, type HistoryGame, type HistoryPage } from './historyDb';
import { CSV_ROW_LIMIT, csvRowCount, historyCsv } from './historyCsv';
import { guessCount } from './messages';

/** How many games each page of the list loads. */
export const PAGE_SIZE = 20;

export const MODE_LABEL: Record<HistoryMode, string> = {
  single: 'Practice', computer: 'vs. Computer', rush: 'Solo Rush & Crush', friend: 'vs. a friend', daily: 'Daily Set',
  dailyWord: 'Daily Word', lobby: 'Rush & Crush with Friends',
};

const RESULT_LABEL: Record<HistoryResult, string> = { won: 'Won', lost: 'Lost', drawn: 'Drawn' };
const RESULT_LETTER: Record<HistoryResult, string> = { won: 'W', lost: 'L', drawn: 'D' };

/** "Sep 28", with the year only for another year's games, leaving the players more room. */
export const formatDay = (ms: number, now = Date.now()) => {
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, { year: sameYear ? undefined : 'numeric', month: 'short', day: 'numeric' });
};


/** A rated game's rating after it, and how it moved. */
function ratingText({ before, after }: RatingChange): string {
  const change = after - before;
  return `Rating ${after} (${change > 0 ? '+' : change < 0 ? '−' : '±'}${Math.abs(change)})`;
}

/** What a row shows: its border, the tag in it, and its two lines. */
function rowParts(game: HistoryGame, placements: readonly DailyPlacement[]): { tone: string; tag: string; tagLabel: string; who: string; detail: string } {
  const { summary, replayed } = game;
  const played = guessCount(summary.yourGuesses);
  const rating = summary.rating ? ` · ${ratingText(summary.rating)}` : '';
  switch (summary.mode) {
    case 'rush': {
      // A Rush is scored by time, a Crush by guesses.
      const rankBy = replayed.mode === 'rush' ? runRankBy(replayed.game) : 'crush';
      const score = summary.rush && (rankBy === 'rush' ? formatClock(summary.rush.score) : summary.rush.score.toFixed(1));
      return {
        tone: summary.rush ? `metal-${summary.rush.level}` : 'no-score',
        tag: score || '–',
        tagLabel: score ? `Score ${score}` : 'No score',
        who: wordSetName('solo', rankBy),
        detail: `${summary.rush ? STRENGTH_LABEL[summary.rush.level] : 'No score'} · ${played}`,
      };
    }
    case 'daily':
    case 'dailyWord': {
      // The day's final place on its Crush board, by guesses like the row's total, once the server has sent it.
      const wordPlace = summary.mode === 'dailyWord';
      const place = replayed.mode === summary.mode
        ? placements.find((p) => p.day === replayed.day && !p.rankBy && (p.mode === 'dailyWord') === wordPlace) : undefined;
      return {
        tone: 'no-score',
        tag: String(summary.yourGuesses),
        tagLabel: `${played} in all`,
        who: MODE_LABEL[summary.mode],
        detail: place ? `${ordinal(place.rank)} of ${place.total} · ${played}` : played,
      };
    }
    case 'lobby': {
      const rank = summary.place?.rank ?? null;
      const kind = replayed.mode === 'lobby' ? wordSetName(replayed.kind, runRankBy(replayed.game)) : MODE_LABEL.lobby;
      return {
        // Finishing first is a win; any other place has no result.
        tone: rank === 1 ? 'won' : 'no-score',
        tag: rank ? ordinal(rank) : '–',
        tagLabel: rank ? `Finished ${ordinal(rank)}` : 'Not placed',
        who: kind,
        detail: `${rank ? `${ordinal(rank)} of ${summary.place!.of}` : 'Not placed'} · ${played}${rating}`,
      };
    }
    default: {
      const result = summary.result!;
      return {
        tone: result,
        tag: RESULT_LETTER[result],
        tagLabel: `${RESULT_LABEL[result]}${summary.gaveUp ? ' (gave up)' : ''}`,
        who: summary.mode === 'computer' ? `vs. Computer · ${STRENGTH_LABEL[summary.strength!]}`
          : summary.mode === 'friend' ? `vs. ${summary.opponent}` : MODE_LABEL[summary.mode],
        // Turns alternate, so both players make the same number of guesses: yours is enough.
        detail: `${played}${summary.gaveUp ? ' · gave up' : ''}${rating}`,
      };
    }
  }
}

/**
 * One past game. The border and label show the result: green W, red L, dark
 * grey D. A Rush has no result, so its border takes its level's badge metal;
 * finishing first in a lobby shows as a win.
 */
function HistoryRow({ game, placements, onOpen }: { game: HistoryGame; placements: readonly DailyPlacement[]; onOpen: () => void }) {
  const { summary } = game;
  const { tone, tag, tagLabel, who, detail } = rowParts(game, placements);
  return (
    <li>
      <button type="button" class={`history-row ${tone}`} onClick={onOpen}>
        <span class="result-tag" aria-hidden="true">{tag}</span>
        <span class="visually-hidden">{tagLabel}, </span>
        <span class="history-main">
          <span class="history-who"><b>{who}</b></span>
          <span class="history-detail">{detail}</span>
        </span>
        <span class="history-side">
          <span class={`matchup-diff diff-${summary.difficulty}`}>{DIFFICULTY_LABEL[summary.difficulty]}<span class="visually-hidden"> difficulty</span></span>
          <span class="history-date">{formatDay(summary.endedAt)}</span>
        </span>
      </button>
    </li>
  );
}

function Filter<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T | undefined;
  options: readonly { value: T; label: string }[];
  onChange: (value: T | undefined) => void;
}) {
  return (
    <label class="history-filter">
      <span class="visually-hidden">Filter by {label.toLowerCase()}</span>
      <select class="select" value={value ?? ''} onChange={(e) => onChange((e.currentTarget.value || undefined) as T)}>
        <option value="">{label}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

interface Loaded {
  games: HistoryGame[];
  next: number | null;
  status: 'loading' | 'ready' | 'error';
}

/**
 * The game history list (README "Game history"): newest first, a page at a
 * time, with filters and a word search. Tapping a game opens its review.
 * By default it's this browser's games; a friend's profile passes `load`
 * with theirs, and their list has no export.
 */
export function GameHistory({ filter, onFilter, onOpen, load: loadPage = loadGamesPage, friend, placements: theirPlaces }: {
  filter: HistoryFilter;
  onFilter: (filter: HistoryFilter) => void;
  onOpen: (game: HistoryGame) => void;
  load?: (filter: HistoryFilter, offset: number, limit: number) => Promise<HistoryPage>;
  /** Their name, for a friend's games. */
  friend?: string;
  /** A friend's Daily Rush places; yours are this browser's. */
  placements?: readonly DailyPlacement[];
}) {
  // Yours are read each time, so a place the server sends while the list is open shows.
  const placements = theirPlaces ?? loadPlacements();
  const [loaded, setLoaded] = useState<Loaded>({ games: [], next: null, status: 'loading' });
  const [csvMessage, setCsvMessage] = useState<string | null>(null);
  const [search, setSearch] = useState(filter.search ?? '');
  /** Only the latest request's result is shown. */
  const request = useRef(0);

  const load = (offset: number, append: boolean) => {
    const id = ++request.current;
    setLoaded((l) => ({ ...l, status: 'loading' }));
    loadPage(filter, offset, PAGE_SIZE).then(
      (page) => {
        if (id !== request.current) return;
        setLoaded((l) => ({ games: append ? [...l.games, ...page.games] : page.games, next: page.next, status: 'ready' }));
      },
      () => id === request.current && setLoaded({ games: [], next: null, status: 'error' }),
    );
  };

  useEffect(() => {
    setCsvMessage(null);
    load(0, false);
  }, [filter.mode, filter.result, filter.difficulty, filter.search]);

  /** Exports every game the filters match, not just the pages loaded. */
  const exportCsv = async () => {
    try {
      const games = await loadAllMatching(filter);
      const rows = csvRowCount(games);
      if (rows > CSV_ROW_LIMIT) {
        setCsvMessage(`That's ${rows.toLocaleString()} rows, over the ${CSV_ROW_LIMIT.toLocaleString()} limit. Filter the list further, then export again.`);
        return;
      }
      const day = new Date().toISOString().slice(0, 10);
      downloadFile(`word-mastermind-history-${day}.csv`, 'text/csv', historyCsv(games));
      setCsvMessage(null);
    } catch {
      setCsvMessage("Couldn't read your games to export them.");
    }
  };

  // Search as you type, once typing pauses.
  useEffect(() => {
    if (search === (filter.search ?? '')) return;
    const timer = setTimeout(() => onFilter({ ...filter, search: search || undefined }), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const filtered = Boolean(filter.mode || filter.result || filter.difficulty || filter.search);

  return (
    <section class="profile-section" aria-label="Game history">
      <div class="section-head">
        {loaded.games.length > 0 && !friend && (
          <button type="button" class="btn small" onClick={exportCsv}
            title="One row per move, for spreadsheets. To restore your games, use Save a backup.">
            Export CSV
          </button>
        )}
      </div>
      {csvMessage && <p class="field-note error" role="alert">{csvMessage}</p>}
      <div class="history-filters">
        <Filter label="Mode" value={filter.mode} onChange={(mode) => onFilter({ ...filter, mode })}
          options={HISTORY_MODES.filter((m) => !isServerMode(m) || API_URL).map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
        <Filter label="Result" value={filter.result} onChange={(result) => onFilter({ ...filter, result })}
          options={(['won', 'lost', 'drawn'] as const).map((r) => ({ value: r, label: RESULT_LABEL[r] }))} />
        <Filter<Difficulty> label="Difficulty" value={filter.difficulty}
          onChange={(difficulty) => onFilter({ ...filter, difficulty })}
          options={DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))} />
        <label class="history-filter search">
          <span class="visually-hidden">Search by word</span>
          <input class="text-input" type="search" placeholder="Search words" value={search} maxLength={5}
            autoComplete="off" spellcheck={false} onInput={(e) => setSearch(e.currentTarget.value.replace(/[^a-z]/gi, ''))} />
        </label>
      </div>
      {loaded.status === 'error' ? (
        <p class="field-note error">Couldn't load {friend ? 'their' : 'your'} games.</p>
      ) : loaded.games.length === 0 && loaded.status === 'ready' ? (
        <p class="field-note">
          {filtered ? 'No games match.' : friend ? `${friend} hasn't finished a game yet.` : 'No games yet. Finished games appear here.'}
        </p>
      ) : (
        <ol class="history-list" aria-busy={loaded.status === 'loading'}>
          {loaded.games.map((g) => <HistoryRow key={g.entry.id} game={g} placements={placements} onOpen={() => onOpen(g)} />)}
        </ol>
      )}
      {loaded.next !== null && (
        <button type="button" class="btn" disabled={loaded.status === 'loading'} onClick={() => load(loaded.next!, true)}>
          Show more
        </button>
      )}
    </section>
  );
}
