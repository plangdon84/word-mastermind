import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { loadAllMatching, type HistoryGame } from './historyDb';

/** A status line under the input: a score, a hint, or an error. Clears itself. */
export interface Message {
  text: string;
  error: boolean;
  /** Read out to screen readers but not shown: a score the history already shows. */
  quiet?: boolean;
}

export function useMessage() {
  const [message, setMessage] = useState<Message | null>(null);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 2600);
    return () => clearTimeout(timer);
  }, [message]);
  return [message, setMessage] as const;
}

/**
 * Typing means you're writing a guess, so a button you tapped earlier (a tab,
 * ⓘ) lets go of focus, and Enter then sends the guess instead of pressing it.
 */
function releaseFocus(target: HTMLElement | null) {
  if (target?.closest('button:not(.key):not(.bubble)')) target.blur();
}

/**
 * A physical keyboard types too, unless the menu or a text field has focus.
 * Re-subscribes every render, so the handlers always see the latest state. A
 * layout effect subscribes before the next paint, so keys typed straight after
 * a screen appears aren't lost.
 */
export function usePhysicalKeyboard({ onLetter, onEnter, onBackspace }: {
  onLetter: (letter: string) => void;
  onEnter: () => void;
  onBackspace: () => void;
}) {
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, [data-menu-open]') || document.querySelector('[data-menu-open]')) {
        return;
      }
      if (e.key === 'Enter') {
        // Enter on a focused control (ⓘ, menu) activates that control. A
        // letter bubble keeps focus after a tap marks it, but Enter there
        // submits the guess rather than cycling the mark again.
        if (target?.closest('button:not(.key):not(.bubble)')) return;
        e.preventDefault();
        onEnter();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        releaseFocus(target);
        onBackspace();
      } else if (/^[a-z]$/i.test(e.key)) {
        releaseFocus(target);
        onLetter(e.key.toLowerCase());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}

/**
 * Every finished game in the history, newest first, or null while loading.
 * Loads again when `version` changes (after a restore, say). A history that
 * can't be read shows as empty. With `enabled` false, nothing loads.
 */
export function useHistoryGames(version: number, enabled = true): HistoryGame[] | null {
  const [games, setGames] = useState<HistoryGame[] | null>(null);
  useEffect(() => {
    let live = true;
    setGames(null);
    if (!enabled) return;
    loadAllMatching({}).then((g) => live && setGames(g), () => live && setGames([]));
    return () => {
      live = false;
    };
  }, [version, enabled]);
  return games;
}

/** The time now, updated every `everyMs` while the component is shown. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
