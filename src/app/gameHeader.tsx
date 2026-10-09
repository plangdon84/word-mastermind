import type { OpenProfile } from './profilePages';
import type { ComponentChildren, RefObject } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
// Inlined, so its fill (currentColor) follows the text colour in dark mode.
import logo from '../assets/logo.svg?raw';
import { DIFFICULTIES, initials } from '../game';
import { useUnseenBadges } from './badges';
import { DIFFICULTY_LABEL } from './components';
import { PlayerName } from './friendLink';
import type { Review } from './panels';
import { displayName, type Profile } from './profileStorage';
import type { Difficulty } from './settings';

/** The top of a game screen: the ☰ menu, the profile button and the header rows. */

/** A popup that closes on a tap outside `root` or Escape, which hands focus back to `button`. */
function useDismiss(
  open: boolean, setOpen: (open: boolean) => void,
  root: RefObject<HTMLElement | null>, button: RefObject<HTMLButtonElement | null>,
) {
  // A layout effect, so Escape works from the moment the popup shows: a plain
  // effect runs after the paint, and a key pressed in between was lost.
  useLayoutEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
}

/** The ☰ menu: closes on a tap outside it or Escape. */
export function Menu({ children }: { children: (close: () => void) => ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useDismiss(open, setOpen, root, button);

  return (
    <div class="menu-root" ref={root}>
      <button type="button" class="icon-btn" ref={button} aria-label="Menu"
        aria-expanded={open} aria-controls="menu" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"
          aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      {open && <div class="menu" id="menu" data-menu-open>{children(() => setOpen(false))}</div>}
    </div>
  );
}

const LOCKED_NOTE = 'After your first guess you can only switch to an easier level.';

/** Whether `d` is harder than `than`. */
const harder = (d: Difficulty, than: Difficulty) => DIFFICULTIES.indexOf(d) > DIFFICULTIES.indexOf(than);

/**
 * The difficulty buttons. Once you've guessed, the harder ones are greyed out
 * (README "Difficulty Levels", issue #151): the rules refuse them too.
 */
function DifficultyChoices({ labelId, difficulty, difficulties, guessed, onDifficulty }: {
  labelId: string;
  difficulty: Difficulty;
  difficulties: readonly Difficulty[];
  guessed: boolean;
  onDifficulty: (difficulty: Difficulty) => void;
}) {
  return (
    <div class="seg" role="group" aria-labelledby={labelId}>
      {difficulties.map((d) => (
        <button type="button" key={d} aria-pressed={difficulty === d} disabled={guessed && harder(d, difficulty)}
          onClick={() => onDifficulty(d)}>
          {DIFFICULTY_LABEL[d]}
        </button>
      ))}
    </div>
  );
}

/** How a game's difficulty can change, for ☰ and the header's bubble alike. */
export interface DifficultyChoice {
  onDifficulty: (difficulty: Difficulty) => void;
  /** You've guessed: harder levels are greyed out. */
  guessed: boolean;
  /** The difficulties offered, if not all. */
  difficulties?: readonly Difficulty[];
}

/**
 * The header's difficulty, in its badges' metal (issue #149). Tapped, it
 * opens the difficulty choices (issue #150); picking one closes them.
 */
function DifficultyBubble({ difficulty, onDifficulty, guessed, difficulties = DIFFICULTIES }: { difficulty: Difficulty } & DifficultyChoice) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useDismiss(open, setOpen, root, button);
  return (
    <span class="diff-root" ref={root}>
      <button type="button" ref={button} class="diff-btn" aria-expanded={open}
        aria-controls="diff-pick" aria-label={`Difficulty: ${DIFFICULTY_LABEL[difficulty]}. Change it`}
        onClick={() => setOpen(!open)}>
        <span class={`matchup-diff diff-${difficulty}`}>
          {DIFFICULTY_LABEL[difficulty]}<span class="diff-caret" aria-hidden="true">▾</span>
        </span>
      </button>
      {open && (
        <div class="menu diff-pick" id="diff-pick">
          <span class="menu-label" id="diff-pick-label">Your difficulty</span>
          <DifficultyChoices labelId="diff-pick-label" difficulty={difficulty} difficulties={difficulties} guessed={guessed}
            onDifficulty={(d) => { setOpen(false); button.current?.focus(); if (d !== difficulty) onDifficulty(d); }} />
          {guessed && <span class="menu-note">{LOCKED_NOTE}</span>}
        </div>
      )}
    </span>
  );
}

/**
 * The ☰ menu's contents during a game: this game's difficulty, give up, exit.
 * Settings (default difficulty, guess order) are on the profile.
 */
export function GameMenuItems({
  close, onNewGame, newGameLabel = 'New game', difficulty, onDifficulty, difficulties = DIFFICULTIES, guessed = false, difficultyNote, moveOnLabel, onMoveOn, giveUpLabel, canGiveUp,
  onGiveUp, onExit, onHowToPlay, onReport, onCheckMarks, checksLeft, onClearMarks,
}: {
  close: () => void;
  /** Starts a new game with the same settings, asking first if this one has guesses. Daily Rush has none. */
  onNewGame?: () => void;
  /** The New game item's label: a game against a friend's is New invite. */
  newGameLabel?: string;
  /** This game's difficulty. Changing it is recorded in the game; without `onDifficulty` (game over) it can't change. */
  difficulty: Difficulty;
  onDifficulty?: (difficulty: Difficulty) => void;
  /** The difficulties offered: all but Easy where a game is rated. */
  difficulties?: readonly Difficulty[];
  /** You've guessed: harder levels are greyed out (README "Difficulty Levels"). */
  guessed?: boolean;
  /** Shown under the difficulty choice, e.g. how a Rush's difficulty is scored. */
  difficultyNote?: string;
  /** Runs only: give up the word being played and go on to the next. */
  moveOnLabel?: string;
  onMoveOn?: () => void;
  giveUpLabel: string;
  canGiveUp: boolean;
  onGiveUp: () => void;
  onExit: () => void;
  onHowToPlay: () => void;
  /** Opens Report an issue, with this game in it. */
  onReport: () => void;
  /** Medium, while playing: say whether your marks fit the scores, or clear them all. Easy marks for you, so has neither. */
  onCheckMarks?: () => void;
  /** Check for mistakes is once a game, once a word in a Rush (issue #134); unlimited when not given (practice). */
  checksLeft?: number;
  onClearMarks?: () => void;
}) {
  return (
    <>
      <div class="menu-group menu-difficulty">
        <span class="menu-label" id="diff-label">Your difficulty</span>
        {onDifficulty ? (
          <DifficultyChoices labelId="diff-label" difficulty={difficulty} difficulties={difficulties} guessed={guessed}
            onDifficulty={onDifficulty} />
        ) : (
          // Fixed (Daily Rush, a rated game, or the game is over): a line, not a greyed-out control.
          <span class="menu-fixed"><b>{DIFFICULTY_LABEL[difficulty]}</b></span>
        )}
        {onDifficulty && guessed && <span class="menu-note">{LOCKED_NOTE}</span>}
        {difficultyNote && <span class="menu-note">{difficultyNote}</span>}
      </div>
      {onCheckMarks && onClearMarks && (
        <div class="menu-group menu-highlights">
          <span class="menu-label">Highlights</span>
          <button class="btn menu-check" type="button" disabled={checksLeft === 0} onClick={() => { close(); onCheckMarks(); }}>
            Check for mistakes
            {checksLeft !== undefined && <span class="menu-count">{checksLeft === 0 ? 'used' : `${checksLeft} check${checksLeft === 1 ? '' : 's'} left`}</span>}
          </button>
          <button class="btn" type="button" onClick={() => { close(); onClearMarks(); }}>Clear all highlights</button>
          <span class="menu-note">
            Check says if your green and grey letters contradict a score, not which one.
            {checksLeft !== undefined && ' One check a game (a word in a Word Set).'}
          </span>
        </div>
      )}
      <hr />
      <button class="btn" type="button" onClick={() => { close(); onHowToPlay(); }}>
        How to play
      </button>
      <button class="btn menu-report" type="button" onClick={() => { close(); onReport(); }}>
        Report an issue
      </button>
      {moveOnLabel && (
        <button class="btn" type="button" disabled={!onMoveOn} onClick={() => { close(); onMoveOn?.(); }}>
          {moveOnLabel}
        </button>
      )}
      <button class="btn menu-give-up" type="button" disabled={!canGiveUp} onClick={() => { close(); onGiveUp(); }}>
        {giveUpLabel}
      </button>
      {onNewGame && <button class="btn" type="button" onClick={() => { close(); onNewGame(); }}>{newGameLabel}</button>}
      <button class="btn" type="button" onClick={() => { close(); onExit(); }}>
        Main menu
      </button>
    </>
  );
}

/**
 * The logo cropped to the detective's head, for the profile bubble before you
 * set a name. Its title and ID are dropped, since the title screen shows the
 * full logo too.
 */
const avatarLogo = logo
  .replace(/viewBox="[^"]*"/, 'viewBox="300 100 560 560"')
  .replace(/<title[^>]*>[\s\S]*?<\/title>/, '')
  .replace(/ role="img" aria-labelledby="[^"]*"/, ' aria-hidden="true" focusable="false"');

/** Your initials in a letter bubble, or the logo until you set a name. */
export function ProfileBadge({ profile, class: extra = '' }: { profile: Profile; class?: string }) {
  return (
    <span class={['profile-badge', profile.name ? '' : 'guest', extra].filter(Boolean).join(' ')} aria-hidden="true">
      {profile.name ? initials(profile.name) : <span class="avatar-logo" dangerouslySetInnerHTML={{ __html: avatarLogo }} />}
    </span>
  );
}

/** The profile button, just left of ☰ (and top right on the title screen). */
export function ProfileButton({ profile, onOpen }: { profile: Profile; onOpen: () => void }) {
  // A dot for badges earned since you last looked at Achievements; its row there has the dot too.
  const dot = useUnseenBadges();
  return (
    <button type="button" class="profile-btn" onClick={() => onOpen()}
      aria-label={`Profile: ${displayName(profile)}${dot ? ', new badges' : ''}`}
      title={dot ? 'New badges: see Achievements in your profile' : 'Your profile'}>
      <ProfileBadge profile={profile} />
      {dot && <span class="profile-dot" aria-hidden="true" />}
    </button>
  );
}

const reviewDate = (review: Review) =>
  new Date(review.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * A reviewed game's tag, in place of the profile button (which went back to
 * the history anyway): small, so the history keeps the room (issue #101).
 */
function PastGameTag({ review }: { review: Review }) {
  const what = review.owner ? `${review.owner}'s game` : 'Past game';
  const back = review.owner ? `${review.owner}'s history` : 'history';
  return (
    <button type="button" class="past-tag" onClick={review.onBack}
      aria-label={`${what}, ${reviewDate(review)}: back to ${back}`} title={`Back to ${back}`}>
      <span aria-hidden="true">←</span> {what}
    </button>
  );
}

/**
 * Rows 1 and 2 of a game screen: title (home), profile and ☰ (with New game),
 * then who's playing whom. Reviewing a past game, the profile button is a
 * **Past game** tag back to the history, and ☰ starts with its date.
 */
export function GameHeader({
  menu, profile, onProfile, onHome, opponent, opponentCode = null, opponentRating, matchup, difficulty, difficultyChoice, review, suggested = 0, children,
}: {
  profile: Profile;
  /** The name top left: back to the main menu, as ☰ Main menu does. */
  onHome: () => void;
  /** Opens the profile, leaving this game (a Rush pauses, as for the main menu). */
  onProfile: OpenProfile;
  menu: (close: () => void) => ComponentChildren;
  /** E.g. "Computer · Expert". */
  opponent?: string;
  /** A friend opponent's friend code, from the server: their name then opens their profile. */
  opponentCode?: string | null;
  /** A rated game's opponent rating, e.g. "1512?": always shown whole, while a long name is cut short (…). */
  opponentRating?: string;
  /** Replaces "You vs. opponent" in modes without an opponent (Rush). */
  matchup?: ComponentChildren;
  difficulty: Difficulty;
  /** While it can change: tapping the difficulty bubble opens the choices, as ☰ has them. */
  difficultyChoice?: DifficultyChoice;
  /** A past game from the history, shown read-only. */
  review?: Review | null;
  /** How many times the reviewed game used Suggest, said under its date in ☰. */
  suggested?: number;
  /** Row 3 and below. */
  children?: ComponentChildren;
}) {
  return (
    <header>
      <div class="brand">
        <h1><button type="button" class="brand-home" aria-label="Word Mastermind: main menu" onClick={onHome}>
          <img class="brand-icon" src="/icon-192.png" alt="" width={26} height={26} />
          Word Mastermind
        </button></h1>
        <div class="actions">
          {review ? <PastGameTag review={review} /> : <ProfileButton profile={profile} onOpen={onProfile} />}
          <Menu>{(close) => (
            <>
              {review && (
                <p class="menu-note menu-past">
                  {review.owner ? `${review.owner}'s game` : 'A past game'} · {reviewDate(review)}
                  {suggested > 0 && ` · Suggest used ${suggested === 1 ? 'once' : `${suggested} times`}`}
                </p>
              )}
              {menu(close)}
            </>
          )}</Menu>
        </div>
      </div>
      <div class="matchup">
        {matchup ?? (
          <span class="matchup-who">
            <b>You</b>&nbsp;vs.&nbsp;<b class="matchup-name"><PlayerName name={opponent ?? ''} code={opponentCode} /></b>
            {opponentRating && <span class="matchup-rating">&nbsp;(<span class="visually-hidden">rating </span>{opponentRating})</span>}
          </span>
        )}
        {difficultyChoice
          ? <DifficultyBubble difficulty={difficulty} {...difficultyChoice} />
          : <span class={`matchup-diff diff-${difficulty}`}>{DIFFICULTY_LABEL[difficulty]}<span class="visually-hidden"> difficulty</span></span>}
      </div>
      {children}
    </header>
  );
}
