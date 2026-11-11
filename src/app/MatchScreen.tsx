import type { OpenProfile } from './profilePages';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LADDER_CHOICE, timeControlText, type WordError } from '../game';
import type { ApiIdentity } from './apiIdentity';
import { DIFFICULTY_LABEL, Keyboard } from './components';
import { API_URL } from './config';
import { addFriendGame } from './friendGames';
import { SecretStep } from './friendParts';
import { useMessage, useNow, usePhysicalKeyboard } from './hooks';
import { busyText, clockText, OFFENSIVE_NAME, secretErrorMessage } from './messages';
import { displayName, type Profile } from './profileStorage';
import { queueApi, QueueApiError, type QueueBusy, type QueueError, type QueueStatus } from './queueApi';
import { addRecentSecret, loadRecentSecrets, saveRecentSecrets } from './recentSecrets';
import type { Settings } from './settings';

/** How often to check in while waiting: the server drops a player it hasn't heard from in 30 seconds. */
const POLL_MS = 2_000;

/** How often the word step looks again at how busy the ladder is (Dev Plan item 19w). */
const BUSY_MS = 15_000;

const WORD_ERRORS: readonly QueueError[] = ['wrong-length', 'not-letters', 'repeated-letters', 'not-in-word-list'];

function queueErrorMessage(code: QueueError, word: string): string {
  if (WORD_ERRORS.includes(code)) return secretErrorMessage(code as WordError, word);
  if (code === 'unreachable') return "Can't reach the game server. Check your connection and try again.";
  if (code === 'signed-out' || code === 'sign-in-needed') return 'You were signed out. Sign in again from your profile.';
  if (code === 'offensive-name') return OFFENSIVE_NAME;
  return 'Something went wrong. Reload the page and try again.';
}

/**
 * The rated ladder (README "Random opponent", Dev Plan item 19q): choose
 * your word, then wait in the one queue (Live 10 at Medium) until the
 * server pairs you with someone of a similar rating, or after 30 seconds
 * with a computer at about your level. The game then opens like any game
 * against a friend. Ladder games are rated, so this needs an account.
 */
export function MatchScreen({ settings, profile, identity, signedIn, onProfile, onExit, onMatched }: {
  settings: Settings;
  profile: Profile;
  identity: ApiIdentity;
  signedIn: boolean;
  onProfile: OpenProfile;
  onExit: () => void;
  /** Matched: the game to open. */
  onMatched: (gameId: string) => void;
}) {
  const api = useMemo(() => (API_URL ? queueApi(API_URL, identity) : null), [identity]);
  // One queue, the rated ladder: Live 10 at Medium, whatever the player's own default difficulty.
  const choice = LADDER_CHOICE;
  const difficulty = choice.difficulty;
  const [draft, setDraftState] = useState('');
  const [message, setMessage] = useMessage();
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Waiting in the queue with this word, since this time by the server's clock, and how busy it was at the last check-in. */
  const [waiting, setWaiting] = useState<{ word: string; since: number; offset: number; busy: QueueBusy | null } | null>(null);
  /** How busy the ladder is, for the word step; null until first known. */
  const [ladderBusy, setLadderBusy] = useState<QueueBusy | null>(null);
  const draftRef = useRef(draft);
  const setDraft = (d: string) => {
    draftRef.current = d;
    setDraftState(d);
  };

  const matched = (gameId: string, word: string) => {
    addFriendGame(gameId, Date.now());
    saveRecentSecrets(addRecentSecret(loadRecentSecrets(), word));
    onMatched(gameId);
  };

  /** Where the server says you are: matched, still waiting, or (dropped) needing to join again. */
  const follow = (status: QueueStatus, word: string) => {
    if (status.state === 'matched') matched(status.gameId, word);
    else if (status.state === 'waiting') {
      const counts = status.playing === undefined ? null : { waiting: status.waiting, playing: status.playing };
      setWaiting({ word, since: status.since, offset: status.now - Date.now(), busy: counts });
    } else setWaiting(null);
  };

  const join = async (word: string) => {
    if (!api || busy) return;
    setBusy(true);
    try {
      follow(await api.join(choice, displayName(profile), word), word);
    } catch (e) {
      setMessage({ text: queueErrorMessage(e instanceof QueueApiError ? e.code : 'unreachable', word), error: true });
      setShake(true);
      setWaiting(null);
    } finally {
      setBusy(false);
    }
  };

  // Waiting: check in every couple of seconds, joining again if the server dropped you (a page in the background).
  const waitingWord = waiting?.word ?? null;
  useEffect(() => {
    if (!api || !waitingWord) return;
    let live = true;
    const check = async () => {
      try {
        const status = await api.poll(choice);
        if (!live) return;
        if (status.state === 'idle') follow(await api.join(choice, displayName(profile), waitingWord), waitingWord);
        else follow(status, waitingWord);
      } catch {
        // Try again at the next check.
      }
    };
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, waitingWord]);

  // On the word step: how busy the ladder is, on opening and every little while after, never while waiting
  // (each check-in says then), and not while the page is hidden: it looks again on coming back (review
  // round 1). A failed look keeps the last numbers, so the line doesn't flicker off.
  const onWordStep = signedIn && !waitingWord;
  useEffect(() => {
    if (!api || !onWordStep) return;
    let live = true;
    const look = () => {
      if (document.visibilityState === 'hidden') return;
      api.busy(choice).then((b) => live && setLadderBusy(b), () => {});
    };
    look();
    const timer = setInterval(look, BUSY_MS);
    document.addEventListener('visibilitychange', look);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', look);
    };
  }, [api, onWordStep]);

  // Leaving the screen while waiting leaves the queue.
  const leaveRef = useRef<(() => void) | null>(null);
  leaveRef.current = waitingWord && api ? () => void api.leave(choice).catch(() => {}) : null;
  useEffect(() => () => leaveRef.current?.(), []);

  const cancel = () => {
    leaveRef.current?.();
    setWaiting(null);
  };

  const typing = () => !waiting && !busy;
  const typeLetter = (letter: string) => {
    if (typing() && draftRef.current.length < 5) setDraft(draftRef.current + letter);
  };
  const backspace = () => {
    if (typing()) setDraft(draftRef.current.slice(0, -1));
  };
  const enter = () => {
    if (typing()) void join(draftRef.current);
  };
  usePhysicalKeyboard({ onLetter: typeLetter, onEnter: enter, onBackspace: backspace });
  const now = useNow(1000);

  const timing = `Live, ${timeControlText(choice.timeControl)}`;
  const panel = (title: string, text: string, buttons: ComponentChildren) => (
    <div class="app">
      <section class="panel">
        <h2>{title}</h2>
        <p>{text}</p>
        <div class="row-btns">{buttons}</div>
      </section>
    </div>
  );

  if (!api) {
    return panel('The rated ladder needs the game server.', "This version of the app isn't connected to one.",
      <button class="btn primary" type="button" onClick={onExit}>Main menu</button>);
  }
  if (!signedIn) {
    return panel('Sign in to play the rated ladder.',
      'Ladder games are rated, so they need an account. Sign in from your profile, then come back.',
      <>
        <button class="btn primary" type="button" onClick={() => onProfile('account')}>Open profile</button>
        <button class="btn" type="button" onClick={onExit}>Main menu</button>
      </>);
  }

  if (waiting) {
    return (
      <div class="app">
        <section class="panel searching">
          <h2 class="thinking">Looking for an opponent…</h2>
          <p class="search-time" role="timer">{clockText(now + waiting.offset - waiting.since)}</p>
          <p>Rated · {timing} · {DIFFICULTY_LABEL[difficulty]}. You'll be matched with a player of a similar
            rating, or a computer at about your level if no one is free after 30 seconds. Keep this page open.</p>
          {waiting.busy && <p class="ladder-busy">{busyText(waiting.busy, true)}</p>}
          <p class="field-note">Your word: <b>{waiting.word.toUpperCase()}</b></p>
          <div class="row-btns"><button class="btn" type="button" onClick={cancel}>Cancel</button></div>
        </section>
      </div>
    );
  }

  return (
    <SecretStep title="Rated ladder" draft={draft} shake={shake} onShakeEnd={() => setShake(false)}
      note={`Your opponent will try to guess your secret word. 5 letters, no repeated letters. Rated: ${timing}, `
        + `at ${DIFFICULTY_LABEL[difficulty]}, which stays fixed for the game.`}
      extra={ladderBusy && <p class="ladder-busy">{busyText(ladderBusy)}</p>}
      message={message} busy={busy} onDraft={setDraft} onBack={onExit}
      keyboard={<Keyboard ready={draft.length === 5} onLetter={typeLetter} onEnter={enter} onBackspace={backspace} />} />
  );
}
