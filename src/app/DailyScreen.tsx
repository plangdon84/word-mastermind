import type { OpenProfile } from './profilePages';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  addDays, betterThan, cycleMark, DIFFICULTIES, earlierGuess, marksFitScores, ordinal, validateGuess, type DailyDay,
  type Difficulty, type Marks,
} from '../game';
import { useCheckLimit } from './checkLimit';
import type { ApiIdentity } from './apiIdentity';
import { Bubble, DIFFICULTY_LABEL, InSet } from './components';
import { GameHeader, GameMenuItems } from './gameHeader';
import { BoardPage, HowToPlay } from './panels';
import { API_URL } from './config';
import { dailyApi, DailyApiError, type DailyApi, type DailyBoard, type DailyToday } from './dailyApi';
import type { Circle } from './leaderboardsApi';
import { receivePlacements } from './badges';
import { loadDaily, saveDaily } from './dailyStorage';
import { NO_GUESSES, useShownMarks } from './easyMarks';
import { NO_SUGGESTION, pickSuggestion, suggestedMessage } from './suggestion';
import { useDefinitions } from './definitions';
import { useMessage, useNow, usePhysicalKeyboard } from './hooks';
import { countdownText, dailyErrorMessage, errorMessage, guessCount, marksCheckMessage, repeatMessage, scoreMessage } from './messages';
import { displayName, type Profile } from './profileStorage';
import { openReport } from './reportIssue';
import { formatClock, RushBar, RushBoard, RushDots, RushSummary, RushWords, spentSeconds } from './rushParts';
import type { Settings } from './settings';
import { shuffleLetters } from './keyboard';
import { ShareResult } from './ShareResult';
import { dailyShareText } from './shareText';


/** The server's refusal code, or `unreachable`. */
const codeOf = (e: unknown) => (e instanceof DailyApiError ? e.code : 'unreachable');


/** Your place: "12th of 340 · better than 96%". */
export function placeText(p: { rank: number; total: number; behind: number }): string {
  const better = betterThan(p);
  return `${ordinal(p.rank)} of ${p.total}${better === null ? '' : ` · better than ${better}%`}`;
}

/**
 * A day's leaderboard for one difficulty, with the days before it a tap
 * away: everyone's, or (signed in) you and your friends'. Today's is
 * provisional until midnight New York time.
 */
export function DailyBoardPanel({ api, today, day: firstDay, difficulty: firstDifficulty, circle }: {
  api: DailyApi;
  today: DailyDay;
  day: DailyDay;
  difficulty: Difficulty;
  circle: Circle;
}) {
  const [day, setDay] = useState(firstDay);
  const [difficulty, setDifficulty] = useState(firstDifficulty);
  const [board, setBoard] = useState<DailyBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The earliest day with a Daily Rush, once a day before it turns out to have none. */
  const [first, setFirst] = useState<DailyDay | null>(null);
  useEffect(() => {
    let live = true;
    setBoard(null);
    setError(null);
    api.board(day, difficulty, circle).then((b) => live && setBoard(b), (e: unknown) => {
      if (!live) return;
      const code = codeOf(e);
      if (code === 'not-found' && day < today) setFirst(addDays(day, 1));
      setError(dailyErrorMessage(code));
    });
    return () => {
      live = false;
    };
  }, [api, day, difficulty, circle]);
  const dayLabel = new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
  const youShown = board?.top.some((r) => r.you);
  return (
    <section class="panel daily-board" aria-label="Daily Rush leaderboard">
      <div class="board-day">
        <button type="button" class="btn small" aria-label="The day before" disabled={first !== null && day <= first}
          onClick={() => setDay(addDays(day, -1))}>‹</button>
        <h2>{day === today ? 'Today' : dayLabel}</h2>
        <button type="button" class="btn small" aria-label="The day after" disabled={day >= today}
          onClick={() => setDay(addDays(day, 1))}>›</button>
      </div>
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
          <p class="board-theme"><b>{board.theme}</b></p>
          {board.words && (
            <p class="board-words" aria-label={`The words: ${board.words.join(', ')}`}>
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
                  <span class="board-name">{r.name}{r.you && <span class="visually-hidden"> (you)</span>}</span>
                  <span class="board-guesses">{r.guesses}</span>
                  <span class="board-time">{formatClock(r.ms / 1000)}</span>
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
 * Daily Rush: the day's themed set of 4 words, refereed by the server, once
 * a day. With `start`, it starts today's run at your difficulty if you
 * haven't played yet. The clock never pauses.
 */
export function DailyScreen({ settings, profile, identity, onProfile, onExit, start }: {
  settings: Settings;
  profile: Profile;
  identity: ApiIdentity;
  onProfile: OpenProfile;
  onExit: () => void;
  start: boolean;
}) {
  const api = useMemo(() => dailyApi(API_URL ?? '', identity), [identity]);
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
  const [placement, setPlacement] = useState<DailyBoard['you']>(null);
  const [openDef, setOpenDef] = useState(-1);
  const [howTo, setHowTo] = useState(false);
  const localNow = useNow(1000);
  const now = localNow + offset;

  const run = today?.run ?? null;
  const playing = run?.status === 'playing';
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
  const checks = useCheckLimit(`daily:${today?.day}:${run?.current}`);
  const shownMarks = useShownMarks(difficulty, wordMarks, word?.guesses ?? NO_GUESSES);
  const definitions = useDefinitions(openDef >= 0 || (run !== null && !playing));

  const setToday = (t: DailyToday) => {
    todayRef.current = t;
    setTodayState(t);
    setOffset(t.now - Date.now());
    receivePlacements(t.placements);
  };
  const setDraft = (d: string) => {
    draftRef.current = d;
    setDraftState(d);
  };

  const load = () => {
    setLoadError(null);
    api.today().then(async (t) => {
      const saved = loadDaily();
      setMarks(saved?.day === t.day ? saved.marks : []);
      if (t.run || !start || !t.theme) {
        setToday(t);
        return;
      }
      setToday(await api.start(t.day, settings.difficulty, displayName(profile)));
    }).catch((e: unknown) => setLoadError(dailyErrorMessage(codeOf(e))));
  };
  useEffect(load, []);

  // Medium's marks stay on this device, as does whether a reload should come back here.
  useEffect(() => {
    if (today?.run) saveDaily({ day: today.day, playing: today.run.status === 'playing', marks });
  }, [today, marks]);

  // Once you've finished, your place so far.
  useEffect(() => {
    if (!today || run?.status !== 'finished') return;
    let live = true;
    api.board(today.day, run.difficulty).then((b) => live && setPlacement(b.you), () => {});
    return () => {
      live = false;
    };
  }, [today?.day, run?.status]);

  const reject = (text: string) => {
    setMessage({ text, error: true });
    setShake(true);
  };
  const canType = () => todayRef.current?.run?.status === 'playing' && !confirming && !showBoard;
  const typeLetter = (letter: string) => {
    if (canType() && draftRef.current.length < 5) setDraft(draftRef.current + letter);
  };
  const backspace = () => {
    if (canType()) setDraft(draftRef.current.slice(0, -1));
  };

  /** The day ended mid-run: that run is void, and today's set is out. */
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
      const after = await api.guess(before.day, guess);
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
      setToday(await api.suggest(before.day, word));
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

  const confirmGiveUp = () => {
    setConfirming(false);
    const day = todayRef.current?.day;
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

  const lastEnd = run ? Math.max(run.startedAt, ...run.words.map((w) => w.endedAt ?? run.startedAt)) : 0;
  const clock = run ? formatClock(((playing ? now : lastEnd) - run.startedAt) / 1000) : '0:00';
  const nextSet = today ? countdownText(today.nextAt - now) : '';
  const totalGuesses = run ? run.words.reduce((sum, w) => sum + w.guesses.length, 0) : 0;

  const header = (
    <GameHeader profile={profile} onHome={onExit} onProfile={onProfile} difficulty={difficulty}
      matchup={
        <span>
          <b>Daily Rush</b>
          {today?.theme && <> · {today.theme}</>}
        </span>
      }
      menu={(close) => (
        <GameMenuItems close={close} difficulty={difficulty}
          difficultyNote="Chosen for today's Daily Rush: it can't change."
          giveUpLabel="Give up today's Daily Rush" canGiveUp={playing}
          onGiveUp={() => setConfirming(true)} onExit={onExit} onHowToPlay={() => setHowTo(true)}
          onReport={() => openReport({
            screen: `Daily Rush · ${today?.day ?? 'loading'} · ${DIFFICULTY_LABEL[difficulty]}`,
          })}
          onCheckMarks={medium && word
            ? () => checks.use() && setMessage(marksCheckMessage(marksFitScores(wordMarks, word.guesses))) : undefined}
          checksLeft={checks.left}
          onClearMarks={medium && word && run
            ? () => setMarks(run.words.map((_, i) => (i === run.current ? {} : marks[i] ?? {}))) : undefined} />
      )}>
      {run && (
        <RushBar dots={<RushDots words={run.words} current={playing ? run.current : null} />} clock={clock} clockLabel="Time" />
      )}
      {shownMarks && word && <InSet marks={shownMarks} />}
    </GameHeader>
  );

  if (loadError || !today) {
    return (
      <div class="app">
        {header}
        <section class="panel">
          {loadError ? (
            <>
              <h2>Daily Rush</h2>
              <p>{loadError}</p>
              <div class="row-btns">
                <button class="btn primary" type="button" onClick={load}>Try again</button>
                <button class="btn" type="button" onClick={onExit}>Main menu</button>
              </div>
            </>
          ) : <p>Loading today's Daily Rush…</p>}
        </section>
      </div>
    );
  }

  if (showBoard) {
    return (
      <BoardPage title="Daily Rush" onBack={() => setShowBoard(false)} circle={identity.token ? circle : null}
        onCircle={setCircle}>
        <DailyBoardPanel api={api} today={today.day} day={today.day} difficulty={difficulty}
          circle={identity.token ? circle : 'everyone'} />
      </BoardPage>
    );
  }

  return (
    <div class="app">
      {header}

      {!run && (
        <section class="panel">
          {today.theme ? (
            <>
              <h2>Today: {today.theme}</h2>
              <p>
                4 words on today's theme, once. You'll play at <b>{DIFFICULTY_LABEL[settings.difficulty]}</b>, which
                can't change once you start, and the clock doesn't pause. Next set in {nextSet}.
              </p>
              <div class="row-btns">
                <button class="btn primary" type="button" onClick={() => {
                  api.start(today.day, settings.difficulty, displayName(profile))
                    .then(setToday, (e: unknown) => setMessage({ text: dailyErrorMessage(codeOf(e)), error: true }));
                }}>Start Daily Rush</button>
                <button class="btn" type="button" onClick={() => setShowBoard(true)}>Leaderboard</button>
                <button class="btn" type="button" onClick={onExit}>Main menu</button>
              </div>
            </>
          ) : (
            <>
              <h2>No Daily Rush today</h2>
              <p>There's no themed set today. Try Solo Rush instead.</p>
              <div class="row-btns"><button class="btn" type="button" onClick={onExit}>Main menu</button></div>
            </>
          )}
          {message && <p class="message error" role="status">{message.text}</p>}
        </section>
      )}

      {run && word && (
        <RushBoard difficulty={difficulty} guesses={word.guesses} newestFirst={settings.newestFirst[difficulty]}
          label={`Your guesses at word ${run.current + 1}`}
          emptyText={run.current === 0
            ? `Today's theme: ${today.theme}. Type a 5-letter word and press Enter.`
            : `Word ${run.current + 1}: no guesses yet.`}
          marks={shownMarks} onMark={medium ? markLetter : undefined}
          openDef={openDef} onToggleDef={(i) => setOpenDef(openDef === i ? -1 : i)} definitions={definitions}
          entry={!confirming} draft={draft} shake={shake} onShakeEnd={() => setShake(false)} message={message}
          suggested={word.suggested} onSuggest={() => void suggest()}
          onShuffle={shuffle} onLetter={typeLetter} onEnter={() => void enter()} onBackspace={backspace} />
      )}

      {confirming && playing && (
        <section class="panel warning">
          <h2>Give up today's Daily Rush?</h2>
          <p>
            <b>You won't be on today's leaderboard</b>, and you can't play again until the next set, in {nextSet}.
            Giving up one word gives up the whole Daily Rush.
          </p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={confirmGiveUp}>Give up</button>
            <button class="btn" type="button" onClick={() => setConfirming(false)}>Keep playing</button>
          </div>
        </section>
      )}

      {run && !playing && (
        <section class="panel rush-result">
          <h2>{run.status === 'finished' ? `All 4 words in ${clock}.` : "You gave up today's Daily Rush."}</h2>
          <RushWords marks={marks} newestFirst={settings.newestFirst[difficulty]} definitions={definitions}
            hiddenLabel="Hidden until tomorrow"
            rows={run.words.map((w) => ({
              word: w.word,
              lit: w.word !== null,
              guesses: w.guesses,
              reached: w.startedAt !== null,
              missed: w.outcome === 'solved' ? null : 'Not found',
              seconds: spentSeconds(w),
            }))} />
          {run.status === 'finished' ? (
            <>
              <RushSummary tiers={[['Guesses', totalGuesses], ['Place so far', placement ? ordinal(placement.rank) : '…']]} />
              <p class="tally">
                {guessCount(totalGuesses)} in {clock} on {DIFFICULTY_LABEL[run.difficulty]}.{' '}
                {placement && <>{placeText(placement)} on today's {DIFFICULTY_LABEL[run.difficulty]} leaderboard. </>}
                Places are final at midnight New York time. Next set in {nextSet}.
              </p>
            </>
          ) : (
            <p class="tally">
              No place on today's leaderboard. The words you didn't find stay hidden until the day is over.
              Next set in {nextSet}.
            </p>
          )}
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={() => setShowBoard(true)}>Leaderboard</button>
            {run.status === 'finished' && (
              <ShareResult text={dailyShareText({
                day: run.day,
                difficulty: run.difficulty,
                words: run.words.map((w) => ({ guesses: w.guesses.length, found: w.outcome === 'solved' })),
                place: placement ? placeText(placement) : null,
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
