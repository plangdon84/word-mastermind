import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { FEATURES } from '../game';
import type { Circle } from './leaderboardsApi';
import { Bubble, MarkKey, type Mark } from './components';

/** Panels and dialogs shared by the screens: How to play, confirmations, reviews and the board pages. */

/** A profile page that needs the game server, in a build without one (`VITE_API_URL` unset). */
export function NoServerSection({ label, needs }: { label: string; needs: string }) {
  return (
    <section class="profile-section" aria-label={label}>
      <p class="field-note">{needs} needs the game server, which this version doesn't have.</p>
    </section>
  );
}

/** A past game from the history, as it looked when it ended (README "Game history"). */
export interface Review {
  /** When the game ended, in milliseconds since the epoch. */
  date: number;
  onBack: () => void;
}

/**
 * Asked before Play again from a review when a game of that mode is in
 * progress, since starting a new one ends it.
 */
export function ReplaceGamePanel({ what, onConfirm, onCancel }: {
  /** E.g. "a single-player game". */
  what: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <section class="panel warning">
      <h2>You have {what} in progress.</h2>
      <p>Playing again ends it, and it won't be saved to your history. Go to the main menu to continue it instead.</p>
      <div class="row-btns">
        <button class="btn primary" type="button" onClick={onConfirm}>End it and play again</button>
        <button class="btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

/**
 * A modal that closes on Escape, the ✕ button, or a tap outside it. While
 * it's open the page behind it stays still: only the modal's body scrolls.
 */
export function Modal({ title, onClose, class: extra = '', children }: {
  title: string;
  onClose: () => void;
  class?: string;
  children: ComponentChildren;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  // Where focus was before opening, taken before any child moves it.
  const previous = useRef(document.activeElement as HTMLElement | null);
  // Escape reaches the latest onClose, not the first render's.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // A child may already have focused something of its own (ConfirmDialog's safe choice).
    if (!backdrop.current?.contains(document.activeElement)) closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    // iOS Safari still scrolls the page for a swipe on the backdrop, and for
    // one in a modal body with nothing (left) to scroll, so a one-finger swipe
    // is stopped unless the body can take it. Two fingers pinch-zoom, and once
    // zoomed in, a swipe pans the view.
    const el = backdrop.current;
    let lastY = 0;
    const onStart = (e: TouchEvent) => { lastY = e.touches[0]?.clientY ?? 0; };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1) return;
      const y = e.touches[0].clientY;
      const down = y > lastY;
      lastY = y;
      const target = e.target as Element;
      if (target.closest?.('textarea')) return;
      const body = target.closest?.('.modal-body');
      const atEnd = !body || body.scrollHeight <= body.clientHeight
        || (down ? body.scrollTop <= 0 : body.scrollTop + body.clientHeight >= body.scrollHeight - 1);
      if (atEnd) e.preventDefault();
    };
    el?.addEventListener('touchstart', onStart, { passive: true });
    el?.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      document.removeEventListener('keydown', onKey);
      el?.removeEventListener('touchstart', onStart);
      el?.removeEventListener('touchmove', onMove);
      root.style.overflow = overflow;
      previous.current?.focus();
    };
  }, []);
  return (
    // data-menu-open keeps typing from reaching the game underneath.
    <div class="modal-backdrop" ref={backdrop} data-menu-open onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class={['modal', extra].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" class="icon-btn" ref={closeButton} aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"
              aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div class="modal-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * An "are you sure" as a pop-up, so it's in view wherever the button was.
 * Focus starts on the safe choice; Escape, ✕ and a tap outside cancel.
 */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel }: {
  title: string;
  body: ComponentChildren;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <Modal title={title} class="confirm" onClose={onCancel}>
      <p>{body}</p>
      <div class="row-btns">
        <button type="button" class="btn primary" onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" class="btn" ref={cancel} onClick={onCancel}>{cancelLabel}</button>
      </div>
    </Modal>
  );
}

const Word = ({ word, mark }: { word: string; mark?: Mark }) => (
  <span class="letters inline">
    {[...word].map((c, i) => <Bubble key={i} letter={c} mark={mark} class="mini" />)}
  </span>
);

/** The rules, scoring, marking and difficulties, from the ☰ menu or the title screen. */
export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <p>
        Find the secret word: 5 letters, no letter repeated. After each guess you're told
        <b> how many distinct letters</b> your guess shares with it, but not which ones.
        Position doesn't matter.
      </p>
      <p class="example"><Word word="beach" /> vs. <Word word="bunny" /> – 1 (the B)</p>
      <ul>
        <li>Guesses may repeat letters. Each letter counts once.</li>
        <li>An anagram of the word scores 5 but doesn't win: only the exact word wins.</li>
        <li>A score of 0 rules out every letter in that guess.</li>
        <li>A word you've already guessed isn't taken again: you're told which guess it was.</li>
      </ul>
      <h3>Marking letters (Medium)</h3>
      <MarkKey />
      <p>
        Tap a letter in your guesses to cycle it: unmarked, then in, then out, then unmarked again. A mark
        applies to that letter in every guess.
      </p>
      <p>Letters marked in are collected above your guesses. On Easy, the app does the marking for you.</p>
      <h3>Difficulty</h3>
      <ul>
        <li><b>Easy:</b> after each guess the app marks the letters that must be in or can't be, from the scores
          alone. <b>Suggest</b> fills in a word that fits every score, once a game (once a word in a Rush). Not in
          rated games.</li>
        <li><b>Medium:</b> mark letters in or out yourself.</li>
        <li><b>Hard:</b> just your guesses and their scores.</li>
        <li><b>Extreme:</b> your words are hidden. Only the scores are shown, so remember what you guessed.</li>
      </ul>
      {/* The modes in the home screen's order. */}
      <h3>Single player</h3>
      <p>Find the computer's secret word in as few guesses as you can.</p>
      <h3>Two player</h3>
      <p>
        You and your opponent each pick a secret word and take turns guessing. A coin toss picks who
        goes first. If the first player finds the word, the other gets <b>one final guess</b>: a hit
        makes it a draw. If the second player finds it first, they win outright.
      </p>
      <ul>
        <li><b>The computer</b> plays at the strength you choose, from Casual to Mastermind.</li>
        <li><b>A friend</b> joins by your invite link, or from your friends list once you're signed in. Play
          live, each on a chess clock of 15, 10 or 5 minutes that runs only on your turn (run out and you
          lose), or take turns over days, 1 or 3 days a guess (miss it and you concede). A challenge from
          your friends list can be rated.</li>
      </ul>
      <p>
        Your opponent's tab shows their guesses with marks to match their difficulty: on Easy, what the app
        has worked out for them; on Medium, the letters they've marked; on Hard and Extreme, none. The
        computer's tab shows Easy's marks. Letters of your word they've marked in turn green at the top.
        At Medium, a friend sees your marks with each guess you send, unless you turn off <b>Share my
        Medium marks</b> in your profile's settings.
      </p>
      <h3>Solo Rush</h3>
      <p>
        Find 4 random secret words, one after another, against a stopwatch. Each word starts as soon as
        you find the last. The stopwatch pauses while you're away. You can give up a word and move on,
        but it counts as your worst word plus 10 guesses. Giving up the whole Rush ends it without a score.
        Your score is your average guesses per word, counted for more at Easy (×1.2) and for less at harder
        difficulties (Hard ×0.9, Extreme ×0.8) at the easiest difficulty you used. It ranks you against the computer's strengths:
        under 10 is Mastermind, under 15 Expert, up to 20 Skilled, and above that Casual.
      </p>
      <h3>Daily Rush</h3>
      <p>
        Everyone gets the same 4 words each day, on a theme, once. Choose your difficulty before you start:
        it can't change. Pause stops your clock and hides the board. Find all 4 before midnight New York time to go on that day's
        leaderboard for your difficulty, ranked by total guesses, with time breaking ties (a run still going then can
        be finished, off the board). Giving up a
        word ends your Daily Rush for the day, with no place on the leaderboard.
      </p>
      <h3>Rush with Friends</h3>
      <p>
        Up to 5 players, joined by a code or link, solve the same 4 words on one clock that never pauses.
        The host picks the difficulty and how long it runs, and can fill empty seats with computers. Scores
        work as in Solo Rush, but a word you give up or don't find counts as the most guesses anyone
        took to solve it (or yours, if more), plus 10.{FEATURES.competitiveRush && <> In <b>Competitive Rush</b>, each player sets a
        word and solves the others', and it's rated.</>}
      </p>
      <p class="credit">
        Definitions from <a href="https://github.com/globalwordnet/english-wordnet"
          target="_blank" rel="noreferrer">Open English WordNet</a> 2025, CC BY 4.0.
      </p>
    </Modal>
  );
}

export const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
);

/**
 * A board's page: its header with ← Back, and signed in, the Everyone /
 * Friends toggle.
 */
export function BoardPage({ title, onBack, circle, onCircle, children }: {
  title: string;
  onBack: () => void;
  /** Signed out, there's no toggle: a guest has no friends list. */
  circle: Circle | null;
  onCircle: (circle: Circle) => void;
  children: ComponentChildren;
}) {
  return (
    <div class="app leaderboards">
      <header class="step-head">
        <button type="button" class="icon-btn" aria-label="Back" onClick={onBack}><BackIcon /></button>
        <h2>{title}</h2>
      </header>
      {circle && (
        <div class="seg board-circle" role="group" aria-label="Who's listed">
          {(['everyone', 'friends'] as const).map((c) => (
            <button type="button" key={c} aria-pressed={circle === c} onClick={() => onCircle(c)}>
              {c === 'everyone' ? 'Everyone' : 'Friends'}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

/** The padlock on a locked mode's tile (README "Unlocking modes"). */
export const LockIcon = () => (
  <svg class="lock-icon" viewBox="0 0 16 16" width="22" height="22" aria-hidden="true">
    <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.8" />
    <rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor" />
  </svg>
);

/**
 * A newer version is out (issue #136): Update reloads into it, back into
 * this game, which is saved either way; ✕ hides the bar until the next one.
 */
export function UpdateBar({ onUpdate, onHide }: { onUpdate: () => void; onHide: () => void }) {
  return (
    <div class="update-bar" role="status">
      <span>A new version is ready</span>
      <button type="button" class="btn primary" onClick={onUpdate}>Update</button>
      <button type="button" class="icon-btn" aria-label="Not now" onClick={onHide}>✕</button>
    </div>
  );
}
