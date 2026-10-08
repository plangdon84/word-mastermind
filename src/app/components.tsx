import { useContext, useEffect, useRef } from 'preact/hooks';
import type { GuessResult, Marks, Strength } from '../game';
import type { DefinitionsState } from './definitions';
import { EnterSide } from './keyboard';
import type { Difficulty } from './settings';

export type Mark = 'unmarked' | 'in' | 'out';

const MARK_LABEL: Record<Mark, string> = { unmarked: 'unmarked', in: 'marked in', out: 'marked out' };

/** How a screen reader names a letter: "Letter T", since a lone capital is read as "cap T". */
const letterName = (letter: string) => `Letter ${letter.toUpperCase()}`;

/**
 * A round letter bubble. With `onTap` (Medium) it is a button that cycles the
 * letter's mark; without it (Hard, input, result) it is plain text.
 */
export function Bubble({ letter, mark = 'unmarked', class: extra = '', onTap, readMark = false }: {
  letter: string;
  mark?: Mark;
  class?: string;
  onTap?: () => void;
  /** Easy's guess list: a screen reader hears the app's mark too, as it's shown. */
  readMark?: boolean;
}) {
  const cls = ['bubble', mark === 'unmarked' ? '' : mark, extra].filter(Boolean).join(' ');
  if (!onTap) {
    if (!letter) return <span class={cls} />;
    return (
      <span class={cls}>
        <span aria-hidden="true">{letter}</span>
        <span class="visually-hidden">
          {letterName(letter)}{readMark && mark !== 'unmarked' ? `, ${MARK_LABEL[mark]}` : ''}
        </span>
      </span>
    );
  }
  return (
    <button type="button" class={cls} onClick={onTap}
      aria-label={`${letterName(letter)}, ${MARK_LABEL[mark]}. Tap to change.`}>
      {letter}
    </button>
  );
}

export const InfoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
    stroke-linecap="round" aria-hidden="true">
    <path d="M12 11v6" />
    <circle cx="12" cy="7" r="0.6" fill="currentColor" />
  </svg>
);

/**
 * A guess list's scroll box, kept on the newest guess: after each guess, and
 * whenever the box changes size while you're at the newest (a result card or
 * definition appearing below shrinks it), so the last line is never cut off.
 */
function useNewestInView(count: number, newestFirst: boolean) {
  const wrap = useRef<HTMLDivElement>(null);
  /** Whether the box is showing the newest guess; scrolling back through older ones clears it. */
  const atNewest = useRef(true);
  const toNewest = () => {
    const el = wrap.current;
    if (el) el.scrollTop = newestFirst ? 0 : el.scrollHeight;
  };
  useEffect(() => {
    atNewest.current = true;
    toNewest();
  }, [count, newestFirst]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onScroll = () => {
      atNewest.current = newestFirst ? el.scrollTop <= 2 : el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (atNewest.current) toNewest();
    });
    resized?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      resized?.disconnect();
    };
  }, [newestFirst]);
  return wrap;
}

/**
 * Scrolls a guess list so a definition just opened (or just loaded) shows in
 * full, without hiding its guess (issue #164): under the last guess it opened
 * below the box's edge, out of sight. Only the list scrolls, never the page.
 */
function useOpenDefinitionInView(wrap: { current: HTMLDivElement | null }, openDef: number, status: string) {
  useEffect(() => {
    const el = wrap.current;
    const row = openDef < 0 ? null : el?.querySelector('.definition')?.closest('.row');
    if (!el || !row) return;
    const box = el.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.bottom > box.bottom) el.scrollTop += Math.min(r.bottom - box.bottom, r.top - box.top);
  }, [openDef, status]);
}

/** The definition of one word, as shown under a guess or on the result screen. */
export function DefinitionBox({ word, state }: { word: string; state: DefinitionsState }) {
  if (state.status !== 'ready') {
    return (
      <p class="definition">
        <span class="loading">
          {state.status === 'error' ? "Couldn't load definitions." : 'Loading definition…'}
        </span>
      </p>
    );
  }
  const entries = state.definitions[word];
  if (!entries) {
    return (
      <p class="definition">
        <span class="none">No definition available for {word}.</span>
      </p>
    );
  }
  // One shared base word goes in the heading ("plots · form of plot"); mixed
  // entries ("dying": die, dying) name the base word per line. A screen reader
  // hears each line as one sentence rather than stopping on each part of it.
  const bases = new Set(entries.map((e) => e.l ?? word));
  const shared = bases.size === 1 ? entries[0].l : undefined;
  return (
    <p class="definition">
      <span>
        <span aria-hidden="true">
          <span class="word">{word}</span>
          {shared && <> · form of <span class="word">{shared}</span></>}
        </span>
        <span class="visually-hidden">Definition of {word}{shared ? `, a form of ${shared}` : ''}.</span>
      </span>
      {entries.map((e, i) => (
        <span key={i}>
          <span aria-hidden="true">
            <span class="pos">{e.p}</span>
            {e.l && !shared && <>, form of <span class="word">{e.l}</span></>}
            : {e.d}
          </span>
          <span class="visually-hidden">{word}, {e.p}{e.l && !shared ? `, a form of ${e.l}` : ''}: {e.d}</span>
        </span>
      ))}
    </p>
  );
}

export function History({
  guesses, marks, onMark, newestFirst, openDef, onToggleDef, definitions, practiceFrom,
  label = 'Your guesses', emptyText = 'No guesses yet. Type a 5-letter word and press Enter.',
}: {
  guesses: readonly GuessResult[];
  label?: string;
  emptyText?: string;
  /** Medium: your letter marks, and what tapping a letter does. Easy: the app's marks, not tappable. */
  marks?: Marks;
  onMark?: (letter: string) => void;
  newestFirst: boolean;
  openDef: number;
  onToggleDef: (index: number) => void;
  definitions: DefinitionsState;
  /** Guesses from this index on are practice, after a loss (README "Play on after a loss"). */
  practiceFrom?: number;
}) {
  const wrap = useNewestInView(guesses.length, newestFirst);
  useOpenDefinitionInView(wrap, openDef, definitions.status);

  return (
    <div class="history-wrap" ref={wrap}>
      <ol class={newestFirst ? 'history flip' : 'history'} aria-label={label}>
        {guesses.length === 0 && <li class="empty">{emptyText}</li>}
        {guesses.map((g, i) => [
          i === practiceFrom && <li class="practice-divider" key="practice">Practice: these don't count</li>,
          <li class={i >= (practiceFrom ?? Infinity) ? 'row practice' : 'row'} key={i}>
            {/* Each part is one stop for a screen reader: "Guess 7", then "Score 3". */}
            <span class="row-no"><span aria-hidden="true">{i + 1}</span><span class="visually-hidden">Guess {i + 1}</span></span>
            <button type="button" class="info" aria-label={`Definition of ${g.guess}`}
              aria-expanded={openDef === i} onClick={() => onToggleDef(i)}>
              <InfoIcon />
            </button>
            <div class="letters">
              {[...g.guess].map((c, j) => (
                <Bubble key={j} letter={c} mark={marks?.[c] ?? 'unmarked'}
                  onTap={onMark && (() => onMark(c))} readMark={!!marks} />
              ))}
            </div>
            {/* The winning row has no score: the result below says it, and "Win" didn't fit a phone. */}
            {g.isWin ? (
              <span class="score"><span class="visually-hidden">Found it</span></span>
            ) : (
              <>
                <span class="dash" aria-hidden="true">–</span>
                <span class="score"><span aria-hidden="true">{g.score}</span><span class="visually-hidden">Score {g.score}</span></span>
              </>
            )}
            {openDef === i && <DefinitionBox word={g.guess} state={definitions} />}
          </li>,
        ])}
      </ol>
    </div>
  );
}

/** The 5 input bubbles; the next one to fill is outlined. */
export function Slots({ draft, shake, onShakeEnd, class: extra = '', label = 'Current guess' }: {
  draft: string;
  shake: boolean;
  onShakeEnd: () => void;
  class?: string;
  label?: string;
}) {
  const cls = ['slots', shake ? 'shake' : '', extra].filter(Boolean).join(' ');
  return (
    <div class={cls} onAnimationEnd={(e) => e.animationName === 'shake' && onShakeEnd()}
      aria-label={`${label}: ${draft ? draft.toUpperCase() : 'empty'}`} role="img">
      {Array.from({ length: 5 }, (_, i) => {
        const c = draft[i];
        const cls = c ? 'slot filled' : i === draft.length ? 'slot next' : 'slot';
        return <Bubble key={i} letter={c ?? ''} class={cls} />;
      })}
    </div>
  );
}

/** Easy's Suggest (README "Easy"): fills the input with a word that fits the app's marks. */
export function SuggestButton({ left, onSuggest, disabled = false }: { left: number; onSuggest: () => void; disabled?: boolean }) {
  return (
    <button type="button" class="btn small suggest-btn" disabled={disabled || left <= 0} onClick={onSuggest}>
      Suggest <span class="suggest-left">({left} left)</span>
    </button>
  );
}

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

const ShuffleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">
    <path d="M16 4h4v4M4 20L20 4M20 16v4h-4M15 15l5 5M4 4l5 5" />
  </svg>
);

const BackspaceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">
    <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9l-6 6M11 9l6 6" />
  </svg>
);

export function Keyboard({ marks, onLetter, onEnter, onBackspace, enterLabel = 'Enter', ready = false, onShuffle }: {
  /** Medium and Easy: keys mirror the letter marks. Tapping a key only types. */
  marks?: Marks;
  enterLabel?: string;
  /** All 5 letters are typed: Enter lights up. */
  ready?: boolean;
  /** Easy and Medium: a Shuffle key that reorders the typed letters. */
  onShuffle?: () => void;
  onLetter: (letter: string) => void;
  onEnter: () => void;
  onBackspace: () => void;
}) {
  const side = useContext(EnterSide);
  const letter = (ch: string) => {
    const mark = marks?.[ch];
    return (
      <button type="button" class={mark ? `key ${mark}` : 'key'} key={ch}
        aria-label={`${letterName(ch)}${mark ? `, ${MARK_LABEL[mark]}` : ''}`}
        onClick={() => onLetter(ch)}>{ch}</button>
    );
  };
  const enter = (
    <button type="button" class={ready ? 'key wide enter ready' : 'key wide enter'} key="enter"
      onClick={onEnter}>{enterLabel}</button>
  );
  const backspace = (
    <button type="button" class="key wide backspace" key="backspace" aria-label="Backspace" onClick={onBackspace}>
      <BackspaceIcon />
    </button>
  );
  const [left, right] = side === 'right' ? [backspace, enter] : [enter, backspace];
  return (
    <div class="keyboard" aria-label="Keyboard">
      <div class="krow">{[...ROWS[0]].map(letter)}</div>
      <div class="krow">
        {[...ROWS[1]].map(letter)}
        {onShuffle && (
          <button type="button" class="key shuffle" key="shuffle" aria-label="Shuffle the typed letters"
            title="Shuffle" onClick={onShuffle}><ShuffleIcon /></button>
        )}
      </div>
      <div class="krow">{left}{[...ROWS[2]].map(letter)}{right}</div>
    </div>
  );
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy', medium: 'Medium', hard: 'Hard', extreme: 'Extreme',
};

export const STRENGTH_LABEL: Record<Strength, string> = {
  casual: 'Casual', skilled: 'Skilled', expert: 'Expert', mastermind: 'Mastermind',
};

/**
 * Extreme: your guesses are hidden, except the latest, which stays on screen
 * with its score until your next guess. Below it, a history of scores only,
 * numbered by guess.
 */
export function ScoreHistory({ guesses, newestFirst }: {
  guesses: readonly GuessResult[];
  newestFirst: boolean;
}) {
  const wrap = useNewestInView(guesses.length, newestFirst);
  const latest = guesses[guesses.length - 1];
  return (
    <div class="history-wrap scores-only" ref={wrap}>
      <div class="last-score" role="status">
        {latest ? (
          <>
            <span class="letters" aria-label={`Last guess: ${latest.guess.toUpperCase()}`}>
              {[...latest.guess].map((c, i) => <Bubble key={i} letter={c} />)}
            </span>
            <span class="last-score-value">
              <span aria-hidden="true">{latest.isWin ? 'Win' : latest.score}</span>
              <span class="visually-hidden">{latest.isWin ? 'Found it' : `Score ${latest.score}`}</span>
            </span>
            <span class="last-score-label">Guess {guesses.length} · hidden after your next guess</span>
          </>
        ) : (
          <span class="last-score-label">No guesses yet. Your words won't be shown: remember them.</span>
        )}
      </div>
      {guesses.length > 0 && (
        <ol class={newestFirst ? 'score-list flip' : 'score-list'} aria-label="Your scores">
          {guesses.map((g, i) => (
            <li key={i}>
              <span class="guess-no" aria-hidden="true">Guess {i + 1}</span>
              <span class={g.isWin ? 'score win' : 'score'} aria-hidden="true">{g.isWin ? 'Win' : g.score}</span>
              <span class="visually-hidden">Guess {i + 1}, {g.isWin ? 'found it' : `score ${g.score}`}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The three marks as real bubbles beside their words, for How to play and the
 * tutorial (issue #171): a sentence alone was read the wrong way round.
 */
export function MarkKey() {
  return (
    <ul class="mark-key">
      <li><Bubble letter="a" class="mini" /><span>Unmarked</span></li>
      <li><Bubble letter="a" mark="in" class="mini" /><span><b>In</b>: in the word</span></li>
      <li><Bubble letter="a" mark="out" class="mini" /><span><b>Out</b>: not in the word</span></li>
    </ul>
  );
}

/** The letters marked in (yours at Medium, the app's at Easy), as a set of green bubbles. */
export function InSet({ marks }: { marks: Marks }) {
  const letters = Object.keys(marks).filter((c) => marks[c] === 'in').sort();
  // Shown even when empty, so marking the first letter in doesn't push the guesses down.
  return (
    <div class="info-row">
      <span class="info-label">In</span>
      {/* One image to a screen reader: the bubbles would read as single letters. */}
      <span class="letters" role="img" aria-label={`Letters marked in: ${letters.length ? letters.join(', ').toUpperCase() : 'none yet'}`}>
        {letters.map((c) => <Bubble key={c} letter={c} mark="in" class="mini" />)}
        {letters.length === 0 && <span class="none" aria-hidden="true">None yet</span>}
      </span>
    </div>
  );
}

/**
 * Your secret word in two player: all green once the opponent has found it,
 * and before that, green in the letters their board has marked in (`known`).
 */
export function YourWord({ word, found, finder = 'the computer', known }: {
  word: string;
  found: boolean;
  /** Who is looking for your word, e.g. "the computer" or a friend's name. */
  finder?: string;
  /** The opponent's marks (README "Two player"): letters of your word they've worked out or marked in. */
  known?: Marks;
}) {
  const knownLetters = found ? [] : [...word].filter((c) => known?.[c] === 'in');
  const label = `Your word: ${word.toUpperCase()}${found ? `, found by ${finder}`
    : knownLetters.length > 0 ? `; ${finder} has ${knownLetters.join(', ').toUpperCase()}` : ''}`;
  return (
    <div class="info-row">
      <span class="info-label">Your word</span>
      <span class="letters" aria-label={label}>
        {[...word].map((c, i) => (
          <Bubble key={i} letter={c} mark={found || knownLetters.includes(c) ? 'in' : 'unmarked'} class="mini" />
        ))}
      </span>
    </div>
  );
}

/** What each difficulty's board shows of the opponent's work (README "Two player"). */
const OPPONENT_MARKS: Record<Difficulty, string> = {
  easy: 'the letters the app has worked out for them',
  medium: "the letters they've marked, sent with each guess",
  hard: 'no marks',
  extreme: 'no marks',
};

/**
 * A line above the opponent's guesses: the difficulty they play at, and what
 * their marks are. At Medium, `sharing` false says their latest guess came
 * without marks (they turned off sharing, or play on an app from before
 * 1.3.0; issue #129), so a plain board isn't taken for no marks.
 */
export function OpponentNote({ name, difficulty, sharing = true }: { name: string; difficulty: Difficulty; sharing?: boolean }) {
  return (
    <p class="board-note opponent-note">
      {difficulty === 'medium' && !sharing
        ? <>{name} plays at {DIFFICULTY_LABEL[difficulty]}. {name} isn't sharing marks.</>
        : <>{name} plays at {DIFFICULTY_LABEL[difficulty]}: {OPPONENT_MARKS[difficulty]}.</>}
    </p>
  );
}
