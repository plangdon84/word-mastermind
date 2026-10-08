import type { ComponentChildren } from 'preact';
import { DIFFICULTIES, FEATURES, HISTORY_MODES, STRENGTHS, type HistoryMode, type ModeStats, type Stats, type Trend } from '../game';
import { DIFFICULTY_LABEL, STRENGTH_LABEL } from './components';
import { MODE_LABEL } from './GameHistory';
import type { HistoryGame } from './historyDb';
import { POOL_LABEL, ratingText, type PoolRating } from './ratingsApi';
import { formatClock } from './rushParts';
import { guessCount } from './messages';

/** 2.25 → "2.3"; whole numbers stay whole. */
const decimal = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const percent = (n: number | null) => (n === null ? '—' : `${Math.round(n)}%`);

/** 3 hours 5 minutes → "3h 5m"; under an hour, minutes and seconds. */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/**
 * A trend chip: ▲ or ▼ with the change, green when it's better and red when
 * worse, so the arrow and sign carry it without colour. Hidden with too few games.
 */
function TrendChip({ trend, lowerIsBetter = false, unit = '' }: {
  trend: Trend | null; lowerIsBetter?: boolean; unit?: string;
}) {
  if (!trend) return null;
  const change = unit ? Math.round(trend.change) : Math.round(trend.change * 10) / 10;
  if (change === 0) return <span class="trend flat" title="Last 30 days vs. the 30 before">±0{unit}</span>;
  const better = lowerIsBetter ? change < 0 : change > 0;
  const text = `${change > 0 ? '+' : '−'}${decimal(Math.abs(change))}${unit}`;
  return (
    <span class={`trend ${better ? 'good' : 'bad'}`} title="Last 30 days vs. the 30 before">
      <span aria-hidden="true">{change > 0 ? '▲' : '▼'}</span> {text}
      <span class="visually-hidden"> in the last 30 days</span>
    </span>
  );
}

function Stat({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="stat-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ModeCard({ stats, onOpen }: { stats: ModeStats; onOpen: (id: string) => void }) {
  const { mode, record } = stats;
  const title = MODE_LABEL[mode];
  const bestLabel: Record<HistoryMode, string> = {
    single: 'Best game', computer: 'Best win', friend: 'Best win', rush: 'Best score', daily: 'Fewest guesses', lobby: 'Best score',
  };
  const counted = mode === 'computer' || mode === 'friend' || mode === 'daily';
  const bestValue = (value: number) => (counted ? guessCount(value) : decimal(value));
  const perWord = mode === 'rush' || mode === 'daily' || mode === 'lobby';
  return (
    <div class="mode-card">
      <h4>{title}</h4>
      <dl class="stat-list">
        <Stat label="Played">{stats.played}{stats.gaveUp > 0 && <span class="stat-aside"> · {stats.gaveUp} gave up</span>}</Stat>
        {record && (
          <>
            <Stat label="Win %">{percent(record.winPct)} <TrendChip trend={record.winPctTrend} unit=" pts" /></Stat>
            <Stat label="Won–drawn–lost">{record.wins}–{record.draws}–{record.losses}</Stat>
            <Stat label="Win streak">{record.currentStreak} <span class="stat-aside">· best {record.bestStreak}</span></Stat>
          </>
        )}
        {stats.firsts !== null && <Stat label="Finished first">{stats.firsts}</Stat>}
        <Stat label={perWord ? 'Average guesses per word' : 'Average guesses'}>
          {stats.averageGuesses === null ? '—' : decimal(stats.averageGuesses)}{' '}
          <TrendChip trend={stats.averageTrend} lowerIsBetter />
        </Stat>
        <Stat label={bestLabel[mode]}>
          {stats.best ? (
            <button type="button" class="link-btn" onClick={() => onOpen(stats.best!.id)}>{bestValue(stats.best.value)}</button>
          ) : '—'}
        </Stat>
        <Stat label="Fastest solve">
          {stats.fastest ? (
            <button type="button" class="link-btn" onClick={() => onOpen(stats.fastest!.id)}>{formatClock(stats.fastest.value)}</button>
          ) : '—'}
        </Stat>
      </dl>
      {record?.byStrength && (
        <table class="strength-table">
          <caption class="visually-hidden">Results by computer strength</caption>
          <thead><tr><th scope="col">Strength</th><th scope="col">W–D–L</th><th scope="col">Win %</th></tr></thead>
          <tbody>
            {STRENGTHS.map((s) => {
              const r = record.byStrength![s];
              return (
                <tr key={s}>
                  <th scope="row">{STRENGTH_LABEL[s]}</th>
                  <td>{r.wins}–{r.draws}–{r.losses}</td>
                  <td>{percent(r.winPct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A card for each mode you've played: one saying "No games yet" for each of the rest is clutter. */
const shownModes = (stats: Stats) => HISTORY_MODES.filter((m) => stats.modes[m].played > 0);

/** Your ratings from the server (README "Rating"), signed in; `list` is null while they load or can't be. */
export interface RatingsState {
  signedIn: boolean;
  list: PoolRating[] | null;
}

/** The headline's Rating: the pool you've played most, with its clock. */
function RatingTile({ ratings }: { ratings?: RatingsState }) {
  const soon = (text: string, title: string) => <dd class="soon" title={title}>{text}</dd>;
  let value;
  if (!ratings) value = soon('Needs the server', 'Ratings come from rated online games');
  else if (!ratings.signedIn) value = soon('Sign in to get rated', 'Rated games are for signed-in players');
  else if (!ratings.list) value = <dd>—</dd>;
  else if (ratings.list.length === 0) value = soon('No rated games yet', FEATURES.randomOpponent ? 'Play a matched game, or a rated challenge' : 'Challenge a friend to a rated game');
  else {
    const top = ratings.list.reduce((a, b) => (b.games > a.games ? b : a));
    value = <dd title={top.provisional ? 'Provisional: it settles after a few more games' : undefined}>
      {ratingText(top)}<span class="rating-pool">{POOL_LABEL[top.pool]}</span></dd>;
  }
  return <div><dt>Rating</dt>{value}</div>;
}

/**
 * The profile's analytics (README "Analytics"): a headline row, a card per
 * mode, games by difficulty, your most used guesses and time played. `stats`
 * is null while the games load.
 */
export function Analytics({ stats, games, onOpen, ratings }: {
  stats: Stats | null;
  games: readonly HistoryGame[];
  onOpen: (game: HistoryGame) => void;
  /** Your ratings, where there's a server; undefined without one. */
  ratings?: RatingsState;
}) {
  const open = (id: string) => {
    const game = games.find((g) => g.entry.id === id);
    if (game) onOpen(game);
  };
  return (
    <section class="profile-section analytics" aria-label="Analytics">
      {!stats ? (
        <p class="field-note">Loading…</p>
      ) : (
        <>
          <dl class="headline">
            <RatingTile ratings={ratings} />
            <div><dt>Games</dt><dd>{stats.played}</dd></div>
            <div><dt>Win %</dt><dd>{percent(stats.winPct)}</dd></div>
            <div><dt>Guesses</dt><dd>{stats.totalGuesses.toLocaleString()}</dd></div>
          </dl>
          {ratings?.list && ratings.list.length > 1 && (
            <p class="field-note ratings-line">
              Ratings: {ratings.list.map((r) => `${POOL_LABEL[r.pool]} ${ratingText(r)}`).join(' · ')}
              {ratings.list.some((r) => r.provisional) && ' (? is provisional)'}
            </p>
          )}
          {stats.played === 0 ? (
            <p class="field-note">Play a game to see your stats.</p>
          ) : (
            <>
              <div class="mode-cards">
                {shownModes(stats).map((m) => <ModeCard key={m} stats={stats.modes[m]} onOpen={open} />)}
              </div>
              <div class="stat-block">
                <h4>Games by difficulty</h4>
                <ul class="bars">
                  {DIFFICULTIES.map((d) => (
                    <li key={d}>
                      <span class="bar-label">{DIFFICULTY_LABEL[d]}</span>
                      <span class="bar" aria-hidden="true">
                        <span style={{ width: `${(stats.byDifficulty[d] / stats.played) * 100}%` }} />
                      </span>
                      <span class="bar-value">{stats.byDifficulty[d]}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div class="stat-block">
                <h4>Your top guesses</h4>
                <ol class="top-guesses">
                  {stats.topGuesses.map((g) => (
                    <li key={g.word}><span class="top-word">{g.word}</span> <span class="stat-aside">×{g.count}</span></li>
                  ))}
                </ol>
              </div>
              <div class="stat-block inline">
                <h4>Time played</h4>
                <span class="stat-big">{formatDuration(stats.secondsPlayed)}</span>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
