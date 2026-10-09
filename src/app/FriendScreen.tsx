import type { OpenProfile } from './profilePages';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  canPlayOn, cycleMark, DIFFICULTIES, earlierGuess, FEATURES, isLive, isRatedDifficulty, SUGGEST_LIMIT, marksFitScores,
  timeControlText, TIME_CONTROLS, type Difficulty, type GuessResult, type Marks, type TimeControl,
} from '../game';
import { useCheckLimit } from './checkLimit';
import { DIFFICULTY_LABEL, History, InSet, Keyboard, OpponentNote, ScoreHistory, Slots, SuggestButton, YourWord } from './components';
import { GameHeader, GameMenuItems } from './gameHeader';
import { HowToPlay, type Review } from './panels';
import { API_URL } from './config';
import { NO_GUESSES, useOpponentMarks, useShownMarks } from './easyMarks';
import { NO_SUGGESTION, pickSuggestion, suggestedMessage } from './suggestion';
import { useDefinitions } from './definitions';
import { friendApi, FriendApiError, liveSocketUrl, opponentName, type FriendApi, type FriendGame, type RatingLine } from './friendApi';
import { ratingText } from './ratingsApi';
import type { Friend } from './friendsApi';
import { addFriendGame, findFriendGame, updateFriendGame } from './friendGames';
import { FriendResult, InvitePanel, outcomeOf, SecretStep, upper } from './friendParts';
import { ShareResult } from './ShareResult';
import { friendShareText } from './shareText';
import { useNextGame } from './nextGame';
import { useMessage, useNow, usePhysicalKeyboard } from './hooks';
import { useLiveSocket } from './liveSocket';
import {
  clockText, friendErrorMessage, marksCheckMessage, repeatMessage, scoreMessage, secretErrorMessage, shortTimeLeft,
  timeLeftText,
} from './messages';
import type { ApiIdentity } from './apiIdentity';
import { displayName, type Profile } from './profileStorage';
import { addRecentSecret, loadRecentSecrets, saveRecentSecrets } from './recentSecrets';
import { openReport } from './reportIssue';
import { TurnAlertsPrompt } from './TurnAlerts';
import type { Settings } from './settings';
import { shuffleLetters } from './keyboard';
import { PlayOnChoice, PracticeEntry, PracticeLine, usePlayOn } from './playOn';

/**
 * How often to check for your friend's move while the page is open. Moves
 * arrive at once over the game's WebSocket; this is in case it's down.
 */
const POLL_MS = 10_000;
/** Under this much time left on your turn, the countdown turns red. */
const URGENT_MS = 3 * 60 * 60 * 1000;
/** A live game's clock turns red under this. */
const URGENT_CLOCK_MS = 30_000;

/** A challenge's clock choices, short enough for one row on a phone. */
const CLOCK_LABEL: Record<TimeControl, string> = { '15m': '15 min', '10m': '10 min', '5m': '5 min', '1d': '1 day', '3d': '3 days' };

/** "Live: 10 minutes each." or "1 day per guess." */
const timingNote = (control: TimeControl) => `${isLive(control) ? 'Live: ' : ''}${timeControlText(control)}.`;

/**
 * A game against a friend, refereed by the server. Without a `gameId` you
 * choose your word and send an invite; with one you accept an invite or play.
 */
export function FriendScreen({
  settings, profile, identity, challenge = null, onProfile, onExit, gameId, onGameId, onNewInvite, onNewMatch, onOpenGame, review,
}: {
  settings: Settings;
  profile: Profile;
  /** Who the app is to the server: this device, and its session once signed in. */
  identity: ApiIdentity;
  /** A new invite for one friend from your friends list (signed in), rather than a link. */
  challenge?: Friend | null;
  onProfile: OpenProfile;
  onExit: () => void;
  gameId: string | null;
  /** The invite was created: this screen now shows that game. */
  onGameId: (id: string) => void;
  /** Starts a new invite with the same settings. */
  onNewInvite: () => void;
  /** After a matched game: looks for another random opponent. */
  onNewMatch: () => void;
  /** Opens another of your games against a friend. */
  onOpenGame: (id: string) => void;
  /**
   * A past game from the history, shown read-only: the game as the server
   * would describe it once over, with your marks and rating change.
   */
  review?: Review & { game: FriendGame; marks: Marks; rating: RatingLine | null };
}) {
  const api: FriendApi | null = useMemo(() => (API_URL ? friendApi(API_URL, identity) : null), [identity]);
  const saved = useMemo(() => (gameId ? findFriendGame(gameId) : null), [gameId]);
  const [game, setGameState] = useState<FriendGame | null>(review?.game ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraftState] = useState(saved?.draft ?? '');
  const [marks, setMarks] = useState<Marks>(review?.marks ?? saved?.marks ?? {});
  const [message, setMessage] = useMessage();
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<'give-up' | 'cancel' | 'profile' | null>(null);
  const [tab, setTab] = useState<'you' | 'computer'>('you');
  const [seen, setSeen] = useState<number | null>(null);
  const [openYou, setOpenYou] = useState(-1);
  const [openThem, setOpenThem] = useState(-1);
  const [howTo, setHowTo] = useState(false);
  /** A new challenge to a friend: whether it's rated. */
  const [rated, setRated] = useState(false);
  /** A new challenge's difficulty and clock: this game only, starting from your defaults (which they never change). */
  const [challengeDifficulty, setChallengeDifficulty] = useState(settings.difficulty);
  const [challengeClock, setChallengeClock] = useState(settings.timeControl);
  /** Ticking Rated game on Easy moved the challenge to Medium: says so. */
  const [movedToMedium, setMovedToMedium] = useState(false);
  /** Choosing your word for a rematch of this finished game. */
  const [rematching, setRematching] = useState(false);

  // Preact renders asynchronously, so fast typing can outrun it: handlers use these refs.
  const draftRef = useRef(draft);
  const busyRef = useRef(false);
  const setDraft = (d: string) => {
    draftRef.current = d;
    setDraftState(d);
  };
  /**
   * Answers can arrive out of order (a slow refresh after your own guess), so
   * only the answer to the latest request is shown.
   */
  const sequence = useRef(0);
  const applied = useRef(0);
  /** How far the server's clock is ahead of this device's, so a live game's clocks count down truly. */
  const clockOffset = useRef(0);
  const setGame = (next: FriendGame, seq: number) => {
    if (seq < applied.current) return;
    applied.current = seq;
    if (next.serverNow !== null) clockOffset.current = next.serverNow - Date.now();
    setGameState(next);
    setLoadError(null);
  };

  const view = game?.view ?? null;
  const opponent = (game && opponentName(game)) ?? 'your friend';
  const over = game?.state === 'over' || game?.state === 'cancelled' || game?.state === 'expired' || game?.state === 'declined';
  const definitions = useDefinitions(openYou >= 0 || openThem >= 0 || view?.status === 'over');
  const outcome = view ? outcomeOf(view) : null;
  // A loss where you never found their word can be played on, for practice (README "Play on after a loss").
  const lost = outcome === 'lost' || outcome === 'lost-final' || outcome === 'gave-up' || outcome === 'ran-out';
  const playOn = usePlayOn(`friend:${gameId}`, view?.theirSecret ?? null,
    !review && view !== null && canPlayOn(lost, view.yourGuesses), marks);
  const practising = playOn.stage === 'playing';
  const checks = useCheckLimit(`friend:${gameId}`);
  /** Your board: the game's guesses, then any practice ones. */
  const yourGuesses = useMemo(
    (): readonly GuessResult[] => (playOn.guesses.length > 0 ? [...view!.yourGuesses, ...playOn.guesses] : view?.yourGuesses ?? []),
    [view, playOn.guesses],
  );
  const shownMarks = useShownMarks(view?.difficulty ?? settings.difficulty, playOn.practised ? playOn.marks : marks, yourGuesses);
  const theirMarks = useOpponentMarks(view?.theirDifficulty ?? null, view?.theirMarks ?? null, view?.theirGuesses ?? NO_GUESSES);

  const refresh = async () => {
    if (!api || !gameId) return;
    const seq = ++sequence.current;
    try {
      setGame(await api.get(gameId), seq);
    } catch (e) {
      if (seq >= applied.current) setLoadError(friendErrorMessage(e instanceof FriendApiError ? e.code : 'unreachable'));
    }
  };

  // Load the game, then check for your friend's moves while the page is open.
  useEffect(() => {
    if (review) return;
    setGameState(null);
    void refresh();
  }, [gameId, api]);
  const watching = gameId !== null && !over;
  const live = game !== null && isLive(game.timeControl);
  // Each move arrives at once over the game's WebSocket; once it's over, a rematch your opponent asks for does.
  const listening = gameId !== null && !review && (watching || (game?.state === 'over' && !game.rematch));
  useLiveSocket(listening && API_URL ? liveSocketUrl(API_URL, gameId) : null, () => void refresh());
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [watching, gameId, api]);

  // A turn notification arrived while the app is open: look at once.
  useEffect(() => {
    if (!watching || !('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: unknown } | null)?.type === 'game-changed') void refresh();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [watching, gameId, api]);

  // Your marks and half-typed guess survive a reload; a finished game leaves the title screen once seen.
  // Only a game under way keeps a draft: before that it's your secret word's letters (finding 14).
  const playingNow = game?.state === 'playing';
  useEffect(() => {
    if (gameId && game?.seat) updateFriendGame(gameId, { marks, draft: playingNow ? draft : '', done: over });
    // A challenge to you that's closed (declined, expired, cancelled) leaves the title screen too.
    else if (gameId && game && over) updateFriendGame(gameId, { done: true });
  }, [gameId, game?.seat, marks, draft, over, playingNow]);

  // The countdown (a live game's clocks tick every second), and a fresh look at the game once the time runs out.
  const now = useNow(live && watching ? 250 : 30_000) + clockOffset.current;
  const deadline = view?.deadline ?? null;
  const timeUp = deadline !== null && now >= deadline;
  useEffect(() => {
    if (timeUp) void refresh();
  }, [timeUp]);

  // A rematch that was declined or expired gives way to a new one, so Rematch shows again (not one its sender cancelled).
  // Until the check answers, a greyed Rematch holds the place; while it's an open invite, its room's socket says when
  // that changes (#119). Only the latest check's answer counts, so a late one can't show the wrong button.
  const rematchId = game?.rematch?.id ?? null;
  const [rematchCheck, setRematchCheck] = useState<{ id: string; state: FriendGame['state'] | null } | null>(null);
  const rematchChecks = useRef(0);
  const checkRematch = () => {
    if (!api || !rematchId) return;
    const id = rematchId;
    const check = ++rematchChecks.current;
    const answer = (state: FriendGame['state'] | null) => {
      if (check === rematchChecks.current) setRematchCheck((c) => (state === null && c?.id === id ? c : { id, state }));
    };
    // A check that fails keeps the last answer (so it keeps listening), or leaves it open as before #119.
    api.get(id).then((r) => answer(r.state), () => answer(null));
  };
  useEffect(checkRematch, [api, rematchId]);
  const rematchChecked = rematchCheck !== null && rematchCheck.id === rematchId;
  const rematchState = rematchChecked ? rematchCheck.state : null;
  const rematchClosed = rematchState === 'declined' || rematchState === 'expired';
  useLiveSocket(rematchId && rematchState === 'waiting' && !review && API_URL ? liveSocketUrl(API_URL, rematchId) : null,
    checkRematch);

  // Another game waiting on your guess, checked again once this one isn't.
  const next = useNextGame(api, gameId, `${game?.state}:${view?.turn}`);
  const nextLabel = next && `Your turn vs. ${opponentName(next) ?? 'a friend'} →`;

  const theirCount = view?.theirGuesses.length ?? 0;
  useEffect(() => {
    if (seen === null && view) setSeen(theirCount);
    else if (tab === 'computer') setSeen(theirCount);
  }, [tab, theirCount, view !== null]);

  const reject = (text: string) => {
    setMessage({ text, error: true });
    setShake(true);
  };

  /** Sends one request, showing the answer or the reason it was refused. */
  const send = async (
    request: () => Promise<FriendGame>, word: string, secret = false, show = true,
  ): Promise<FriendGame | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    const seq = ++sequence.current;
    try {
      const next = await request();
      if (show) setGame(next, seq);
      return next;
    } catch (e) {
      const code = e instanceof FriendApiError ? e.code : 'unreachable';
      reject(secret && code === 'not-in-word-list' ? secretErrorMessage(code, word) : friendErrorMessage(code, word));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // Letters go to your secret word while you choose it, then to your guesses once the game is
  // under way, never in between (waiting for your friend to join).
  const choosingSecret = !gameId || rematching || (game !== null && !game.seat && game.state === 'waiting');
  const typing = () => !confirming && (rematching || practising || (!over && (choosingSecret || game?.state === 'playing')));
  const typeLetter = (letter: string) => {
    if (typing() && draftRef.current.length < 5) setDraft(draftRef.current + letter);
  };
  const backspace = () => {
    if (typing()) setDraft(draftRef.current.slice(0, -1));
  };

  // A rated game refuses Easy: accepting one plays at Medium (a challenge moves itself to Medium when rated).
  const canRate = isRatedDifficulty(settings.difficulty);
  const joinDifficulty = game?.rated && !canRate ? 'medium' : settings.difficulty;

  const rememberSecret = (word: string) => saveRecentSecrets(addRecentSecret(loadRecentSecrets(), word));

  const createInvite = async () => {
    if (!api) return;
    const word = draftRef.current;
    const created = await send(() => api.create({
      name: displayName(profile), secret: word,
      ...(challenge
        ? { difficulty: challengeDifficulty, timeControl: challengeClock, friend: challenge.code, ...(rated ? { rated } : {}) }
        : { difficulty: settings.difficulty, timeControl: settings.timeControl }),
    }), word, true);
    if (!created) return;
    addFriendGame(created.id, Date.now());
    rememberSecret(word);
    setDraft('');
    onGameId(created.id);
  };

  const acceptInvite = async () => {
    if (!api || !gameId) return;
    const word = draftRef.current;
    const joined = await send(() => api.join(gameId, { name: displayName(profile), secret: word, difficulty: joinDifficulty }), word, true);
    if (!joined) return;
    addFriendGame(gameId, Date.now());
    rememberSecret(word);
    setDraft('');
    setMessage({
      text: joined.view?.first === 'you' ? 'Coin toss: you go first.' : `Coin toss: ${opponentName(joined)} goes first.`,
      error: false,
    });
  };

  /** Sends a rematch of this finished game with your word, then opens it (or theirs, if they asked first). */
  const sendRematch = async () => {
    if (!api || !gameId) return;
    const word = draftRef.current;
    // Another game: it's opened on its own screen, never shown under this game's ID.
    const sent = await send(() => api.rematch(gameId, { name: displayName(profile), secret: word }), word, true, false);
    if (!sent) return;
    addFriendGame(sent.id, Date.now());
    rememberSecret(word);
    setDraft('');
    setRematching(false);
    onOpenGame(sent.id);
  };

  /** Turns down a challenge or rematch sent to you. */
  const decline = async () => {
    if (api && gameId) await send(() => api.decline(gameId), '');
  };

  const guess = async () => {
    if (!api || !gameId || !view) return;
    if (view.turn !== 'you') {
      reject(`Wait for ${opponent}'s guess.`);
      return;
    }
    const word = draftRef.current;
    const repeat = earlierGuess(view.yourGuesses, word);
    if (repeat) {
      reject(repeatMessage(word, repeat, view.difficulty));
      return;
    }
    // At Medium, your marks go with the guess for your opponent to see, unless you've turned that off.
    const shared = view.difficulty === 'medium' && settings.shareMarks ? marks : undefined;
    const next = await send(() => api.guess(gameId, word, shared), word);
    if (!next?.view) return;
    setDraft('');
    const latest = next.view.yourGuesses[next.view.yourGuesses.length - 1];
    setMessage(latest.isWin ? null : { text: scoreMessage(latest), error: false, quiet: true });
  };

  /** Easy's Suggest: fills the input with a word that fits your scores, once the server has recorded it. */
  const suggest = async () => {
    if (!api || !gameId || !view || !typing()) return;
    const word = pickSuggestion(view.yourGuesses);
    if (!word) {
      setMessage({ text: NO_SUGGESTION, error: true });
      return;
    }
    if (!await send(() => api.suggest(gameId, word), word)) return;
    setDraft(word);
    setMessage({ text: suggestedMessage(word), error: false });
  };

  const enter = () => {
    if (!typing()) return;
    if (!gameId) void createInvite();
    else if (rematching) void sendRematch();
    else if (game && !game.seat && game.state === 'waiting') void acceptInvite();
    else if (view && practising) practiceGuess();
    else if (view) void guess();
  };

  /** After a loss: a practice guess at their word, checked here and kept on this device. */
  const practiceGuess = () => {
    if (!view) return;
    const said = playOn.guess(draftRef.current, view.yourGuesses, view.difficulty);
    if (said?.error) {
      reject(said.text);
      return;
    }
    setDraft('');
    setMessage(said);
  };

  /** Ends practice: their word is shown. */
  const showWord = () => {
    playOn.reveal();
    setDraft('');
    setMessage(null);
  };

  usePhysicalKeyboard({ onLetter: typeLetter, onEnter: enter, onBackspace: backspace });

  const changeDifficulty = (d: Difficulty) => {
    if (api && gameId) void send(() => api.setDifficulty(gameId, d), '');
  };

  const startRematch = () => {
    setDraft('');
    setMessage(null);
    setRematching(true);
  };

  const confirmGiveUp = async () => {
    setConfirming(null);
    if (api && gameId) await send(() => api.concede(gameId), '');
  };

  const keyboard = <Keyboard ready={draft.length === 5} onLetter={typeLetter} onEnter={enter} onBackspace={backspace} />;

  if (!api && !review) {
    return (
      <div class="app">
        <section class="panel">
          <h2>Games against a friend need the game server.</h2>
          <p>This version of the app isn't connected to one.</p>
          <div class="row-btns"><button class="btn primary" type="button" onClick={onExit}>Main menu</button></div>
        </section>
      </div>
    );
  }

  if (!gameId && !review) {
    return (
      <SecretStep title={challenge ? `Challenge ${challenge.name}` : 'Choose your secret word'} draft={draft} shake={shake}
        onShakeEnd={() => setShake(false)}
        note={challenge ? `Choose your secret word; ${challenge.name} will try to guess it. 5 letters, no repeated letters.`
          : `Your friend will try to guess it. 5 letters, no repeated letters. ${timingNote(settings.timeControl)}`}
        message={message} busy={busy} onDraft={setDraft} onBack={onExit} keyboard={keyboard}
        extra={challenge && (
          <div class="lobby-settings challenge-settings">
            <span class="menu-label" id="challenge-diff">Your difficulty</span>
            <div class="seg" role="group" aria-labelledby="challenge-diff">
              {DIFFICULTIES.map((d) => (
                // A rated game can't be Easy.
                <button type="button" key={d} aria-pressed={challengeDifficulty === d} disabled={rated && !isRatedDifficulty(d)}
                  onClick={() => {
                    setChallengeDifficulty(d);
                    setMovedToMedium(false);
                  }}>{DIFFICULTY_LABEL[d]}</button>
              ))}
            </div>
            <span class="menu-label" id="challenge-clock">Clock</span>
            <div class="seg" role="group" aria-labelledby="challenge-clock">
              {TIME_CONTROLS.map((c) => (
                <button type="button" key={c} aria-pressed={challengeClock === c} onClick={() => setChallengeClock(c)}>
                  {CLOCK_LABEL[c]}
                </button>
              ))}
            </div>
            <span class="field-note">{isLive(challengeClock)
              ? 'Live: each of you has a chess clock that runs only on your turn.'
              : 'Take turns over days: miss your time and you concede.'} These settings are for this game only.</span>
            <label class="toggle rated-toggle">
              <input id="rated-challenge" type="checkbox" checked={rated}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setRated(on);
                  const moved = on && !isRatedDifficulty(challengeDifficulty);
                  if (moved) setChallengeDifficulty('medium');
                  setMovedToMedium(moved);
                }} />
              <span>
                <b>Rated game</b>
                <span class="field-note">
                  Both your ratings change with the result, and neither of you can change difficulty during the game.
                  {movedToMedium && " A rated game can't be played at Easy, so this one is at Medium."}
                </span>
              </span>
            </label>
          </div>
        )} />
    );
  }

  if (!game) {
    return (
      <div class="app">
        <section class="panel">
          {loadError ? (
            <>
              <h2>Couldn't open this game.</h2>
              <p>{loadError}</p>
              <div class="row-btns">
                <button class="btn primary" type="button" onClick={() => void refresh()}>Try again</button>
                <button class="btn" type="button" onClick={onExit}>Main menu</button>
              </div>
            </>
          ) : <p class="thinking">Loading the game…</p>}
        </section>
      </div>
    );
  }

  // Someone who isn't in the game: an invite to accept, or one that's no longer open.
  if (!game.seat) {
    if (game.state === 'waiting') {
      const rematchOf = game.rematchOf !== null;
      return (
        <SecretStep title={rematchOf ? `${game.hostName} wants a rematch${game.rated ? ' (rated)' : ''}`
          : `${game.hostName} challenges you${game.rated ? ' to a rated game' : ''}`} draft={draft} shake={shake}
          onShakeEnd={() => setShake(false)}
          note={`Choose your secret word; ${game.hostName} will try to guess it. 5 letters, no repeated letters. `
            + timingNote(game.timeControl)
            + (isLive(game.timeControl) ? ' The clocks start as soon as you accept.' : '')
            + (game.inviteeDifficulty ? ` You play at ${DIFFICULTY_LABEL[game.inviteeDifficulty]}, as you ended the last game.` : '')
            + (game.rated ? " It's rated: your difficulty is fixed once you accept"
              + (canRate || game.inviteeDifficulty ? '.' : ", and you'll play at Medium, since a rated game can't be Easy.") : '')}
          message={message} busy={busy} onDraft={setDraft} onBack={onExit} keyboard={keyboard}
          extra={game.invitedYou && (
            <div class="row-btns">
              <button class="btn" type="button" disabled={busy} onClick={() => void decline()}>
                Decline {rematchOf ? 'rematch' : 'challenge'}
              </button>
            </div>
          )} />
      );
    }
    return (
      <div class="app">
        <section class="panel">
          <h2>{{
            cancelled: 'This invite was cancelled.',
            expired: 'This invite expired.',
            declined: `This ${game.rematchOf ? 'rematch' : 'challenge'} was declined.`,
          }[game.state as string] ?? 'Someone else has already accepted this invite.'}</h2>
          {game.state !== 'declined' && <p>Ask {game.hostName} to send you a new one.</p>}
          <div class="row-btns"><button class="btn primary" type="button" onClick={onExit}>Main menu</button></div>
        </section>
      </div>
    );
  }

  // In a live game your clock keeps running, so the profile asks first.
  const openProfile = () => (review ? review.onBack()
    : live && view && !over && view.turn === 'you' ? setConfirming('profile') : onProfile());

  // In ☰ and on the header's difficulty bubble.
  const difficultyChoice = view && !over && !game.rated
    ? { onDifficulty: changeDifficulty, guessed: view.yourGuesses.length > 0 } : undefined;
  const menu = (close: () => void) => (
    <GameMenuItems close={close} onNewGame={game.matched ? onNewMatch : onNewInvite}
      newGameLabel={game.matched ? 'New game' : 'New invite'}
      difficulty={view?.difficulty ?? settings.difficulty} {...difficultyChoice}
      difficultyNote={`${game.rated ? "It's fixed in a rated game. " : ''}Your ${game.matched ? 'opponent' : 'friend'} sees it, and at Medium your marks${
        settings.shareMarks ? ' too' : " up to your last guess (you've stopped sharing them from your next guess)"}. It never changes who wins.`}
      giveUpLabel={game.state === 'waiting' ? 'Cancel invite' : practising ? 'Show their word' : 'Give up'} canGiveUp={!over || practising}
      onGiveUp={practising ? showWord : () => setConfirming(game.state === 'waiting' ? 'cancel' : 'give-up')} onExit={onExit}
      onHowToPlay={() => setHowTo(true)}
      // The view, never the game's ID: on a public issue, an open invite's ID would let anyone take it.
      onReport={() => openReport({
        screen: `Two player vs. a friend (${game.state}) · ${DIFFICULTY_LABEL[view?.difficulty ?? settings.difficulty]}`,
        record: view ?? undefined,
      })}
      checksLeft={practising ? undefined : checks.left}
      onCheckMarks={view?.difficulty === 'medium' && !over
        ? () => checks.use() && setMessage(marksCheckMessage(marksFitScores(marks, view.yourGuesses)))
        : view?.difficulty === 'medium' && practising ? () => setMessage(marksCheckMessage(marksFitScores(playOn.marks, yourGuesses))) : undefined}
      onClearMarks={view?.difficulty === 'medium' && !over ? () => setMarks({})
        : view?.difficulty === 'medium' && practising ? () => playOn.setMarks({}) : undefined} />
  );

  if (!view) {
    const kind = game.rematchOf ? 'rematch' : game.inviteeName ? 'challenge' : 'invite';
    return (
      <div class="app">
        <GameHeader profile={profile} onHome={onExit} onProfile={openProfile} opponent={game.guestName ?? game.inviteeName ?? 'a friend'}
          difficulty={settings.difficulty} menu={menu} />
        {game.state === 'cancelled' || game.state === 'expired' || game.state === 'declined' ? (
          <section class="panel">
            <h2>{{
              cancelled: `You cancelled this ${kind}.`,
              expired: `Your ${kind} expired.`,
              declined: `${game.inviteeName ?? 'Your friend'} declined your ${kind}.`,
            }[game.state]}</h2>
            {game.state === 'expired' && (
              <p>{game.inviteeName ? `${game.inviteeName} didn't accept it` : 'Nobody accepted it'} within {live ? 'an hour' : '24 hours'}.</p>
            )}
            <div class="row-btns">
              {game.rematchOf && game.state !== 'cancelled'
                // From the last game's result, Rematch sends a new one; a cancelled rematch can't be replaced.
                ? <button class="btn primary" type="button" onClick={() => onOpenGame(game.rematchOf!)}>Back to your last game</button>
                : <button class="btn primary" type="button" onClick={onNewInvite}>New invite</button>}
              <button class="btn" type="button" onClick={onExit}>Main menu</button>
            </div>
          </section>
        ) : confirming === 'cancel' ? (
          <section class="panel">
            <h2>{game.inviteeName ? 'Cancel this challenge?' : 'Cancel this invite?'}</h2>
            <p>{game.inviteeName ? `${game.inviteeName} won't be able to accept it.` : 'The link will stop working.'}</p>
            <div class="row-btns">
              <button class="btn primary" type="button" onClick={() => void confirmGiveUp()}>Cancel invite</button>
              <button class="btn" type="button" onClick={() => setConfirming(null)}>Keep it</button>
            </div>
          </section>
        ) : (
          <>
            <InvitePanel game={game} onCancel={() => setConfirming('cancel')} />
            {next && (
              <button type="button" class="next-game" onClick={() => onOpenGame(next.id)}>{nextLabel}</button>
            )}
            <TurnAlertsPrompt apiUrl={API_URL!} identity={identity} />
          </>
        )}
        {howTo && <HowToPlay onClose={() => setHowTo(false)} />}
      </div>
    );
  }

  if (rematching) {
    return (
      <SecretStep title={`Rematch ${opponent}`} draft={draft} shake={shake} onShakeEnd={() => setShake(false)}
        note={`Choose your secret word; ${opponent} will try to guess it. 5 letters, no repeated letters. `
          + `${timingNote(game.timeControl)}${game.rated ? ' Rated, like the last game.' : ''} `
          + `Only ${opponent} can accept it, and who goes first is random.`}
        message={message} busy={busy} onDraft={setDraft} onBack={() => {
          setRematching(false);
          setDraft('');
          setMessage(null);
        }} backLabel="Back to the game" keyboard={keyboard} />
    );
  }

  const difficulty = view.difficulty;
  const medium = difficulty === 'medium';
  // Easy and Medium: the Shuffle key reorders the typed letters, whenever the letter keys would type.
  const shuffle = difficulty === 'easy' || medium
    ? () => {
      if (typing()) setDraft(shuffleLetters(draftRef.current));
    }
    : undefined;
  const finalGuess = view.status === 'final-guess';
  const yourLastChance = finalGuess && view.turn === 'you';
  // You found their word first: they have one final guess, and you've nothing to type.
  const waitingFinal = finalGuess && !yourLastChance;
  const theyFoundYours = view.theirGuesses.some((g) => g.isWin);
  const lastTheirs = view.theirGuesses[view.theirGuesses.length - 1];
  const unseen = seen !== null && view.theirGuesses.length > seen;
  const newestFirst = settings.newestFirst[difficulty];
  const appClass = ['app', 'two', yourLastChance && !confirming ? 'last-chance' : ''].filter(Boolean).join(' ');
  // A live game's clocks: the player to move's runs down to the deadline.
  const clocks = view.clocks && deadline !== null && {
    you: view.turn === 'you' ? deadline - now : view.clocks.you,
    opponent: view.turn === 'opponent' ? deadline - now : view.clocks.opponent,
  };

  return (
    <div class={appClass}>
      <GameHeader profile={profile} onHome={onExit} onProfile={openProfile} difficulty={difficulty} menu={menu}
        difficultyChoice={difficultyChoice}
        review={review} suggested={view.suggested}
        opponent={opponent} opponentCode={review ? null : game.opponentCode}
        opponentRating={game.ratings ? ratingText(game.ratings.opponent) : undefined}>
        {/* Row 3 follows the tab: your in-letters on yours, your word on your friend's. */}
        <div class="row3" data-tab={tab}>
          {shownMarks && (!over || practising) && <div class="for-you"><InSet marks={shownMarks} /></div>}
          <div class="for-computer">
            <YourWord word={view.yourSecret} found={theyFoundYours} finder={opponent} known={theirMarks} />
          </div>
        </div>
      </GameHeader>

      {!over && <TurnAlertsPrompt apiUrl={API_URL!} identity={identity} />}

      <div class="tabs" role="tablist" aria-label="Guesses">
        <button type="button" role="tab" aria-selected={tab === 'you'} onClick={() => setTab('you')}>
          You ({view.yourGuesses.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'computer'} onClick={() => setTab('computer')}>
          <span class="tab-name">{opponent}</span> ({view.theirGuesses.length})
          {unseen && tab !== 'computer' && <span class="dot" aria-label="new guess" />}
        </button>
      </div>

      {/* The opponent's board reuses the computer's layout (class and tab name). */}
      <div class="boards" data-tab={tab}>
        <section class="board you" aria-label="Your guesses">
          <h2 class="board-title">Your guesses</h2>
          {medium && !over && !review && settings.shareMarks && (
            <p class="board-note opponent-note">{opponent} sees your marks with each guess you send.</p>
          )}
          {difficulty === 'extreme' && (!over || practising) ? (
            <ScoreHistory guesses={yourGuesses} newestFirst={newestFirst} />
          ) : (
            <History guesses={yourGuesses} newestFirst={newestFirst} openDef={openYou}
              marks={shownMarks} practiceFrom={playOn.guesses.length > 0 ? view.yourGuesses.length : undefined}
              onMark={medium && !over ? (letter) => setMarks(cycleMark(marks, letter))
                : medium && practising ? (letter) => playOn.setMarks(cycleMark(playOn.marks, letter)) : undefined}
              onToggleDef={(i) => setOpenYou(openYou === i ? -1 : i)} definitions={definitions} />
          )}
        </section>
        <section class="board computer" aria-label={`${opponent}'s guesses`}>
          <h2 class="board-title">{opponent}'s guesses</h2>
          {view.theirDifficulty && (
            <OpponentNote name={opponent} difficulty={view.theirDifficulty}
              sharing={view.theirGuesses.length === 0 || view.theirMarks !== null} />
          )}
          <History guesses={view.theirGuesses} newestFirst={newestFirst} openDef={openThem}
            label={`${opponent}'s guesses`} emptyText={`${opponent} hasn't guessed yet.`} marks={theirMarks}
            onToggleDef={(i) => setOpenThem(openThem === i ? -1 : i)} definitions={definitions} />
        </section>
      </div>

      {!over && !confirming && (
        <>
          {clocks && (
            <div class="clocks" role="timer" aria-label={`Your clock ${clockText(clocks.you)}, ${opponent}'s ${clockText(clocks.opponent)}`}>
              <span class={['clock', view.turn === 'you' ? 'running' : '', clocks.you < URGENT_CLOCK_MS ? 'urgent' : ''].join(' ')}>
                <span class="clock-name">You</span> {clockText(clocks.you)}
              </span>
              <span class={['clock', view.turn === 'opponent' ? 'running' : '', clocks.opponent < URGENT_CLOCK_MS ? 'urgent' : ''].join(' ')}>
                <span class="clock-name">{opponent}</span> {clockText(clocks.opponent)}
              </span>
            </div>
          )}
          {yourLastChance ? (
            <section class="banner danger" role="alert">
              <strong>Last chance</strong>
              <span>{opponent} found {upper(view.yourSecret)}. One guess to tie the game.</span>
            </section>
          ) : finalGuess && view.theirSecret ? (
            <section class="banner hope" role="status">
              <strong>You found {upper(view.theirSecret)}!</strong>
              <span class="thinking">Waiting for {opponent}'s final guess…</span>
            </section>
          ) : (
            // One line on any phone: only the opponent's name is cut short (…) if it's long.
            <div class="status-row compact">
              {lastTheirs && tab === 'you' && (
                <span class="last-move" aria-label={`${opponent} guessed ${lastTheirs.guess} – ${lastTheirs.score}`}>
                  <span class="who">{opponent}</span>
                  <span>:&nbsp;<b>{upper(lastTheirs.guess)}</b>&nbsp;–&nbsp;{lastTheirs.score}</span>
                </span>
              )}
              <span class={view.turn === 'you' ? 'turn yours' : 'turn thinking'} role="status">
                {view.turn === 'you' ? 'Your turn' : 'Their turn'}
                {deadline !== null && !clocks && (
                  <span class={view.turn === 'you' && deadline - now < URGENT_MS ? 'time-left urgent' : 'time-left'}
                    aria-label={timeLeftText(deadline - now)}>
                    {shortTimeLeft(deadline - now)}
                  </span>
                )}
              </span>
            </div>
          )}
          {waitingFinal ? (
            // Nothing to type until their final guess is in (issue #154): just the way to your next game.
            next && (
              <div class="message">
                <button type="button" class="next-game" onClick={() => onOpenGame(next.id)}>{nextLabel}</button>
              </div>
            )
          ) : (<>
            <section class="entry">
              <Slots draft={draft} shake={shake} onShakeEnd={() => setShake(false)} class={yourLastChance ? 'final' : ''} />
              <div class={message?.error ? 'message error' : 'message'} role="status">
                {busy ? 'Sending…' : message && !message.quiet ? message.text : (
                  <>
                    {message && <span class="visually-hidden">{message.text}</span>}
                    {view.turn === 'opponent' && next && (
                      // While you wait, a way to your next game, in the status line's own space.
                      <button type="button" class="next-game" onClick={() => onOpenGame(next.id)}>{nextLabel}</button>
                    )}
                  </>
                )}
              </div>
              {FEATURES.suggest && difficulty === 'easy' && !review && (
                <SuggestButton left={SUGGEST_LIMIT - view.suggested} onSuggest={() => void suggest()} disabled={busy} />
              )}
            </section>
            <Keyboard marks={shownMarks} ready={draft.length === 5 && view.turn === 'you'} onShuffle={shuffle} onLetter={typeLetter} onEnter={enter}
              onBackspace={backspace} enterLabel={yourLastChance ? 'Final guess' : 'Enter'} />
          </>)}
        </>
      )}

      {confirming === 'profile' && !over && (
        <section class="panel">
          <h2>Your clock keeps running.</h2>
          <p>It's your turn in a live game, so your time runs down while you look at your profile.</p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={() => setConfirming(null)}>Keep playing</button>
            <button class="btn" type="button" onClick={() => {
              setConfirming(null);
              onProfile();
            }}>Open profile</button>
          </div>
        </section>
      )}

      {practising && !confirming && (
        <PracticeEntry draft={draft} shake={shake} onShakeEnd={() => setShake(false)} message={message} marks={shownMarks}
          onShuffle={shuffle} onLetter={typeLetter} onEnter={enter} onBackspace={backspace} onShow={showWord} />
      )}

      {confirming === 'give-up' && !over && (
        <section class="panel">
          <h2>Give up? {opponent} wins.</h2>
          <p>Then you can see their word, or keep guessing it for practice.</p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={() => void confirmGiveUp()}>Give up</button>
            <button class="btn" type="button" onClick={() => setConfirming(null)}>Keep playing</button>
          </div>
        </section>
      )}

      {over && outcome && view.theirSecret && !practising && (
        <FriendResult view={{ ...view, theirSecret: view.theirSecret }} outcome={outcome} opponent={opponent} live={live}
          definitions={definitions} rating={review ? review.rating : game.ratings?.you}
          choice={playOn.stage === 'choose' && (
            <PlayOnChoice whose={`${opponent}'s word`} onKeepGuessing={() => {
              playOn.start();
              setTab('you');
              setMessage(null);
            }} onShow={playOn.reveal} />
          )}
          practice={<PracticeLine stage={playOn.stage} practice={playOn.guesses.length} game={view.yourGuesses.length} />}
          found={playOn.stage === 'found'}>
          {next && <button class="btn primary" type="button" onClick={() => onOpenGame(next.id)}>{nextLabel}</button>}
          {game.matched
            ? <button class={next ? 'btn' : 'btn primary'} type="button" onClick={onNewMatch}>Find another opponent</button>
            : review ? <button class="btn" type="button" onClick={onNewInvite}>New invite</button> : (
              // One open rematch per game: ask for it, see the one you sent, or answer theirs.
              !game.rematch || rematchClosed ? <button class={next ? 'btn' : 'btn primary'} type="button" onClick={startRematch}>Rematch</button>
                : !rematchChecked ? <button class="btn" type="button" disabled>Rematch</button>
                : game.rematch.byYou
                  ? <button class="btn" type="button" onClick={() => onOpenGame(game.rematch!.id)}>Rematch sent →</button>
                  : <button class="btn primary rematch-offer" type="button" onClick={() => onOpenGame(game.rematch!.id)}>
                    {opponent} wants a rematch →
                  </button>
            )}
          {(outcome === 'won' || outcome === 'won-held' || outcome === 'clutch' || outcome === 'tied') && !review && (
            <ShareResult text={friendShareText({
              opponent, difficulty, guesses: view.yourGuesses.length,
              result: outcome === 'won-held' ? 'won' : outcome,
            })} />
          )}
          <button class="btn" type="button" onClick={onExit}>Main menu</button>
        </FriendResult>
      )}
      {howTo && <HowToPlay onClose={() => setHowTo(false)} />}
    </div>
  );
}
