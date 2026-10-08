import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Bubble } from './components';

/*
 * The end of a two player game, against the computer or a friend (issue
 * #101): the card with how it ended and their word, which × folds to one
 * line so the history behind it has the room.
 */

/**
 * Their word, revealed: a red ring round its letters, so it reads as their
 * word and not one of your guesses. `motion` is the reveal's animation
 * (`pop` or `flip`), if any.
 */
export function TheirWord({ word, motion }: { word: string; motion?: 'pop' | 'flip' }) {
  return (
    <div class={['letters', 'reveal', 'their-word', motion].filter(Boolean).join(' ')}>
      {[...word].map((c, i) => <Bubble key={i} letter={c} mark="in" class={`d${i}`} />)}
    </div>
  );
}

/**
 * The result card, with a × that folds it to one line: whose word it was
 * and the word (or "Hidden"). Tapping the line opens the card again, without replaying
 * its animations. A new game starts unfolded, since the card is new.
 */
export function ResultCard({ outcome, word, whose, children }: {
  /** The outcome class, e.g. `won` or `lost-final`. */
  outcome: string;
  /** Their word, or null while it's hidden (a loss you may still play on, README "Play on after a loss"). */
  word: string | null;
  /** E.g. "The computer's word" or "Sam's word". */
  whose: string;
  children: ComponentChildren;
}) {
  const [folded, setFolded] = useState(false);
  const [reopened, setReopened] = useState(false);
  // Focus follows the toggle, so a keyboard user isn't left on a removed button.
  const toggle = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) toggle.current?.focus();
  }, [folded]);
  const setFold = (fold: boolean) => {
    moved.current = true;
    if (!fold) setReopened(true);
    setFolded(fold);
  };

  if (folded) {
    return (
      <button type="button" class={`panel result folded ${outcome}`} ref={toggle} aria-expanded="false"
        aria-label={`${whose}: ${word ? word.toUpperCase() : 'hidden'}. Show the result`} onClick={() => setFold(false)}>
        <span class="folded-whose" aria-hidden="true">{whose}</span>
        {word ? <TheirWord word={word} /> : <span class="folded-hidden" aria-hidden="true">Hidden</span>}
        <svg class="folded-open" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
      </button>
    );
  }
  return (
    <section class={['panel', 'result', outcome, reopened ? 'again' : ''].filter(Boolean).join(' ')}>
      <button type="button" class="icon-btn result-fold" ref={toggle} aria-expanded="true"
        aria-label="Fold the result" title="Fold" onClick={() => setFold(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"
          aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      {children}
    </section>
  );
}
