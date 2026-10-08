import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { pickRandomSecret, SECRET_WORDS, turnDaysOf, type PvpView, type TimeControl } from '../game';
import { Bubble, DefinitionBox, Slots } from './components';
import { SuggestNote } from './Badge';
import { BackIcon } from './panels';
import { ResultCard, TheirWord } from './resultCard';
import type { DefinitionsState } from './definitions';
import type { FriendGame, RatingLine } from './friendApi';
import { inviteLink, inviteMessage, smsLink } from './friendGames';
import { durationText, guessCount } from './messages';
import { ratingText } from './ratingsApi';
import { loadRecentSecrets } from './recentSecrets';
import { shareLink } from './share';

/** The parts of a game against a friend around the board: choosing your word, the invite, and the result. */

export const upper = (word: string) => word.toUpperCase();
/** A correspondence game's time per guess: "3 days". */
const turnTime = (control: TimeControl) => {
  const days = turnDaysOf(control) ?? 1;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
};

/** How the game ended, from your side. See README "Final guess and draws". */
export type Outcome =
  | 'won' | 'won-held' | 'lost' | 'lost-final' | 'clutch' | 'tied' | 'they-gave-up' | 'gave-up'
  | 'they-ran-out' | 'ran-out';

export function outcomeOf(view: PvpView): Outcome | null {
  const o = view.outcome;
  if (!o) return null;
  if (o.reason === 'conceded') return o.result === 'won' ? 'they-gave-up' : 'gave-up';
  if (o.reason === 'timed-out') return o.result === 'won' ? 'they-ran-out' : 'ran-out';
  if (o.result === 'draw') return view.first === 'opponent' ? 'clutch' : 'tied';
  if (o.result === 'won') return view.first === 'you' ? 'won-held' : 'won';
  return view.first === 'opponent' ? 'lost-final' : 'lost';
}

/** A confetti burst for the clutch draw. CSS only; hidden under reduced motion. */
function Confetti() {
  const colors = ['var(--in-bg)', 'var(--accent)', '#F2B705', '#E4572E', 'var(--ink)'];
  return (
    <div class="confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => (
        <span key={i} style={{
          '--x': `${(i * 37) % 100}vw`,
          '--drift': `${((i * 53) % 40) - 20}vw`,
          '--delay': `${(i % 9) * 70}ms`,
          '--spin': `${(i % 2 ? 1 : -1) * (360 + (i * 47) % 360)}deg`,
          background: colors[i % colors.length],
        }} />
      ))}
    </div>
  );
}

/** Choosing your secret word: to send an invite, or to accept one. */
export function SecretStep({ title, note, draft, shake, onShakeEnd, message, busy, onDraft, onBack, backLabel = 'Back to main menu', keyboard, extra }: {
  title: string;
  note: string;
  /** Shown under the note: a challenge's Rated switch. */
  extra?: ComponentChildren;
  draft: string;
  shake: boolean;
  onShakeEnd: () => void;
  message: { text: string; error: boolean } | null;
  busy: boolean;
  onDraft: (word: string) => void;
  onBack: () => void;
  backLabel?: string;
  keyboard: ComponentChildren;
}) {
  const [recent] = useState(loadRecentSecrets);
  return (
    <div class="app">
      <header class="step-head">
        <button type="button" class="icon-btn" aria-label={backLabel} onClick={onBack}><BackIcon /></button>
        <h2>{title}</h2>
      </header>
      <p class="step-note">{note}</p>
      {extra}
      <div class="setup-space" />
      <section class="entry">
        <Slots draft={draft} shake={shake} onShakeEnd={onShakeEnd} label="Your secret word" />
        <div class={message?.error ? 'message error' : 'message'} role="status">
          {busy ? 'Sending…' : message?.text}
        </div>
        {/* Each drops focus after use, so a physical Enter submits instead of pressing it again. */}
        <button type="button" class="btn" onClick={(e) => {
          onDraft(pickRandomSecret(SECRET_WORDS));
          e.currentTarget.blur();
        }}>
          Pick for me
        </button>
        {recent.length > 0 && (
          <div class="recent">
            <span class="info-label">Recently used</span>
            <div class="recent-words">
              {recent.map((w) => (
                <button type="button" class="chip" key={w} aria-pressed={draft === w}
                  onClick={(e) => { onDraft(w); e.currentTarget.blur(); }}>{upper(w)}</button>
              ))}
            </div>
          </div>
        )}
      </section>
      {keyboard}
    </div>
  );
}

/** The share icon: a box with an arrow leaving it. */
export const ShareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
);

/** A phone (a touch screen), where a text message is the natural way to send the link. */
export const isPhone = () => matchMedia('(pointer: coarse)').matches;

/**
 * The invite link, with Copy and Share. Share opens the device's share sheet
 * (Messages, WhatsApp, email…) with the link and a message; a phone whose
 * browser can't share gets a link that opens its messaging app instead.
 */
export function InvitePanel({ game, onCancel }: { game: FriendGame; onCancel: () => void }) {
  if (game.inviteeName) return <ChallengePanel game={game} name={game.inviteeName} onCancel={onCancel} />;
  const link = inviteLink(location.origin, game.id);
  const message = inviteMessage(game.hostName, game.timeControl);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // No clipboard access: select the link so it can be copied by hand.
      field.current?.select();
    }
  };
  const share = () => {
    shareLink({ title: 'Word Mastermind', text: message, url: link });
  };
  return (
    <section class="panel invite">
      <h2>Send this link to a friend</h2>
      <p>The game starts when they accept and choose their word. Only the first person to open it can play.
        {game.expiresAt !== null && ` The link expires in ${durationText(game.expiresAt - Date.now())}.`}</p>
      <label class="visually-hidden" for="invite-link">Invite link</label>
      <input id="invite-link" class="invite-link" ref={field} readOnly value={link}
        onFocus={(e) => e.currentTarget.select()} />
      <div class="row-btns">
        <button class="btn primary" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        {'share' in navigator ? (
          <button class="btn share" type="button" onClick={share}><ShareIcon />Share</button>
        ) : isPhone() && (
          <a class="btn share" href={smsLink(message, link)}><ShareIcon />Text it</a>
        )}
      </div>
      <p class="waiting thinking">Waiting for your friend…</p>
      <button type="button" class="btn" onClick={onCancel}>Cancel invite</button>
    </section>
  );
}

/** A challenge sent to a friend from your friends list: no link, since only they can accept it. */
function ChallengePanel({ game, name, onCancel }: { game: FriendGame; name: string; onCancel: () => void }) {
  return (
    <section class="panel invite">
      <h2>{game.rated ? 'Rated ' : ''}{game.rematchOf ? (game.rated ? 'rematch' : 'Rematch') : game.rated ? 'challenge' : 'Challenge'} sent to {name}</h2>
      <p>The game starts when they accept and choose their word. It's waiting on their home screen, and they've been
        told if they have turn alerts on.
        {game.expiresAt !== null && ` It expires in ${durationText(game.expiresAt - Date.now())}.`}</p>
      <p class="waiting thinking">Waiting for {name}…</p>
      <button type="button" class="link-btn" onClick={onCancel}>Cancel {game.rematchOf ? 'rematch' : 'challenge'}</button>
    </section>
  );
}

/** A rating change at the end of a rated game: "Rating 1500? → 1662? (+162)". */
export function RatingChange({ line }: { line: RatingLine }) {
  if (!line.after) return null;
  const change = line.after.rating - line.rating;
  return (
    <p class="rating-change">
      Rating {ratingText(line)} → <b>{ratingText(line.after)}</b>{' '}
      <span class={change > 0 ? 'trend good' : change < 0 ? 'trend bad' : 'trend flat'}>
        ({change > 0 ? '+' : change < 0 ? '−' : '±'}{Math.abs(change)})
      </span>
    </p>
  );
}


/**
 * The end of a game against a friend: how it ended, their word (with its
 * definition), your rating change, and `children`, the buttons.
 */
export function FriendResult({ view, outcome, opponent, live, definitions, rating, choice, practice, found = false, children }: {
  view: PvpView & { theirSecret: string };
  outcome: Outcome;
  opponent: string;
  live: boolean;
  definitions: DefinitionsState;
  rating: RatingLine | null | undefined;
  /**
   * After a loss (README "Play on after a loss"): the choice to keep
   * guessing or see their word, shown in place of it until it's made.
   */
  choice?: ComponentChildren;
  /** How the practice went, once it's done. */
  practice?: ComponentChildren;
  /** A practice guess found their word. */
  found?: boolean;
  children: ComponentChildren;
}) {
  const lastTheirs = view.theirGuesses[view.theirGuesses.length - 1];
  const youFoundTheirs = view.yourGuesses.some((g) => g.isWin);
  return (
    <ResultCard outcome={outcome} word={choice ? null : view.theirSecret} whose={`${opponent}'s word`}>
      {outcome === 'clutch' && <Confetti />}
      {outcome === 'clutch' ? (
        <>
          <p class="kicker">Clutch!</p>
          <h2>You tied it on your last guess.</h2>
          <p class="badge">Draw</p>
        </>
      ) : (
        <h2>{{
          'won': 'You win!',
          'won-held': 'You win!',
          'they-gave-up': `${opponent} gave up. You win!`,
          'lost': `${opponent} wins.`,
          'lost-final': `So close. ${opponent} wins.`,
          'tied': `${opponent} tied it. Draw.`,
          'gave-up': `You gave up. ${opponent} wins.`,
          'they-ran-out': `${opponent} ran out of time. You win!`,
          'ran-out': `You ran out of time. ${opponent} wins.`,
        }[outcome]}</h2>
      )}
      <p>{{
        'won': `You found their word in ${guessCount(view.yourGuesses.length)}, before they found yours.`,
        'won-held': `You found their word in ${guessCount(view.yourGuesses.length)}, and their last guess, ${upper(lastTheirs?.guess ?? '')}, missed.`,
        'they-gave-up': `You made ${guessCount(view.yourGuesses.length)}; ${opponent} made ${guessCount(view.theirGuesses.length)}.`,
        'lost': `${opponent} found ${upper(view.yourSecret)} in ${guessCount(view.theirGuesses.length)}.`,
        'lost-final': `${opponent} found ${upper(view.yourSecret)} in ${guessCount(view.theirGuesses.length)}, and your last guess missed.`,
        'clutch': `${opponent} found ${upper(view.yourSecret)} first, and you matched it.`,
        'tied': `You found their word first, and ${opponent} matched you with their last guess.`,
        'gave-up': `You made ${guessCount(view.yourGuesses.length)}; ${opponent} made ${guessCount(view.theirGuesses.length)}.`,
        'they-ran-out': live ? `${opponent}'s clock ran out, so the game is yours.`
          : `${opponent} didn't guess within ${turnTime(view.timeControl)}, so the game is yours.`,
        'ran-out': live ? `Your clock ran out, so the game went to ${opponent}.`
          : `You didn't guess within ${turnTime(view.timeControl)}, so the game went to ${opponent}.`,
      }[outcome]}</p>
      {choice ? choice : (
        <>
          {!youFoundTheirs && <p>{opponent}'s word was</p>}
          <TheirWord word={view.theirSecret}
            motion={outcome === 'clutch' ? 'flip' : outcome.startsWith('won') || outcome.startsWith('they') || found ? 'pop' : undefined} />
          <DefinitionBox word={view.theirSecret} state={definitions} />
          {practice}
        </>
      )}
      {/* Your count, where the line above didn't already give it. */}
      {!['won', 'won-held', 'gave-up', 'they-gave-up'].includes(outcome) && <p class="tally">You: {guessCount(view.yourGuesses.length)}</p>}
      <SuggestNote found={youFoundTheirs} guesses={view.yourGuesses.length} suggested={view.suggested} />
      {rating && <RatingChange line={rating} />}
      <div class="row-btns">
        {children}
      </div>
    </ResultCard>
  );
}
