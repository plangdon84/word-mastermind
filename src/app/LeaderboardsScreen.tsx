import { useEffect, useMemo, useState } from 'preact/hooks';
import { dailyDay, FEATURES, ordinal, RATING_POOLS, type Difficulty, type RankBy, type RatingPool } from '../game';
import type { ApiIdentity } from './apiIdentity';
import { BackIcon, BoardPage } from './panels';
import { API_URL } from './config';
import { dailyApi } from './dailyApi';
import { PlayerName } from './friendLink';
import { DailyBoardPanel } from './DailyScreen';
import { fetchRatingBoard, LeaderboardError, type Circle, type RatingBoard } from './leaderboardsApi';
import { fetchRatings, ratingText, type PoolRating } from './ratingsApi';

/*
 * The Leaderboards page (README "Leaderboards"): a tile per board, each
 * board read from the server when opened, with ← Back to where it was
 * opened from.
 */

/** A board: Daily Rush's, or a rating pool's. */
export type BoardId = 'daily' | RatingPool;

export const BOARD_TITLE: Record<BoardId, string> = {
  daily: 'Daily Set',
  '15m': 'Live PvP · 15 min',
  '10m': 'Live PvP · 10 min',
  '5m': 'Live PvP · 5 min',
  correspondence: 'Correspondence PvP',
  rush: 'Competitive Rush',
};

const BOARD_DETAIL: Record<BoardId, string> = {
  daily: "Each day's set, by difficulty: fastest (Rush) or fewest guesses (Crush).",
  '15m': 'Ratings from rated games on a 15-minute clock.',
  '10m': 'Ratings from rated games on a 10-minute clock.',
  '5m': 'Ratings from rated games on a 5-minute clock.',
  correspondence: 'Ratings from rated games at 1 or 3 days per guess.',
  rush: 'Ratings from Competitive Rush lobbies.',
};

const gamesText = (n: number) => `${n} rated ${n === 1 ? 'game' : 'games'}`;

/** What a rating board says about you, below its rows. */
function yourRatingText(board: RatingBoard, shown: boolean): string {
  const you = board.you;
  if (!you) return 'Sign in to get rated: games against a random opponent, rated challenges to friends, and Competitive Rush.';
  if (you.rank !== null) {
    const place = `${ordinal(you.rank)} of ${board.total}`;
    return shown ? `You're ${place}.` : `You: ${ratingText(you.rating)} · ${place}`;
  }
  const more = `${you.gamesToList} more ${you.gamesToList === 1 ? 'game' : 'games'}`;
  if (you.games === 0) return `No rated games here yet. About ${you.gamesToList} rated games get you listed.`;
  return `Your rating is provisional (${ratingText(you.rating)}, ${gamesText(you.games)}): about ${more} until you're listed.`;
}

/** A rating pool's board: the top 100, and your place. */
export function RatingBoardPanel({ pool, identity, circle }: { pool: RatingPool; identity: ApiIdentity; circle: Circle }) {
  const [board, setBoard] = useState<RatingBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setBoard(null);
    setError(null);
    fetchRatingBoard(API_URL ?? '', identity, pool, circle).then((b) => live && setBoard(b), (e: unknown) => {
      if (!live) return;
      const code = e instanceof LeaderboardError ? e.code : 'unreachable';
      setError(code === 'unreachable' ? "Can't reach the game server. Check your connection and try again."
        : code === 'signed-out' || code === 'sign-in-needed' ? 'You were signed out. Sign in again from your profile.'
          : "Couldn't load this leaderboard. Try again later.");
    });
    return () => {
      live = false;
    };
  }, [pool, identity, circle]);
  const youShown = board?.top.some((r) => r.you) ?? false;
  return (
    <section class="panel daily-board" aria-label={`${BOARD_TITLE[pool]} leaderboard`}>
      {error && <p class="board-note">{error}</p>}
      {!error && !board && <p class="board-note">Loading…</p>}
      {board && (
        <>
          {board.top.length === 0 ? (
            <p class="board-note">
              {circle === 'friends' ? 'Neither you nor your friends are listed yet.' : 'Nobody is listed yet.'}
            </p>
          ) : (
            <ol class="board-rows rating-rows">
              {board.top.map((r, i) => (
                <li key={i} class={r.you ? 'you' : ''}>
                  <span class="board-rank">{r.rank}</span>
                  <span class="board-name"><PlayerName name={r.name} code={r.friendCode} />{r.you && <span class="visually-hidden"> (you)</span>}</span>
                  <span class="board-guesses" aria-label={`Rating ${r.rating}`}>{r.rating}</span>
                  <span class="board-time board-games" aria-label={gamesText(r.games)}>{r.games}</span>
                </li>
              ))}
            </ol>
          )}
          <p class="board-you">{yourRatingText(board, youShown)}</p>
          <p class="board-note">
            {board.top.length > 0 && 'Rank, name, rating and rated games. '}
            Players are listed once their rating isn't provisional (a "?" after it), which also comes back after a long
            break.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * The Leaderboards page, from the title screen. With `board`, it opens at
 * that board, whose ← Back then leaves the page (a link straight to it).
 */
export function LeaderboardsScreen({ identity, difficulty, rankBy, onRankBy, board: opened = null, onExit }: {
  identity: ApiIdentity;
  /** Which of the Daily Rush board's difficulties to show first. */
  difficulty: Difficulty;
  /** Which Daily Set board to show: Rush or Crush, the last one picked. */
  rankBy: RankBy;
  onRankBy: (rankBy: RankBy) => void;
  board?: BoardId | null;
  onExit: () => void;
}) {
  // The rating boards are switched off for the launch (`src/game/features.ts`); Daily Rush's always shows.
  const tiles: BoardId[] = ['daily', ...(FEATURES.ratingBoards ? RATING_POOLS : [])];
  // With one board, a page of one tile is a tap for nothing: open the board, and Back leaves.
  const only = API_URL && tiles.length === 1 ? tiles[0]! : null;
  const [board, setBoard] = useState<BoardId | null>(opened ?? only);
  const [circle, setCircle] = useState<Circle>('everyone');
  const signedIn = identity.token !== null;
  const shownCircle = signedIn ? circle : 'everyone';
  const daily = useMemo(() => dailyApi(API_URL ?? '', identity), [identity]);
  const [ratings, setRatings] = useState<PoolRating[] | null>(null);
  useEffect(() => {
    let live = true;
    // Your rating on each board's tile, while the rating boards are on.
    if (API_URL && signedIn && FEATURES.ratingBoards) void fetchRatings(API_URL, identity).then((list) => live && setRatings(list));
    return () => {
      live = false;
    };
  }, [identity, signedIn]);

  if (board) {
    return (
      <BoardPage title={BOARD_TITLE[board]} onBack={() => (opened || only ? onExit() : setBoard(null))}
        circle={signedIn ? circle : null} onCircle={setCircle}>
        {board === 'daily' ? (
          <DailyBoardPanel api={daily} today={dailyDay(Date.now())} day={dailyDay(Date.now())} difficulty={difficulty}
            circle={shownCircle} rankBy={rankBy} onRankBy={onRankBy} />
        ) : <RatingBoardPanel pool={board} identity={identity} circle={shownCircle} />}
      </BoardPage>
    );
  }

  return (
    <div class="app leaderboards">
      <header class="step-head">
        <button type="button" class="icon-btn" aria-label="Back" onClick={onExit}><BackIcon /></button>
        <h2>Leaderboards</h2>
      </header>
      {!API_URL && <p class="step-note">Leaderboards need the game server, which this version doesn't have.</p>}
      <div class="choices" role="group" aria-label="Leaderboards">
        {tiles.map((id) => {
          const yours = id === 'daily' ? undefined : ratings?.find((r) => r.pool === id);
          return (
            <button type="button" class="choice" key={id} disabled={!API_URL} onClick={() => setBoard(id)}>
              <span class="choice-label">
                {BOARD_TITLE[id]}
                {!API_URL && <span class="tag">Coming later</span>}
              </span>
              <span class="choice-detail">{BOARD_DETAIL[id]}</span>
              {yours && <span class="choice-detail choice-extra">Your rating: {ratingText(yours)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
