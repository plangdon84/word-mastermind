import type { OpenProfile } from './profilePages';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  cycleMark, DIFFICULTIES, DIFFICULTY_FACTOR, isRatedDifficulty, ratedDifficultyFor, earlierGuess, LOBBY_MINUTES,
  LOBBY_SEATS, lobbyRankBy, marksFitScores, ordinal, PENALTY_GUESSES, PENALTY_SECONDS, rankByName, STRENGTHS, validateGuess,
  type Difficulty, type LobbyKind,
  type LobbySettings, type Marks,
} from '../game';
import { useCheckLimit } from './checkLimit';
import type { ApiIdentity } from './apiIdentity';
import { DIFFICULTY_LABEL, InSet, STRENGTH_LABEL } from './components';
import { GameHeader, GameMenuItems } from './gameHeader';
import { ConfirmDialog, HowToPlay } from './panels';
import { API_URL } from './config';
import { NO_GUESSES, useShownMarks } from './easyMarks';
import { NO_SUGGESTION, pickSuggestion, suggestedMessage } from './suggestion';
import { useDefinitions } from './definitions';
import { RatingChange } from './friendParts';
import { useMessage, useNow, usePhysicalKeyboard } from './hooks';
import { InviteFriends, JoinCode, lobbyName, rankByLine, rankedText, scoreText, Seats, Standings, WordStep } from './lobbyParts';
import { lobbyApi, LobbyApiError, type LobbyAnswer, type LobbyErrorCode } from './lobbyApi';
import { loadLobby, saveLobby } from './lobbyStorage';
import {
  durationText, errorMessage, guessCount, lobbyErrorMessage, marksCheckMessage, repeatMessage, scoreMessage,
} from './messages';
import { displayName, type Profile } from './profileStorage';
import { openReport } from './reportIssue';
import { formatClock, RankBySwitch, RushBar, RushBoard, RushDots, RushSummary, RushWords, spentSeconds } from './rushParts';
import type { Settings } from './settings';
import { TurnAlertsPrompt } from './TurnAlerts';
import { ShareResult } from './ShareResult';
import { lobbyShareText } from './shareText';
import { shuffleLetters } from './keyboard';

const ALERTS_OFFER = 'Get a notification when a player finishes and when the game is over, even with the game closed.';

/** How often the lobby checks for others' moves: often while waiting to start, less while you play. */
const WAITING_POLL_MS = 3000;
const PLAYING_POLL_MS = 5000;


const codeOf = (e: unknown): LobbyErrorCode => (e instanceof LobbyApiError ? e.code : 'unreachable');

/**
 * Rush with Friends: up to 5 players solve the same 4 words, refereed by the
 * server, on one clock that never pauses. Competitive Rush: the same, but
 * each player sets a word and solves the others', and it's rated. With no
 * `code`, it opens a new lobby of `kind` with you as host.
 */
export function LobbyScreen({ settings, profile, identity, signedIn, onProfile, onExit, code, kind: newKind, onCode }: {
  settings: Settings;
  profile: Profile;
  identity: ApiIdentity;
  /** Competitive Rush is rated, so it needs an account. */
  signedIn: boolean;
  onProfile: OpenProfile;
  onExit: () => void;
  code: string | null;
  /** The kind of lobby to open, with no `code`. */
  kind: LobbyKind;
  /** The lobby this screen shows, once a new one is open, so a reload comes back to it. */
  onCode: (code: string) => void;
}) {
  const api = useMemo(() => lobbyApi(API_URL ?? '', identity), [identity]);
  const [answer, setAnswerState] = useState<LobbyAnswer | null>(null);
  const answerRef = useRef<LobbyAnswer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The server's clock minus this device's, so the countdown follows the server. */
  const [offset, setOffset] = useState(0);
  const [marks, setMarks] = useState<readonly Marks[]>([]);
  const [draft, setDraftState] = useState('');
  const draftRef = useRef('');
  const busy = useRef(false);
  const [message, setMessage] = useMessage();
  const [shake, setShake] = useState(false);
  const [confirming, setConfirming] = useState<'move-on' | 'give-up' | 'close' | null>(null);
  const [showPlayers, setShowPlayers] = useState(false);
  const [openDef, setOpenDef] = useState(-1);
  const [howTo, setHowTo] = useState(false);
  /** Choosing your Competitive Rush word: to open the lobby, join it, or change it. */
  const [wordStep, setWordStep] = useState<'create' | 'join' | 'change' | null>(
    code === null && newKind === 'competitive' ? 'create' : null);
  const now = useNow(1000) + offset;

  const lobby = answer?.lobby ?? null;
  const kind: LobbyKind = lobby?.kind ?? newKind;
  // A new lobby opens ranked as you last picked; then the host's setting.
  const rankBy = lobby ? lobbyRankBy(lobby.settings) : settings.rankBy;
  const rush = rankByName(rankBy);
  const modeName = lobbyName(kind, rankBy);
  const run = lobby?.run ?? null;
  const playing = lobby?.state === 'playing' && run?.status === 'playing';
  const difficulty: Difficulty = lobby?.settings.difficulty
    ?? (kind === 'competitive' ? ratedDifficultyFor(settings.difficulty) : settings.difficulty);
  const medium = difficulty === 'medium';
  // Easy and Medium: the Shuffle key reorders the typed letters, whenever the letter keys would type.
  const shuffle = difficulty === 'easy' || medium
    ? () => {
      if (canType()) setDraft(shuffleLetters(draftRef.current));
    }
    : undefined;
  const word = run && playing ? run.words[run.current] : null;
  const wordMarks = (run && marks[run.current]) ?? {};
  const checks = useCheckLimit(`lobby:${lobby?.code}:${run?.current}`);
  const shownMarks = useShownMarks(difficulty, wordMarks, word?.guesses ?? NO_GUESSES);
  const definitions = useDefinitions(openDef >= 0 || (run !== null && !playing));

  const setAnswer = (a: LobbyAnswer) => {
    answerRef.current = a;
    setAnswerState(a);
    setOffset(a.now - Date.now());
  };
  const setDraft = (d: string) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const fail = (e: unknown, guess = '') => setMessage({ text: lobbyErrorMessage(codeOf(e), guess), error: true });

  const opened = (a: LobbyAnswer) => {
    const saved = loadLobby();
    setMarks(saved?.code === a.lobby.code ? saved.marks : []);
    setAnswer(a);
    if (code === null) onCode(a.lobby.code);
  };
  const load = () => {
    setLoadError(null);
    // A new Competitive Rush lobby opens once you've chosen your word.
    if (code === null && newKind === 'competitive') return;
    const opening = code === null ? api.create(displayName(profile), settings.difficulty, undefined, settings.rankBy) : api.get(code);
    opening.then(opened, (e: unknown) => setLoadError(lobbyErrorMessage(codeOf(e))));
  };
  useEffect(load, []);

  // The host started (or closed) the lobby while you were changing your word: back to it.
  useEffect(() => {
    if (wordStep && wordStep !== 'create' && lobby && lobby.state !== 'open') setWordStep(null);
  }, [wordStep, lobby?.state]);

  /** Sends your Competitive Rush word, answering why it was refused, or null. */
  const sendWord = async (word: string): Promise<string | null> => {
    try {
      const current = answerRef.current?.lobby;
      const name = displayName(profile);
      // Competitive Rush is rated, so an Easy default opens it at Medium.
      if (wordStep === 'create') opened(await api.create(name, ratedDifficultyFor(settings.difficulty), word, settings.rankBy));
      else if (current && wordStep === 'join') setAnswer(await api.join(current.code, name, word));
      else if (current) setAnswer(await api.setWord(current.code, word));
      setWordStep(null);
      return null;
    } catch (e) {
      return lobbyErrorMessage(codeOf(e), word, true);
    }
  };

  // Which lobby you're in stays on this device, with Medium's marks, so a reload comes back to it.
  // One you're only looking at leaves yours alone; one you've left is no longer yours.
  useEffect(() => {
    if (!lobby || (!lobby.joined && loadLobby()?.code !== lobby.code)) return;
    const active = lobby.joined && (lobby.state === 'open' || lobby.state === 'playing');
    saveLobby({ code: lobby.code, kind: lobby.kind, active, marks });
  }, [lobby?.code, lobby?.joined, lobby?.state, marks]);

  // Others join, start the game and play: look again every few seconds, and on coming back to the page.
  const live = lobby !== null && (lobby.state === 'open' || lobby.state === 'playing');
  useEffect(() => {
    if (!live || !lobby) return;
    const refresh = () => {
      if (busy.current || document.visibilityState === 'hidden') return;
      api.get(lobby.code).then((a) => {
        if (!busy.current) setAnswer(a);
      }, () => {});
    };
    const timer = setInterval(refresh, lobby.state === 'open' ? WAITING_POLL_MS : PLAYING_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [live, lobby?.code, lobby?.state]);

  // A notification about this lobby arrived while the app is open: look at once.
  useEffect(() => {
    if (!live || !lobby || !('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: unknown } | null)?.type !== 'game-changed' || busy.current) return;
      api.get(lobby.code).then((a) => {
        if (!busy.current) setAnswer(a);
      }, () => {});
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [live, lobby?.code]);

  /** Sends a request that changes the lobby, one at a time. */
  const act = async (call: () => Promise<LobbyAnswer>, guess = ''): Promise<LobbyAnswer | null> => {
    if (busy.current) return null;
    busy.current = true;
    try {
      const a = await call();
      setAnswer(a);
      return a;
    } catch (e) {
      fail(e, guess);
      // The lobby may have moved on (the time ran out, the host started it): show where it is now.
      api.get(answerRef.current?.lobby.code ?? '').then(setAnswer, () => {});
      return null;
    } finally {
      busy.current = false;
    }
  };

  const reject = (text: string) => {
    setMessage({ text, error: true });
    setShake(true);
  };
  const canType = () => {
    const l = answerRef.current?.lobby;
    return l?.state === 'playing' && l.run?.status === 'playing' && !confirming && !showPlayers;
  };
  const typeLetter = (letter: string) => {
    if (canType() && draftRef.current.length < 5) setDraft(draftRef.current + letter);
  };
  const backspace = () => {
    if (canType()) setDraft(draftRef.current.slice(0, -1));
  };

  const enter = async () => {
    const current = answerRef.current?.lobby;
    const before = current?.run;
    if (!current || !before || !canType() || busy.current) return;
    const guess = draftRef.current;
    const checked = validateGuess(guess);
    if (!checked.ok) {
      reject(errorMessage(checked.error, guess));
      return;
    }
    const repeat = earlierGuess(before.words[before.current].guesses, guess);
    if (repeat) {
      reject(repeatMessage(guess, repeat, current.settings.difficulty));
      return;
    }
    const after = await act(() => api.guess(current.code, guess), guess);
    if (!after) {
      setShake(true);
      return;
    }
    setDraft('');
    const played = after.lobby.run?.words[before.current];
    const latest = played?.guesses[played.guesses.length - 1];
    if (!after.lobby.run || !played || !latest) return;
    if (latest.isWin) {
      setOpenDef(-1);
      const next = after.lobby.run;
      setMessage(next.status === 'playing'
        ? { text: `Found ${latest.guess.toUpperCase()} in ${guessCount(played.guesses.length)}. Word ${next.current + 1} of ${next.words.length}.`, error: false }
        : null);
    } else {
      setMessage({ text: scoreMessage(latest), error: false, quiet: true });
    }
  };

  /** Easy's Suggest: fills the input with a word that fits this word's scores, once the server has recorded it. */
  const suggest = async () => {
    const current = answerRef.current?.lobby;
    const before = current?.run;
    if (!current || !before || !canType() || busy.current) return;
    const word = pickSuggestion(before.words[before.current].guesses);
    if (!word) {
      setMessage({ text: NO_SUGGESTION, error: true });
      return;
    }
    if (!await act(() => api.suggest(current.code, word), word)) return;
    setDraft(word);
    setMessage({ text: suggestedMessage(word), error: false });
  };

  usePhysicalKeyboard({ onLetter: typeLetter, onEnter: () => void enter(), onBackspace: backspace });

  const markLetter = (letter: string) => {
    if (!run) return;
    const all = run.words.map((_, i) => marks[i] ?? {});
    setMarks(all.map((m, i) => (i === run.current ? cycleMark(m, letter) : m)));
  };

  const confirmMoveOn = () => {
    setConfirming(null);
    setDraft('');
    if (lobby) void act(() => api.giveUpWord(lobby.code));
  };
  const confirmGiveUp = () => {
    setConfirming(null);
    setDraft('');
    if (lobby) void act(() => api.giveUp(lobby.code));
  };

  const lastEnd = run && lobby?.startedAt != null
    ? Math.max(lobby.startedAt, ...run.words.map((w) => w.endedAt ?? lobby.startedAt!)) : 0;
  const timeLeft = lobby?.endsAt != null ? formatClock(Math.max(0, lobby.endsAt - now) / 1000) : '';
  const yourTime = lobby?.startedAt != null ? formatClock((lastEnd - lobby.startedAt) / 1000) : '0:00';

  const header = (
    <GameHeader profile={profile} onHome={onExit} onProfile={onProfile} difficulty={difficulty}
      matchup={<span><b>{modeName}</b>{lobby && lobby.state !== 'open' && <> · {lobby.players.length} {lobby.players.length === 1 ? 'player' : 'players'}</>}</span>}
      menu={(close) => (
        <GameMenuItems close={close} difficulty={difficulty}
          difficultyNote="Set by the host for everyone in the lobby: it can't change."
          moveOnLabel="Give up this word and move on" onMoveOn={playing ? () => setConfirming('move-on') : undefined}
          giveUpLabel={`Give up the rest of this ${rush}`} canGiveUp={playing}
          onGiveUp={() => setConfirming('give-up')} onExit={onExit} onHowToPlay={() => setHowTo(true)}
          // Never the join code: anyone with it could join.
          onReport={() => openReport({ screen: `${modeName} · ${lobby?.state ?? 'loading'} · ${DIFFICULTY_LABEL[difficulty]}` })}
          onCheckMarks={medium && word
            ? () => checks.use() && setMessage(marksCheckMessage(marksFitScores(wordMarks, word.guesses))) : undefined}
          checksLeft={checks.left}
          onClearMarks={medium && word && run
            ? () => setMarks(run.words.map((_, i) => (i === run.current ? {} : marks[i] ?? {}))) : undefined} />
      )}>
      {run && lobby?.state !== 'open' && (
        <RushBar dots={<RushDots words={run.words} current={playing ? run.current : null} label="You" />}
          clock={playing ? timeLeft : yourTime} clockLabel={playing ? 'Time left' : 'Your time'}>
          {playing && (
            <button type="button" class="btn small" aria-pressed={showPlayers} onClick={() => setShowPlayers(!showPlayers)}>
              Players
            </button>
          )}
        </RushBar>
      )}
      {shownMarks && word && <InSet marks={shownMarks} />}
    </GameHeader>
  );

  // Competitive Rush is rated, so it needs an account (a lobby you're already in, you can still see).
  if (kind === 'competitive' && !signedIn && !lobby?.joined) {
    return (
      <div class="app">
        {header}
        <section class="panel">
          <h2>Sign in to play Competitive Rush.</h2>
          <p>Competitive Rush is rated, so it needs an account. Sign in from your profile, then come back.</p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={() => onProfile('account')}>Open profile</button>
            <button class="btn" type="button" onClick={onExit}>Main menu</button>
          </div>
        </section>
      </div>
    );
  }

  if (wordStep) {
    const others = lobby ? `${lobby.hostName}'s lobby` : 'your lobby';
    return (
      <WordStep title={wordStep === 'create' ? 'Open a Competitive Rush' : wordStep === 'join' ? `Join ${others}` : 'Change your word'}
        note={`The other 4 players will each try to find your secret word. 5 letters, no repeated letters. ${
          wordStep === 'change' ? 'You can change it until the host starts.' : 'Rated, at one difficulty for everyone.'}`}
        onBack={() => (wordStep === 'create' ? onExit() : setWordStep(null))} onWord={sendWord} />
    );
  }

  if (loadError || !lobby) {
    return (
      <div class="app">
        {header}
        <section class="panel">
          {loadError ? (
            <>
              <h2>{modeName}</h2>
              <p>{loadError}</p>
              <div class="row-btns">
                <button class="btn primary" type="button" onClick={load}>Try again</button>
                <button class="btn" type="button" onClick={onExit}>Main menu</button>
              </div>
            </>
          ) : <p>{code === null ? 'Opening your lobby…' : 'Loading the lobby…'}</p>}
        </section>
      </div>
    );
  }

  const competitive = kind === 'competitive';
  const settingsLine = `${rankByLine(rankBy)} · ${DIFFICULTY_LABEL[lobby.settings.difficulty]} · ${lobby.settings.minutes} minutes · 4 words${
    competitive ? ' · Rated' : ''}`;
  const errorLine = message?.error && <p class="message error" role="status">{message.text}</p>;

  // Someone else's lobby you haven't joined.
  if (!lobby.joined) {
    return (
      <div class="app">
        {header}
        <section class="panel lobby">
          <h2>{lobby.hostName}'s {modeName}</h2>
          {lobby.state === 'open' ? (
            <>
              <p>{settingsLine}. {competitive
                ? "Each player sets a secret word and solves the others', on one clock"
                : 'Everyone solves the same words on one clock'}, which starts when {lobby.hostName} starts the game.
                You'll join as <b>{displayName(profile)}</b>.</p>
              <Seats lobby={lobby} />
              <div class="row-btns">
                <button class="btn primary" type="button" disabled={lobby.players.filter((p) => p.strength === null).length >= LOBBY_SEATS}
                  onClick={() => (competitive ? setWordStep('join') : void act(() => api.join(lobby.code, displayName(profile))))}>
                  {competitive ? 'Next: your word' : 'Join'}
                </button>
                <button class="btn" type="button" onClick={onExit}>Main menu</button>
              </div>
            </>
          ) : (
            <>
              <p>{lobby.state === 'closed' ? 'This lobby is closed.' : `This ${rush} has already started without you.`}</p>
              <div class="row-btns"><button class="btn" type="button" onClick={onExit}>Main menu</button></div>
            </>
          )}
          {errorLine}
        </section>
      </div>
    );
  }

  if (lobby.state === 'open' || lobby.state === 'closed') {
    const host = lobby.host;
    const changeSettings = (change: Partial<LobbySettings>) =>
      void act(() => api.settings(lobby.code, { ...lobby.settings, ...change }));
    const { computers } = lobby.settings;
    const people = lobby.players.length - computers;
    const seats = people + computers;
    return (
      <div class="app">
        {header}
        <section class="panel lobby">
          {lobby.state === 'closed' ? (
            <>
              <h2>This lobby is closed</h2>
              <p>{host ? 'You closed it, or nobody started it within a day.' : `${lobby.hostName} closed it before starting.`}</p>
              <div class="row-btns"><button class="btn" type="button" onClick={onExit}>Main menu</button></div>
            </>
          ) : (
            <>
              <h2>{host ? 'Your lobby' : `${lobby.hostName}'s lobby`}</h2>
              <p>{host ? `Share the join code or link. Up to 5 players, and the clock starts when you start.${
                competitive ? ' Computers set words for the empty seats.' : ''}`
                : `Waiting for ${lobby.hostName} to start. The clock starts for everyone at once.`}</p>
              <JoinCode lobby={lobby} />
              {lobby.yourWord && (
                <p class="lobby-your-word">
                  Your word: <b>{lobby.yourWord.toUpperCase()}</b>
                  <button type="button" class="link-btn" onClick={() => setWordStep('change')}>Change</button>
                </p>
              )}
              <Seats lobby={lobby} />
              {host && <InviteFriends lobby={lobby} api={api} identity={identity} />}
              {host ? (
                <div class="lobby-settings">
                  <RankBySwitch label rankBy={rankBy} onPick={(r) => changeSettings({ rankBy: r === 'rush' ? 'rush' : undefined })} />
                  <span class="menu-label" id="lobby-diff">Difficulty, for everyone</span>
                  <div class="seg" role="group" aria-labelledby="lobby-diff">
                    {/* Competitive Rush is rated, so it leaves Easy out. */}
                    {DIFFICULTIES.filter((d) => !competitive || isRatedDifficulty(d)).map((d) => (
                      <button type="button" key={d} aria-pressed={lobby.settings.difficulty === d}
                        onClick={() => changeSettings({ difficulty: d })}>{DIFFICULTY_LABEL[d]}</button>
                    ))}
                  </div>
                  <label class="menu-label" for="lobby-minutes">Duration</label>
                  <select id="lobby-minutes" class="select" value={lobby.settings.minutes}
                    onChange={(e) => changeSettings({ minutes: Number(e.currentTarget.value) })}>
                    {LOBBY_MINUTES.map((m) => <option key={m} value={m}>{m} minutes</option>)}
                  </select>
                  {competitive ? <span class="menu-label">Computers in empty seats</span> : (
                    <>
                      <span class="menu-label" id="lobby-computers">Computer players in empty seats</span>
                      <div class="stepper" role="group" aria-labelledby="lobby-computers">
                        <button type="button" class="btn small" aria-label="One computer fewer" disabled={computers === 0}
                          onClick={() => changeSettings({ computers: computers - 1 })}>−</button>
                        <output aria-live="polite">{computers}</output>
                        <button type="button" class="btn small" aria-label="One computer more" disabled={seats >= LOBBY_SEATS}
                          onClick={() => changeSettings({ computers: computers + 1 })}>+</button>
                      </div>
                    </>
                  )}
                  {computers > 0 && (
                    <div class="seg" role="group" aria-label="Computer strength">
                      {STRENGTHS.map((st) => (
                        <button type="button" key={st} aria-pressed={lobby.settings.strength === st}
                          onClick={() => changeSettings({ strength: st })}>{STRENGTH_LABEL[st]}</button>
                      ))}
                    </div>
                  )}
                  {computers > 0 && (
                    <span class="menu-note">Stronger computers need fewer guesses, but take longer over each. A friend who
                      joins takes a computer's seat.{competitive && ' Only people count toward the rating.'}</span>
                  )}
                </div>
              ) : <p class="board-note">{settingsLine}</p>}
              <div class="row-btns">
                {host ? (
                  <>
                    <button class="btn primary" type="button" disabled={seats < 2}
                      onClick={() => void act(() => api.start(lobby.code))}>Start the {rush}</button>
                    <button class="btn" type="button" onClick={() => setConfirming('close')}>Close lobby</button>
                  </>
                ) : (
                  <button class="btn" type="button" onClick={() => void act(() => api.leave(lobby.code)).then((a) => {
                    if (a) onExit();
                  })}>Leave lobby</button>
                )}
              </div>
              {host && seats < 2 && <p class="board-note">Wait for someone to join, or add a computer player.</p>}
              {competitive && people < 2 && (
                <p class="board-note">Rated once someone else joins: only people count toward the rating, so a {rush}
                  against computers alone is practice.</p>
              )}
              {lobby.closesAt !== null && (
                <p class="board-note">The lobby closes if nobody starts it within {durationText(lobby.closesAt - now)}.</p>
              )}
              <TurnAlertsPrompt apiUrl={API_URL!} identity={identity} offer={ALERTS_OFFER} />
              {/* A pop-up, so the question is in view however far down Close lobby was. */}
              {confirming === 'close' && (
                <ConfirmDialog title="Close the lobby?" body="It closes for everyone in it."
                  confirmLabel="Close it" cancelLabel="Keep it open" onCancel={() => setConfirming(null)}
                  onConfirm={() => {
                    setConfirming(null);
                    // You closed it, so there's nothing to see here: back to the main menu, the lobby no longer yours.
                    void act(() => api.close(lobby.code)).then((a) => {
                      if (a?.lobby.state !== 'closed') return;
                      saveLobby({ code: lobby.code, kind: lobby.kind, active: false, marks });
                      onExit();
                    });
                  }} />
              )}
            </>
          )}
          {errorLine}
        </section>
        {howTo && <HowToPlay onClose={() => setHowTo(false)} />}
      </div>
    );
  }

  if (showPlayers && playing) {
    return (
      <div class="app">
        {header}
        <section class="panel lobby">
          <h2>Standings so far</h2>
          <Standings lobby={lobby} />
          <p class="board-note">
            Provisional: a word given up counts as the most guesses anyone needed for it, plus {PENALTY_GUESSES}
            {rankBy === 'rush' && <> (and the slowest time, plus {PENALTY_SECONDS / 60} minutes)</>}, so places can change
            until everyone's done. {timeLeft} left.
          </p>
          <div class="row-btns"><button class="btn" type="button" onClick={() => setShowPlayers(false)}>Back to your word</button></div>
        </section>
      </div>
    );
  }

  const over = lobby.state === 'over';
  const found = run ? run.words.filter((w) => w.outcome === 'solved').length : 0;
  const totalGuesses = run ? run.words.reduce((sum, w) => sum + w.guesses.length, 0) : 0;
  const standings = lobby.standings ?? [];
  const mine = standings.find((p) => p.you);
  const ranked = standings.filter((p) => p.rank !== null).length;
  const tied = mine?.rank != null && standings.filter((p) => p.rank === mine.rank).length > 1;
  const place = mine?.rank == null ? null : `${tied ? 'tied ' : ''}${ordinal(mine.rank)} of ${standings.length}`;
  const counted = mine ? mine.words.reduce((sum, w) => sum + (w.counted?.guesses ?? 0), 0) : 0;
  const factor = DIFFICULTY_FACTOR[difficulty];
  const heading = over
    ? mine?.rank === 1 ? (tied ? 'Tied for first!' : 'You won!') : place ? `You came ${place}.` : `The ${rush} is over.`
    : place && ranked < standings.length ? `You're done: ${place} so far.` : "You're done.";

  return (
    <div class="app">
      {header}

      {run && word && (
        <RushBoard difficulty={difficulty} guesses={word.guesses} newestFirst={settings.newestFirst[difficulty]}
          label={`Your guesses at word ${run.current + 1}`}
          emptyText={run.current === 0 ? `The clock is running${run.setBy ? `: this is ${run.setBy[0]}'s word` : ''}. Type a 5-letter word and press Enter.`
            : `Word ${run.current + 1}${run.setBy ? `, ${run.setBy[run.current]}'s` : ''}: no guesses yet.`}
          marks={shownMarks} onMark={medium ? markLetter : undefined}
          openDef={openDef} onToggleDef={(i) => setOpenDef(openDef === i ? -1 : i)} definitions={definitions}
          entry={!confirming} draft={draft} shake={shake} onShakeEnd={() => setShake(false)} message={message}
          suggested={word.suggested} onSuggest={() => void suggest()}
          onShuffle={shuffle} onLetter={typeLetter} onEnter={() => void enter()} onBackspace={backspace} />
      )}

      {confirming === 'move-on' && playing && (
        <section class="panel warning">
          <h2>Give up this word and move on?</h2>
          <p>
            <b>This will hurt your score.</b> The word counts as the most guesses anyone in the lobby needed to find
            it, plus {PENALTY_GUESSES}{rankBy === 'rush' && <>, and the slowest time anyone took, plus {PENALTY_SECONDS / 60} minutes</>},
            and at least what you've used on it. It stays hidden until the {rush} is over. The clock keeps running.
          </p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={confirmMoveOn}>Give up this word</button>
            <button class="btn" type="button" onClick={() => setConfirming(null)}>Keep playing</button>
          </div>
        </section>
      )}

      {confirming === 'give-up' && playing && (
        <section class="panel warning">
          <h2>Give up the rest of this {rush}?</h2>
          <p>
            <b>This will hurt your score.</b> Every word you haven't found counts as the most guesses anyone needed to
            find it, plus {PENALTY_GUESSES}{rankBy === 'rush' && <>, and the slowest time, plus {PENALTY_SECONDS / 60} minutes</>}.
            You'll see how everyone did when the {rush} is over.
          </p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={confirmGiveUp}>Give up the rest</button>
            <button class="btn" type="button" onClick={() => setConfirming(null)}>Keep playing</button>
          </div>
        </section>
      )}

      {run && !playing && (
        <section class="panel rush-result">
          <h2>{heading}</h2>
          <RushWords marks={marks} newestFirst={settings.newestFirst[difficulty]} definitions={definitions}
            hiddenLabel={`Hidden until the ${rush} is over`}
            rows={run.words.map((w, i) => ({
              word: w.word,
              lit: w.outcome === 'solved',
              guesses: w.guesses,
              reached: w.startedAt !== null,
              missed: w.outcome === 'solved' ? null : w.outcome === 'gave-up' ? 'Gave up' : 'Not found',
              seconds: spentSeconds(w),
              setBy: run.setBy?.[i],
            }))} />
          {mine?.score != null && (
            <RushSummary tiers={[
              [rankBy === 'rush' ? 'Time' : 'Score', rankedText(rankBy, mine)],
              [over ? 'Place' : 'Place so far', mine.rank === null ? '…' : ordinal(mine.rank)],
            ]} />
          )}
          <p class="tally">
            {found} of 4 found in {guessCount(totalGuesses)} ({yourTime}) on {DIFFICULTY_LABEL[difficulty]}.
            {mine?.score != null && rankBy === 'rush' && <> Time: {formatClock(mine.seconds ?? 0)}
              {counted > totalGuesses && ', with penalties for words not found'}. Faster is better; fewer guesses break ties.</>}
            {mine?.score != null && rankBy === 'crush' && <> Score: {(counted / 4).toFixed(1)} guesses a word
              {counted > totalGuesses && ', with penalties for words not found,'} × {factor} = {scoreText(mine.score)}.
              Lower is better; time breaks ties.</>}
          </p>
          {answer?.rating && <RatingChange line={answer.rating} />}
          {competitive && !over && lobby.players.filter((p) => p.strength === null).length > 1 && (
            <p class="board-note">Your rating changes when the {rush} is over, by your place against each other person.</p>
          )}
          <h3>{over ? 'Final standings' : 'Standings so far'}</h3>
          <Standings lobby={lobby} />
          <p class="board-note">
            {over ? 'Final.' : `Provisional until everyone's done, or the time is up in ${timeLeft}: a word someone gives up counts from how the others did on it.`}
          </p>
          <div class="row-btns">
            {over && mine?.rank != null && standings.every((p) => p.rank !== null) && (
              <ShareResult text={lobbyShareText({
                mode: modeName,
                rankBy,
                players: standings.map((p) => ({
                  rank: p.rank!, name: p.name, strength: p.strength, you: p.you, seconds: p.seconds,
                  words: p.words.map((w) => ({ guesses: w.guesses, found: w.outcome === 'solved' })),
                })),
              })} />
            )}
            <button class="btn" type="button" onClick={onExit}>Main menu</button>
          </div>
          {errorLine}
        </section>
      )}
      {run && !playing && !over && <TurnAlertsPrompt apiUrl={API_URL!} identity={identity} offer={ALERTS_OFFER} />}

      {howTo && <HowToPlay onClose={() => setHowTo(false)} />}
    </div>
  );
}
