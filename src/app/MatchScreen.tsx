import type { OpenProfile } from './profilePages';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ratedDifficultyFor, timeControlText, type WordError } from '../game';
import type { ApiIdentity } from './apiIdentity';
import { DIFFICULTY_LABEL, Keyboard } from './components';
import { API_URL } from './config';
import { addFriendGame } from './friendGames';
import { SecretStep } from './friendParts';
import { useMessage, useNow, usePhysicalKeyboard } from './hooks';
import { clockText, secretErrorMessage } from './messages';
import { displayName, type Profile } from './profileStorage';
import { queueApi, QueueApiError, queueChoice, type QueueError, type QueueStatus } from './queueApi';
import { addRecentSecret, loadRecentSecrets, saveRecentSecrets } from './recentSecrets';
import type { Settings } from './settings';

/** How often to check in while waiting: the server drops a player it hasn't heard from in 30 seconds. */
const POLL_MS = 2_000;

const WORD_ERRORS: readonly QueueError[] = ['wrong-length', 'not-letters', 'repeated-letters', 'not-in-word-list'];

function queueErrorMessage(code: QueueError, word: string): string {
  if (WORD_ERRORS.includes(code)) return secretErrorMessage(code as WordError, word);
  if (code === 'unreachable') return "Can't reach the game server. Check your connection and try again.";
  if (code === 'signed-out' || code === 'sign-in-needed') return 'You were signed out. Sign in again from your profile.';
  return 'Something went wrong. Reload the page and try again.';
}

/**
 * Finding a random opponent (README "Random opponent"): choose your word,
 * then wait in the queue for your time control and difficulty until the
 * server pairs you with someone of a similar rating. The game then opens
 * like any game against a friend. Matched games are rated, so this needs an
 * account.
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
  // Matched games are rated, so an Easy default plays at Medium.
  const difficulty = ratedDifficultyFor(settings.difficulty);
  const choice = queueChoice(settings.timeControl, difficulty);
  const [draft, setDraftState] = useState('');
  const [message, setMessage] = useMessage();
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Waiting in the queue with this word, since this time by the server's clock. */
  const [waiting, setWaiting] = useState<{ word: string; since: number; offset: number } | null>(null);
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
      setWaiting({ word, since: status.since, offset: status.now - Date.now() });
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
    return panel('Random opponents need the game server.', "This version of the app isn't connected to one.",
      <button class="btn primary" type="button" onClick={onExit}>Main menu</button>);
  }
  if (!signedIn) {
    return panel('Sign in to play a random opponent.',
      'Games against a random opponent are rated, so they need an account. Sign in from your profile, then come back.',
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
            rating; the longer you wait, the wider the search. Keep this page open.</p>
          <p class="field-note">Your word: <b>{waiting.word.toUpperCase()}</b></p>
          <div class="row-btns"><button class="btn" type="button" onClick={cancel}>Cancel</button></div>
        </section>
      </div>
    );
  }

  return (
    <SecretStep title="Find an opponent" draft={draft} shake={shake} onShakeEnd={() => setShake(false)}
      note={`Your opponent will try to guess your secret word. 5 letters, no repeated letters. Rated: ${timing}, `
        + `at ${DIFFICULTY_LABEL[difficulty]}, which stays fixed for the game.`}
      message={message} busy={busy} onDraft={setDraft} onBack={onExit}
      keyboard={<Keyboard ready={draft.length === 5} onLetter={typeLetter} onEnter={enter} onBackspace={backspace} />} />
  );
}
