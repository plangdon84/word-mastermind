import {
  ordinal, otherSeat, pvpView, timeControlOf, type DailyPlacement, type LobbyPlace, type PvpGame, type RankBy, type RatingChange,
  type Seat,
} from '../game';
import type { FriendGame, RatingLine } from './friendApi';
import { formatClock } from './rushParts';
import { guessCount } from './messages';

/*
 * Reviewing the server's games from the history (README "Game history"):
 * each opens on its own mode's screen, read-only, built from the history
 * entry rather than asked of the server.
 */

/** A finished game against a friend as the server would describe it to you. */
export function friendReviewGame(game: PvpGame, seat: Seat, you: string, opponent: string): FriendGame {
  const names: Record<Seat, string> = { [seat]: you, [otherSeat(seat)]: opponent } as Record<Seat, string>;
  return {
    id: '',
    seat,
    state: 'over',
    hostName: names.host,
    guestName: names.guest,
    opponentCode: null,
    inviteeName: null,
    invitedYou: false,
    inviteeDifficulty: null,
    rematchOf: null,
    rematch: null,
    timeControl: timeControlOf(game),
    createdAt: game.startedAt,
    expiresAt: null,
    serverNow: null,
    rated: game.rated === true,
    matched: false,
    // Only your own rating is kept, so the review shows your change and not theirs.
    ratings: null,
    view: pvpView(game, seat),
  };
}

/** A rated game's change, as the result screen shows it. */
export const ratingLine = (change: RatingChange | null): RatingLine | null => change && {
  rating: change.before, provisional: false, after: { rating: change.after, provisional: false },
};


/**
 * A Daily Set's result: its total, and its final places on the day's Crush
 * and Rush boards once the server has sent them.
 */
export function DailyResult({ total, crush, rush }: {
  total: number;
  crush: DailyPlacement | null;
  rush: DailyPlacement | null;
}) {
  const place = (p: DailyPlacement) => `${ordinal(p.rank)} of ${p.total}`;
  return (
    <p class="tally">
      {guessCount(total)} in all.{' '}
      {crush && rush ? `You finished ${place(crush)} on the day's Crush board (fewest guesses) and ${place(rush)} on its Rush board (fastest).`
        : crush ? `You finished ${place(crush)} on the day's leaderboard.`
          : "The day's final places come once it's over."}
    </p>
  );
}

/** A lobby's final standings, as the server worked them out. */
export function LobbyPlaces({ places, rankBy = 'crush', rating }: {
  places: readonly LobbyPlace[];
  /** A Rush ranked by time, so its time comes first; a Crush by score. */
  rankBy?: RankBy;
  rating: RatingLine | null;
}) {
  const sorted = [...places].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  return (
    <>
      <ol class="board-rows lobby-places">
        {sorted.map((p, i) => (
          <li key={i} class={p.you ? 'you' : undefined}>
            <span class="board-rank">{p.rank ? ordinal(p.rank) : '–'}</span>
            <span class="board-name">{p.name}{p.you && ' (you)'}</span>
            {rankBy === 'rush' ? (
              <>
                <span class="board-guesses">{p.seconds === null ? 'Not finished' : formatClock(p.seconds)}</span>
                <span class="board-time">{p.score === null ? '' : p.score.toFixed(1)}</span>
              </>
            ) : (
              <>
                <span class="board-guesses">{p.score === null ? 'Not finished' : p.score.toFixed(1)}</span>
                <span class="board-time">{p.seconds === null ? '' : formatClock(p.seconds)}</span>
              </>
            )}
          </li>
        ))}
      </ol>
      {rating?.after && (
        <p class="tally">Rating {rating.rating} → {rating.after.rating}</p>
      )}
    </>
  );
}
