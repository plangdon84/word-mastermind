import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  addPlayOnGuess, earlierGuess, NEW_PLAY_ON, playOnStage, practiceGuesses,
  type Difficulty, type GuessResult, type Marks, type PlayOnStage,
} from '../game';
import { Keyboard, Slots } from './components';
import type { Message } from './hooks';
import { errorMessage, guessCount, repeatMessage, scoreMessage } from './messages';
import { loadPlayOn, savePlayOn, type PlayOnSaved } from './playOnStorage';

/*
 * Playing on after a loss (README "Play on after a loss"), shared by both
 * two player screens: their word stays hidden until you choose to see it or
 * keep guessing it on the same board. The practice guesses live on this
 * device only (`playOnStorage.ts`), never in the game's record.
 */

export interface PlayOnState {
  /** Null when the game can't be played on (not over, not a loss, found, or a review). */
  stage: PlayOnStage | null;
  /** The practice guesses, scored. */
  guesses: readonly GuessResult[];
  /** Practising now, or practised: the board shows the practice marks, not the game's. */
  practised: boolean;
  /** Medium's marks while practising, starting from the game's. */
  marks: Marks;
  start: () => void;
  reveal: () => void;
  setMarks: (marks: Marks) => void;
  /**
   * A practice guess, checked against the game's guesses and the practice
   * ones so far. Returns the message to show, an error or the score.
   */
  guess: (word: string, gameGuesses: readonly GuessResult[], difficulty: Difficulty) => Message | null;
}

/**
 * `key` names the game on this device; `secret` is their word, once the game
 * is over; `can` is whether this game may be played on (`canPlayOn`).
 */
export function usePlayOn(key: string, secret: string | null, can: boolean, gameMarks: Marks): PlayOnState {
  const [saved, setSavedState] = useState<PlayOnSaved | null>(() => loadPlayOn(key));
  // Fast typing can outrun Preact's renders, so guesses read the latest from here.
  const savedRef = useRef(saved);
  const setSaved = (next: PlayOnSaved | null, store = true) => {
    savedRef.current = next;
    setSavedState(next);
    if (next && store) savePlayOn(key, next);
  };
  const loaded = useRef(key);
  useEffect(() => {
    if (loaded.current === key) return;
    loaded.current = key;
    setSaved(loadPlayOn(key), false);
  }, [key]);

  const active = can && secret !== null;
  const guesses = useMemo(() => (active ? practiceGuesses(secret, saved) : []), [active, secret, saved]);
  const stage = active ? playOnStage(secret, saved) : null;

  return {
    stage,
    guesses,
    practised: stage === 'playing' || guesses.length > 0,
    marks: saved?.marks ?? gameMarks,
    start: () => setSaved({ ...NEW_PLAY_ON, marks: gameMarks }),
    reveal: () => setSaved({ ...(savedRef.current ?? { ...NEW_PLAY_ON, marks: gameMarks }), revealed: true }),
    setMarks: (marks) => {
      if (savedRef.current) setSaved({ ...savedRef.current, marks });
    },
    guess: (word, gameGuesses, difficulty) => {
      const current = savedRef.current;
      if (!active || !current) return null;
      const repeat = earlierGuess([...gameGuesses, ...practiceGuesses(secret, current)], word);
      if (repeat) return { text: repeatMessage(word, repeat, difficulty), error: true };
      const result = addPlayOnGuess(secret, current, word);
      if (!result.ok) return { text: errorMessage(result.error, word), error: true };
      setSaved({ ...current, words: result.playOn.words });
      return result.result.isWin ? null : { text: scoreMessage(result.result), error: false, quiet: true };
    },
  };
}

/** In the result card, in place of their word: keep guessing it, or see it. */
export function PlayOnChoice({ whose, onKeepGuessing, onShow }: {
  /** E.g. "the computer's word" or "Sam's word". */
  whose: string;
  onKeepGuessing: () => void;
  onShow: () => void;
}) {
  return (
    <div class="play-on-choice">
      <p>Keep guessing {whose} for practice, or see it. Practice never changes this result.</p>
      <div class="row-btns">
        <button class="btn primary" type="button" onClick={onKeepGuessing}>Keep guessing</button>
        <button class="btn" type="button" onClick={onShow}>Show their word</button>
      </div>
    </div>
  );
}

/**
 * The result card's line on the practice, once it's done: how many more
 * guesses it took. Found, it names the game's own count too, since that's
 * the one kept (issue #143).
 */
export function PracticeLine({ stage, practice, game }: { stage: PlayOnStage | null; practice: number; game: number }) {
  if (stage === 'found') {
    return (
      <p class="practice-line">
        Found it after {practice} practice {practice === 1 ? 'guess' : 'guesses'}. The game counted {guessCount(game)}.
      </p>
    );
  }
  if (stage === 'revealed' && practice > 0) {
    return <p class="practice-line">Practice: {guessCount(practice)} more before you looked.</p>;
  }
  return null;
}

/** While practising: the banner, the input and the keyboard, in place of the game's. */
export function PracticeEntry({
  draft, shake, onShakeEnd, message, marks, onShuffle, onLetter, onEnter, onBackspace, onShow,
}: {
  draft: string;
  shake: boolean;
  onShakeEnd: () => void;
  message: Message | null;
  marks: Marks | undefined;
  onShuffle?: () => void;
  onLetter: (letter: string) => void;
  onEnter: () => void;
  onBackspace: () => void;
  onShow: () => void;
}) {
  return (
    <>
      <section class="banner practice" role="status">
        <span><strong>Practice:</strong> these guesses don't count.</span>
        <button class="btn" type="button" onClick={onShow}>Show their word</button>
      </section>
      <section class="entry">
        <Slots draft={draft} shake={shake} onShakeEnd={onShakeEnd} />
        <div class={message?.error ? 'message error' : 'message'} role="status">
          {message?.quiet ? <span class="visually-hidden">{message.text}</span> : message?.text}
        </div>
      </section>
      <Keyboard marks={marks} ready={draft.length === 5} onShuffle={onShuffle} onLetter={onLetter} onEnter={onEnter}
        onBackspace={onBackspace} />
    </>
  );
}
