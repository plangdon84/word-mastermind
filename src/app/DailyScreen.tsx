import type { ComponentChildren } from 'preact';
import type { OpenProfile } from './profilePages';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  addDays, betterThan, dailyElapsedMs, dayEnd, cycleMark, DIFFICULTIES, earlierGuess, marksFitScores, ordinal, rankByHow,
  rankByName, validateGuess, type DailyDay, type DailyMode, type DailyView, type DailyWordView, type Difficulty, type Marks,
  type RankBy,
} from '../game';
import { useCheckLimit } from './checkLimit';
import type { ApiIdentity } from './apiIdentity';
import { Bubble, DIFFICULTY_LABEL, InSet } from './components';
import { GameHeader, GameMenuItems } from './gameHeader';
import { BoardPage, HowToPlay } from './panels';
import { API_URL } from './config';
import { dailyApi, DailyApiError, type DailyApi, type DailyBoard, type DailyToday } from './dailyApi';
import { PlayerName } from './friendLink';
import type { Circle } from './leaderboardsApi';
import { receivePlacements } from './badges';
import { loadDaily, saveDaily } from './dailyStorage';
import { NO_GUESSES, useShownMarks } from './easyMarks';
import { NO_SUGGESTION, pickSuggestion, suggestedMessage } from './suggestion';
import { useDefinitions } from './definitions';
import { useMessage, useNow, usePhysicalKeyboard } from './hooks';
import { countdownText, dailyErrorMessage, dayEndingStartText, dayEndingText, errorMessage, guessCount, marksCheckMessage, repeatMessage, scoreMessage } from './messages';
import { displayName, type Profile } from './profileStorage';
import { openReport } from './reportIssue';
import { formatClock, RankBySwitch, RushBar, RushBoard, RushDots, RushSummary, RushWords, spentSeconds } from './rushParts';
import type { Settings } from './settings';
import { shuffleLetters } from './keyboard';
import { ShareResult } from './ShareResult';
import { DAILY_NAME, dailyShareText } from './shareText';


/** The server's refusal code, or `unreachable`. */
const codeOf = (e: unknown) => (e instanceof DailyApiError ? e.code : 'unreachable');


/** When the run's last word was found or given up. */
const runEnd = (run: DailyView): number => Math.max(run.startedAt, ...run.words.map((w) => w.endedAt ?? run.startedAt));

/** A word's time in seconds, leaving out its pauses; null if it wasn't reached. */
function unpausedSeconds(w: DailyWordView): number | null {
  const seconds = spentSeconds(w);
  return seconds === null ? null : Math.max(0, seconds - w.pausedMs / 1000);
}

/** Your place: "12th of 340 · better than 96%". */
export function placeText(p: { rank: number; total: number; behind: number }): string {
  const better = betterThan(p);
  return `${ordinal(p.rank)} of ${p.total}${better === null ? '' : ` · better than ${better}%`}`;
}

/** The boards each daily game has: the Daily Set's Crush and Rush, the Daily Word's Crush (fewest guesses) alone. */
export const DAILY_BOARDS: Record<DailyMode, readonly RankBy[]> = { daily: ['crush', 'rush'], dailyWord: ['crush'] };

/**
 * A day's leaderboard for one difficulty, with the days before it a tap
 * away: everyone's, or (signed in) you and your friends'. The Daily Set's is
 * ranked as a Rush (fastest) or a Crush (fewest guesses), flipped with the
 * switch, which keeps the day, difficulty and circle; the Daily Word's by
 * fewest guesses alone. Today's is provisional until midnight New York time.
 */
export function DailyBoardPanel({ mode = 'daily', api, today, day: firstDay, difficulty: firstDifficulty, circle, rankBy: picked, onRankBy }: {
  mode?: DailyMode;
  api: DailyApi;
  today: DailyDay;
  day: DailyDay;
  difficulty: Difficulty;
  circle: Circle;
  rankBy: RankBy;
  onRankBy: (rankBy: RankBy) => void;
}) {
  const rankBy = mode === 'daily' ? picked : 'crush';
  const [day, setDay] = useState(firstDay);
  const [difficulty, setDifficulty] = useState(firstDifficulty);
  const [board, setBoard] = useState<DailyBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The earliest day with this game, once a day before it turns out to have none. */
  const [first, setFirst] = useState<DailyDay | null>(null);
  useEffect(() => {
    let live = true;
    setBoard(null);
    setError(null);
    api.board(day, difficulty, circle, rankBy).then((b) => live && setBoard(b), (e: unknown) => {
      if (!live) return;
      const code = codeOf(e);
      if (code === 'not-found' && day < today) setFirst(addDays(day, 1));
      setError(dailyErrorMessage(code));
    });
    return () => {
      live = false;
    };
  }, [api, day, difficulty, circle, rankBy]);
  const dayLabel = new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
  const youShown = board?.top.some((r) => r.you);
  return (
    <section class="panel daily-board" aria-label={`${DAILY_NAME[mode]} leaderboard`}>
      <div class="board-day">
        <button type="button" class="btn small" aria-label="The day before" disabled={first !== null && day <= first}
          onClick={() => setDay(addDays(day, -1))}>‹</button>
        <h2>{day === today ? 'Today' : dayLabel}</h2>
        <button type="button" class="btn small" aria-label="The day after" disabled={day >= today}
          onClick={() => setDay(addDays(day, 1))}>›</button>
      </div>
      {mode === 'daily' && <RankBySwitch rankBy={rankBy} onPick={onRankBy} />}
      <div class="seg" role="group" aria-label="Leaderboard difficulty">
        {DIFFICULTIES.map((d) => (
          <button type="button" key={d} aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
            {DIFFICULTY_LABEL[d]}
          </button>
        ))}
      </div>
      {error && <p class="board-note">{error}</p>}
      {!error && !board && <p class="board-note">Loading…</p>}
      {board && (
        <>
          {board.theme && <p class="board-theme"><b>{board.theme}</b></p>}
          {board.words && (
            <p class="board-words" aria-label={`${board.words.length === 1 ? 'The word' : 'The words'}: ${board.words.join(', ')}`}>
              {board.words.map((w) => (
                <span class="letters" key={w}>{[...w].map((c, i) => <Bubble key={i} letter={c} class="mini" />)}</span>
              ))}
            </p>
          )}
          {board.total === 0 ? (
            <p class="board-note">
              {circle === 'friends' ? 'Neither you nor your friends have' : 'Nobody has'} finished
              on {DIFFICULTY_LABEL[difficulty]} {day === today ? 'yet' : 'that day'}.
            </p>
          ) : (
            <ol class="board-rows">
              {board.top.map((r, i) => (
                <li key={i} class={r.you ? 'you' : ''}>
                  <span class="board-rank">{r.rank}</span>
                  <span class="board-name"><PlayerName name={r.name} code={r.friendCode} />{r.you && <span class="visually-hidden"> (you)</span>}</span>
                  {/* What the board ranks by comes first. */}
                  {rankBy === 'rush' ? (
                    <>
                      <span class="board-guesses">{formatClock(r.ms / 1000)}</span>
                      <span class="board-time">{r.guesses}</span>
                    </>
                  ) : (
                    <>
                      <span class="board-guesses">{r.guesses}</span>
                      <span class="board-time">{formatClock(r.ms / 1000)}</span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
          {board.you && (
            <p class="board-you">
              {youShown ? 'You' : `You: ${guessCount(board.you.guesses)} in ${formatClock(board.you.ms / 1000)}`}
              {' · '}{placeText(board.you)}
            </p>
          )}
          {board.total > 0 && (
            <p class="board-note">
              {board.total} {board.total === 1 ? 'player' : 'players'}{circle === 'friends' && ' of you and your friends'} finished.
              {day === today && ' Places are final at midnight New York time.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * A daily game, refereed by the server, once a day: the Daily Set (Daily
 * Rush), the day's themed set of 4 words, or (`mode`) the Daily Word, one
 * word. With `start`, it starts today's run at your difficulty if you haven't
 * played yet. The Daily Set's Pause stops the clock, on the server too.
 */
export function DailyScreen({ mode = 'daily', settings, onBoardRankBy, profile, identity, onProfile, onExit, start }: {
  mode?: DailyMode;
  settings: Settings;
  /** The board's Rush · fastest / Crush · fewest switch was flipped: it opens there next time. */
  onBoardRankBy: (rankBy: RankBy) => void;
  profile: Profile;
  identity: ApiIdentity;
  onProfile: OpenProfile;
  onExit: () => void;
  start: boolean;
}) {
  const api = useMemo(() => dailyApi(API_URL ?? '', identity, fetch, mode), [identity, mode]);
  const name = DAILY_NAME[mode];
  const set = mode === 'daily';
  /** What comes out each day: "set" or "word". */
  const next = set ? 'set' : 'word';
  const [today, setTodayState] = useState<DailyToday | null>(null);
  const todayRef = useRef<DailyToday | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The server's clock minus this device's, so the clock and countdown follow the server. */
  const [offset, setOffset] = useState(0);
  const [marks, setMarks] = useState<readonly Marks[]>([]);
  const [draft, setDraftState] = useState('');
  const draftRef = useRef('');
  const busy = useRef(false);
  const [message, setMessage] = useMessage();
  const [shake, setShake] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [circle, setCircle] = useState<Circle>('everyone');
  /** Your place so far on each of today's boards: Crush and (the Daily Set) Rush. */
  const [placements, setPlacements] = useState<Partial<Record<RankBy, NonNullable<DailyBoard['you']>>>>({});
  const [openDef, setOpenDef] = useState(-1);
  const [howTo, setHowTo] = useState(false);
  const localNow = useNow(1000);
  const now = localNow + offset;

  const run = today?.run ?? null;
  const playing = run?.status === 'playing';
  /** Paused: the clock is stopped and the board covered until Resume (README "Daily Rush"). */
  const paused = playing && run?.pausedAt != null;
  /**
   * The run's day ended before it did: it can still be finished, but it's off the board (README "Daily
   * Rush"). Judged by when it ended, so a result left open past midnight stays on time.
   */
  const late = !!run && (playing ? now : runEnd(run)) >= dayEnd(run.day);
  /** Opens the board at one side: Rush or Crush. */
  const openBoard = (rankBy: RankBy) => {
    onBoardRankBy(rankBy);
    setShowBoard(true);
  };
  const difficulty = run?.difficulty ?? settings.difficulty;
  const medium = difficulty === 'medium';
  // Easy and Medium: the Shuffle key reorders the typed letters, whenever the letter keys would type.
  const shuffle = difficulty === 'easy' || medium
    ? () => {
      if (canType()) setDraft(shuffleLetters(draftRef.current));
    }
    : undefined;
  const word = run && playing ? run.words[run.current] : null;
  const wordMarks = (run && marks[run.current]) ?? {};
  const checks = useCheckLimit(`${mode}:${run?.day}:${run?.current}`);
  const shownMarks = useShownMarks(difficulty, wordMarks, word?.guesses ?? NO_GUESSES);
  const definitions = useDefinitions(openDef >= 0 || (run !== null && !playing));

  const setToday = (t: DailyToday) => {
    todayRef.current = t;
    setTodayState(t);
    setOffset(t.now - Date.now());
    receivePlacements(t.placements, mode);
  };
  const setDraft = (d: string) => {
    draftRef.current = d;
    setDraftState(d);
  };

  /** `autoStart`: start today's run straight away if there's nothing to show (Start Daily Set or Daily Word). */
  const load = (autoStart = start) => {
    setLoadError(null);
    api.today().then(async (t) => {
      const saved = loadDaily(mode);
      setMarks(saved?.day === (t.run?.day ?? t.day) ? saved.marks : []);
      // The Daily Set needs the day's theme; the Daily Word's word is picked when it's started.
      if (t.run || !autoStart || (set && !t.theme)) {
        setToday(t);
        return;
      }
      setToday(await api.start(t.day, settings.difficulty, displayName(profile)));
    }).catch((e: unknown) => setLoadError(dailyErrorMessage(codeOf(e))));
  };
  useEffect(() => load(), []);

  // Medium's marks stay on this device, as does whether a reload should come back here.
  useEffect(() => {
    if (today?.run) saveDaily({ day: today.run.day, playing: today.run.status === 'playing', marks }, mode);
  }, [today, marks]);

  // Once you've finished, your place so far on both boards (none for a run finished after its day).
  useEffect(() => {
    if (!today || run?.status !== 'finished' || late) return;
    let live = true;
    for (const rankBy of DAILY_BOARDS[mode]) {
      api.board(run.day, run.difficulty, 'everyone', rankBy).then((b) => {
        const you = b.you;
        if (live && you) setPlacements((p) => ({ ...p, [rankBy]: you }));
      }, () => {});
    }
    return () => {
      live = false;
    };
  }, [run?.day, run?.status, late]);

  const reject = (text: string) => {
    setMessage({ text, error: true });
    setShake(true);
  };
  const canType = () => {
    const current = todayRef.current?.run;
    return current?.status === 'playing' && current.pausedAt === null && !confirming && !showBoard;
  };
  const typeLetter = (letter: string) => {
    if (canType() && draftRef.current.length < 5) setDraft(draftRef.current + letter);
  };
  const backspace = () => {
    if (canType()) setDraft(draftRef.current.slice(0, -1));
  };

  /** The run's day is long over (more than a day late): it can't be finished, and today's set is out. */
  const dayOver = () => {
    setMessage({ text: dailyErrorMessage('day-over'), error: true });
    setDraft('');
    api.today().then(setToday, () => {});
  };

  const enter = async () => {
    const before = todayRef.current;
    const current = before?.run;
    if (!before || !current || !canType() || busy.current) return;
    const guess = draftRef.current;
    const checked = validateGuess(guess);
    if (!checked.ok) {
      reject(errorMessage(checked.error, guess));
      return;
    }
    const repeat = earlierGuess(current.words[current.current].guesses, guess);
    if (repeat) {
      reject(repeatMessage(guess, repeat, current.difficulty));
      return;
    }
    busy.current = true;
    try {
      const after = await api.guess(current.day, guess);
      setToday(after);
      setDraft('');
      const played = after.run?.words[current.current];
      const latest = played?.guesses[played.guesses.length - 1];
      if (!after.run || !played || !latest) return;
      if (latest.isWin) {
        setOpenDef(-1);
        setMessage(after.run.status === 'playing'
          ? { text: `Found ${latest.guess.toUpperCase()} in ${guessCount(played.guesses.length)}. Word ${after.run.current + 1} of ${after.run.words.length}.`, error: false }
          : null);
      } else {
        setMessage({ text: scoreMessage(latest), error: false, quiet: true });
      }
    } catch (e) {
      const code = codeOf(e);
      if (code === 'day-over') dayOver();
      else reject(dailyErrorMessage(code, guess));
    } finally {
      busy.current = false;
    }
  };

  /** Easy's Suggest: fills the input with a word that fits this word's scores, once the server has recorded it. */
  const suggest = async () => {
    const before = todayRef.current;
    const current = before?.run;
    if (!before || !current || !canType() || busy.current) return;
    const word = pickSuggestion(current.words[current.current].guesses);
    if (!word) {
      setMessage({ text: NO_SUGGESTION, error: true });
      return;
    }
    busy.current = true;
    try {
      setToday(await api.suggest(current.day, word));
      setDraft(word);
      setMessage({ text: suggestedMessage(word), error: false });
    } catch (e) {
      const code = codeOf(e);
      if (code === 'day-over') dayOver();
      else reject(dailyErrorMessage(code, word));
    } finally {
      busy.current = false;
    }
  };

  usePhysicalKeyboard({ onLetter: typeLetter, onEnter: () => void enter(), onBackspace: backspace });

  /** Stops or starts the clock: the server records it, so your time leaves the pause out. */
  const togglePause = async () => {
    const current = todayRef.current?.run;
    if (!current || current.status !== 'playing' || busy.current) return;
    busy.current = true;
    try {
      setToday(await (current.pausedAt === null ? api.pause(current.day) : api.resume(current.day)));
      setMessage(null);
    } catch (e) {
      const code = codeOf(e);
      if (code === 'day-over') dayOver();
      else setMessage({ text: dailyErrorMessage(code), error: true });
    } finally {
      busy.current = false;
    }
  };

  const confirmGiveUp = () => {
    setConfirming(false);
    const day = todayRef.current?.run?.day;
    if (!day) return;
    api.giveUp(day).then(setToday, (e: unknown) => {
      if (codeOf(e) === 'day-over') dayOver();
      else setMessage({ text: dailyErrorMessage(codeOf(e)), error: true });
    });
  };

  const markLetter = (letter: string) => {
    if (!run) return;
    const all = run.words.map((_, i) => marks[i] ?? {});
    setMarks(all.map((m, i) => (i === run.current ? cycleMark(m, letter) : m)));
  };

  const clock = run ? formatClock(dailyElapsedMs(run, !playing, now) / 1000) : '0:00';
  const nextSet = today ? countdownText(today.nextAt - now) : '';
  /** With 5 minutes or less of the day left (README "Daily Rush"). */
  const dayEnding = today && run && !late ? dayEndingText(today.nextAt - now) : null;
  const dayEndingStart = today && !run ? dayEndingStartText(today.nextAt - now) : null;
  const totalGuesses = run ? run.words.reduce((sum, w) => sum + w.guesses.length, 0) : 0;

  const header = (
    <GameHeader profile={profile} onHome={onExit} onProfile={onProfile} difficulty={difficulty}
      matchup={
        <span>
          <b>{name}</b>
          {today?.runTheme && <> · {today.runTheme}</>}
        </span>
      }
      menu={(close) => (
        <GameMenuItems close={close} difficulty={difficulty}
          difficultyNote={`Chosen for today's ${name}: it can't change.`}
          giveUpLabel={late ? `Give up this ${name}` : `Give up today's ${name}`} canGiveUp={playing}
          onGiveUp={() => setConfirming(true)} onExit={onExit} onHowToPlay={() => setHowTo(true)}
          onReport={() => openReport({
            screen: `${name} · ${today?.day ?? 'loading'} · ${DIFFICULTY_LABEL[difficulty]}`,
          })}
          onCheckMarks={medium && word && !paused
            ? () => checks.use() && setMessage(marksCheckMessage(marksFitScores(wordMarks, word.guesses))) : undefined}
          checksLeft={checks.left}
          onClearMarks={medium && word && run && !paused
            ? () => setMarks(run.words.map((_, i) => (i === run.current ? {} : marks[i] ?? {}))) : undefined} />
      )}>
      {run && (
        <RushBar dots={<RushDots words={run.words} current={playing ? run.current : null} />} clock={clock}
          clockLabel={paused ? `Time, paused: ${clock}` : 'Time'} paused={paused}>
          {playing && run.pausable && (paused || run.pausesLeft > 0) && (
            <button type="button" class="btn small" disabled={confirming} onClick={() => void togglePause()}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}
        </RushBar>
      )}
      {shownMarks && word && !paused && <InSet marks={shownMarks} />}
    </GameHeader>
  );

  if (loadError || !today) {
    return (
      <div class="app">
        {header}
        <section class="panel">
          {loadError ? (
            <>
              <h2>{name}</h2>
              <p>{loadError}</p>
              <div class="row-btns">
                <button class="btn primary" type="button" onClick={() => load()}>Try again</button>
                <button class="btn" type="button" onClick={onExit}>Main menu</button>
              </div>
            </>
          ) : <p>Loading today's {name}…</p>}
        </section>
      </div>
    );
  }

  if (showBoard) {
    return (
      <BoardPage title={name} onBack={() => setShowBoard(false)} circle={identity.token ? circle : null}
        onCircle={setCircle}>
        <DailyBoardPanel mode={mode} api={api} today={today.day} day={run?.day ?? today.day} difficulty={difficulty}
          circle={identity.token ? circle : 'everyone'} rankBy={settings.boardRankBy} onRankBy={onBoardRankBy} />
      </BoardPage>
    );
  }

  return (
    <div class="app">
      {header}

      {!run && (
        <section class="panel">
          {!set ? (
            <>
              <h2>Today's word</h2>
              <p>
                One secret word, the same for everyone, once. You'll play at <b>{DIFFICULTY_LABEL[settings.difficulty]}</b>,
                which can't change once you start. Fewest guesses wins, and time breaks ties. Next word in {nextSet}.
              </p>
              {dayEndingStart && <p class="daily-note warn" role="status"><b>{dayEndingStart}</b></p>}
              <div class="row-btns">
                <button class="btn primary" type="button" onClick={() => {
                  api.start(today.day, settings.difficulty, displayName(profile))
                    .then(setToday, (e: unknown) => setMessage({ text: dailyErrorMessage(codeOf(e)), error: true }));
                }}>Start Daily Word</button>
                <button class="btn" type="button" onClick={() => setShowBoard(true)}>Leaderboard</button>
                <button class="btn" type="button" onClick={onExit}>Main menu</button>
              </div>
            </>
          ) : today.theme ? (
            <>
              <h2>Today: {today.theme}</h2>
              <p>
                4 words on today's theme, once. You'll play at <b>{DIFFICULTY_LABEL[settings.difficulty]}</b>, which
                can't change once you start. <b>Pause</b> stops your clock and hides the board, twice a run. Next set in {nextSet}.
              </p>
              {dayEndingStart && <p class="daily-note warn" role="status"><b>{dayEndingStart}</b></p>}
              <div class="row-btns">
                <button class="btn primary" type="button" onClick={() => {
                  api.start(today.day, settings.difficulty, displayName(profile))
                    .then(setToday, (e: unknown) => setMessage({ text: dailyErrorMessage(codeOf(e)), error: true }));
                }}>Start Daily Set</button>
                <button class="btn" type="button" onClick={() => setShowBoard(true)}>Leaderboard</button>
                <button class="btn" type="button" onClick={onExit}>Main menu</button>
              </div>
            </>
          ) : (
            <>
              <h2>No Daily Set today</h2>
              <p>There's no themed set today. Try Solo Rush instead.</p>
              <div class="row-btns"><button class="btn" type="button" onClick={onExit}>Main menu</button></div>
            </>
          )}
          {message && <p class="message error" role="status">{message.text}</p>}
        </section>
      )}

      {run && word && late && (
        <p class="daily-note" role="status">
          The day has changed. You can finish this {name}, but it won't go on the leaderboard.
        </p>
      )}
      {word && dayEnding && <p class="daily-note warn" role="status">{dayEnding}</p>}

      {/* While paused the board is hidden, so the pause can't be used to think. */}
      {word && paused && (
        <section class="panel">
          <h2>Paused</h2>
          <p>
            Your clock is stopped, and your guesses are hidden until you resume.{' '}
            {run.pausesLeft === 0 ? "That was your last pause." : `${run.pausesLeft} pause left.`}
          </p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={() => void togglePause()}>Resume</button>
          </div>
          {message && <p class="message error" role="status">{message.text}</p>}
        </section>
      )}

      {run && word && !paused && (
        <RushBoard difficulty={difficulty} guesses={word.guesses} newestFirst={settings.newestFirst[difficulty]}
          label={set ? `Your guesses at word ${run.current + 1}` : 'Your guesses'}
          emptyText={!set
            ? `${run.day === today.day ? "Today's" : "Yesterday's"} word: type a 5-letter word and press Enter.`
            : run.current === 0
              ? `${run.day === today.day ? "Today's" : "Yesterday's"} theme: ${today.runTheme}. Type a 5-letter word and press Enter.`
              : `Word ${run.current + 1}: no guesses yet.`}
          marks={shownMarks} onMark={medium ? markLetter : undefined}
          openDef={openDef} onToggleDef={(i) => setOpenDef(openDef === i ? -1 : i)} definitions={definitions}
          entry={!confirming} draft={draft} shake={shake} onShakeEnd={() => setShake(false)} message={message}
          suggested={word.suggested} onSuggest={() => void suggest()}
          onShuffle={shuffle} onLetter={typeLetter} onEnter={() => void enter()} onBackspace={backspace} />
      )}

      {confirming && playing && (
        <section class="panel warning">
          {late ? (
            <>
              <h2>Give up this {name}?</h2>
              <p>The day it was for is over, so it's not on the leaderboard either way.</p>
            </>
          ) : (
            <>
              <h2>Give up today's {name}?</h2>
              <p>
                <b>You won't be on today's leaderboard</b>, and you can't play again until the next {next}, in {nextSet}.
                {set && ' Giving up one word gives up the whole Daily Set.'}
              </p>
            </>
          )}
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={confirmGiveUp}>Give up</button>
            <button class="btn" type="button" onClick={() => setConfirming(false)}>Keep playing</button>
          </div>
        </section>
      )}

      {run && !playing && (
        <section class="panel rush-result">
          <h2>
            {run.status === 'finished' ? (set ? `All 4 words in ${clock}.` : `Found in ${guessCount(totalGuesses)}, ${clock}.`)
              : late ? `You gave up this ${name}.` : `You gave up today's ${name}.`}
          </h2>
          <RushWords marks={marks} newestFirst={settings.newestFirst[difficulty]} definitions={definitions}
            hiddenLabel={late ? "On that day's leaderboard" : 'Hidden until tomorrow'}
            rows={run.words.map((w) => ({
              word: w.word,
              lit: w.word !== null,
              guesses: w.guesses,
              reached: w.startedAt !== null,
              missed: w.outcome === 'solved' ? null : 'Not found',
              seconds: unpausedSeconds(w),
            }))} />
          {late ? (
            <>
              {run.status === 'finished' && <RushSummary tiers={[['Guesses', totalGuesses]]} />}
              <p class="tally">
                {run.status === 'finished'
                  ? <>{guessCount(totalGuesses)} in {clock} on {DIFFICULTY_LABEL[run.difficulty]}. You finished after the day changed, so this one isn't on the board.</>
                  : `That day's leaderboard shows its ${set ? 'words' : 'word'}.`}
                {' '}Today's {next} is out now.
              </p>
            </>
          ) : run.status === 'finished' ? (
            <>
              {/* Your place on each board, a tap from that board (README "Daily Rush"). */}
              <RushSummary tiers={[
                ['Guesses', totalGuesses],
                // Crush first, as the line below and the README put it. The Daily Word's one board is just "Place".
                ...DAILY_BOARDS[mode].map((rankBy): [string, ComponentChildren] => [set ? `${rankByName(rankBy)} · ${rankByHow(rankBy)}` : 'Place', (
                  <button type="button" class="link-btn" aria-label={set ? `Your ${rankByName(rankBy)} place: open that board` : 'Your place: open the board'}
                    onClick={() => openBoard(rankBy)}>
                    {placements[rankBy] ? ordinal(placements[rankBy]!.rank) : '…'} ›
                  </button>
                )]),
              ]} />
              {set ? (
                <p class="tally">
                  {guessCount(totalGuesses)} in {clock} on {DIFFICULTY_LABEL[run.difficulty]}.{' '}
                  {placements.crush && <>{placeText(placements.crush)} by fewest guesses (Crush)</>}
                  {placements.crush && placements.rush && ', and '}
                  {placements.rush && <>{placeText(placements.rush)} by fastest time (Rush)</>}
                  {(placements.crush || placements.rush) && <> on today's {DIFFICULTY_LABEL[run.difficulty]} boards. </>}
                  Places are final at midnight New York time. Next set in {nextSet}.
                </p>
              ) : (
                <p class="tally">
                  {guessCount(totalGuesses)} in {clock} on {DIFFICULTY_LABEL[run.difficulty]}.{' '}
                  {placements.crush && <>{placeText(placements.crush)} on today's {DIFFICULTY_LABEL[run.difficulty]} board. </>}
                  Places are final at midnight New York time. Next word in {nextSet}.
                </p>
              )}
            </>
          ) : (
            <p class="tally">
              No place on today's leaderboard. {set ? "The words you didn't find stay" : 'The word stays'} hidden until the day is over.
              Next {next} in {nextSet}.
            </p>
          )}
          <div class="row-btns">
            {late && <button class="btn primary" type="button" onClick={() => load(false)}>Today's {name}</button>}
            <button class={late ? 'btn' : 'btn primary'} type="button" onClick={() => setShowBoard(true)}>Leaderboard</button>
            {run.status === 'finished' && !late && (
              <ShareResult text={dailyShareText({
                mode,
                day: run.day,
                difficulty: run.difficulty,
                words: run.words.map((w) => ({ guesses: w.guesses.length, found: w.outcome === 'solved' })),
                place: placements.crush ? placeText(placements.crush) : null,
              })} />
            )}
            <button class="btn" type="button" onClick={onExit}>Main menu</button>
          </div>
        </section>
      )}

      {howTo && <HowToPlay onClose={() => setHowTo(false)} />}
    </div>
  );
}
