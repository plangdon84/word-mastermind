import type { ComponentChildren } from 'preact';
import type { OpenProfile } from './profilePages';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  createRun, cycleMark, earlierGuess, endRun, giveUpWord, HISTORY_VERSION, pauseRun, PENALTY_GUESSES, pickRunWords, resumeRun,
  PENALTY_SECONDS, rankByName, runElapsedMs, runRankBy, SECRET_WORDS, setRunDifficulty, wordSetName, submitRunGuess, suggestRun, summarizeSoloRun, toRunRecord, wordSeconds,
  marksFitScores, type Difficulty, type Marks, type RankBy, type RunGame,
} from '../game';
import { useCheckLimit } from './checkLimit';
import { InSet, DIFFICULTY_LABEL, STRENGTH_LABEL } from './components';
import { GameHeader, GameMenuItems } from './gameHeader';
import { HowToPlay, ReplaceGamePanel, type Review } from './panels';
import { ShareResult } from './ShareResult';
import { soloRushShareText } from './shareText';
import { formatClock, RushBar, RushBoard, RushDots, RushSummary, RushWords } from './rushParts';
import { BadgeToast } from './Badge';
import { useBadgesEarnedBy } from './badges';
import { NO_GUESSES, useShownMarks } from './easyMarks';
import { NO_SUGGESTION, pickSuggestion, suggestedMessage } from './suggestion';
import { useDefinitions } from './definitions';
import { saveFinishedGame } from './historyDb';
import { useMessage, usePhysicalKeyboard } from './hooks';
import { errorMessage, guessCount, marksCheckMessage, repeatMessage, RUSH_NO_SUGGESTIONS, scoreMessage } from './messages';
import { newId } from './ids';
import { openReport } from './reportIssue';
import { loadRush, saveRush } from './rushStorage';
import type { Profile } from './profileStorage';
import type { Settings } from './settings';
import { shuffleLetters } from './keyboard';

/** How many words a Rush has (README "Rush modes"). */
export const RUSH_WORDS = 4;

/** A solo Rush (or Crush) is only against yourself, so its stopwatch can pause. */
function newRun(difficulty: Difficulty, rankBy: RankBy): RunGame {
  const result = createRun(pickRunWords(SECRET_WORDS, RUSH_WORDS), Date.now(), { pausable: true, difficulty, rankBy });
  if (!result.ok) throw new Error(`Secret list produced an invalid word: ${result.error}`);
  return result.game;
}

/**
 * Solo Rush or Solo Crush: find 4 random words in a row against a stopwatch,
 * ranked by time (Rush) or guesses (Crush). With `resume`, it
 * picks up the saved run in progress; otherwise it starts a new one. The
 * stopwatch pauses while you're away (another tab, the main menu, or the page
 * closed) and when you press Pause.
 */
export function RushScreen({ settings, profile, onProfile, resume, onExit, review }: {
  settings: Settings;
  profile: Profile;
  onProfile: OpenProfile;
  resume: boolean;
  onExit: () => void;
  /**
   * A past Rush, shown read-only until you play again. A Daily Rush or a
   * lobby's run has a `heading` (its mode) and its own result (`result`) in
   * place of Solo Rush's score, and no Play again.
   */
  review?: Review & { id: string; run: RunGame; marks: readonly Marks[]; heading?: string; result?: ComponentChildren };
}) {
  const [reviewing, setReviewing] = useState(review !== undefined);
  const [saved] = useState(() => (review ? { ...review, draft: '' } : resume ? loadRush() : null));
  const [id, setId] = useState(() => saved?.id ?? newId());
  const idRef = useRef(id);
  idRef.current = id;
  const [run, setRunState] = useState<RunGame>(() => saved?.run ?? newRun(settings.difficulty, settings.rankBy));
  const [draft, setDraftState] = useState(saved?.draft ?? '');
  // Preact renders asynchronously, so fast typing can outrun it. Handlers read
  // and write these refs, which always hold the latest run and draft.
  const runRef = useRef(run);
  const draftRef = useRef(draft);
  /** Medium's marks, one set per word. */
  const [marks, setMarks] = useState<readonly Marks[]>(() => saved?.marks ?? run.words.map(() => ({})));
  const marksRef = useRef(marks);
  marksRef.current = marks;
  /** Saves at once, since the page may be closing (the effect below may not run in time). */
  const setRun = (r: RunGame) => {
    runRef.current = r;
    setRunState(r);
    saveRush({ id: idRef.current, run: r, marks: marksRef.current, draft: draftRef.current });
  };
  const setDraft = (d: string) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const [message, setMessage] = useMessage();
  const [shake, setShake] = useState(false);
  const [confirming, setConfirming] = useState<'give-up' | 'move-on' | 'new-game' | 'replace' | null>(null);
  const [openDef, setOpenDef] = useState(-1);
  const [howTo, setHowTo] = useState(false);
  const [now, setNow] = useState(Date.now);
  /** Paused because the page was hidden, so showing it again resumes. A Pause press waits for Resume. */
  const autoPaused = useRef(false);

  const over = run.status === 'over';
  const paused = run.pausedAt !== null;
  const difficulty = run.playingDifficulty;
  const medium = difficulty === 'medium';
  // Easy and Medium: the Shuffle key reorders the typed letters, whenever the letter keys would type.
  const shuffle = difficulty === 'easy' || medium
    ? () => {
      if (playing()) setDraft(shuffleLetters(draftRef.current));
    }
    : undefined;
  const word = run.results[run.current];
  const wordMarks = marks[run.current] ?? {};
  const checks = useCheckLimit(`rush:${id}:${run.current}`);
  const shownMarks = useShownMarks(difficulty, wordMarks, word?.guesses ?? NO_GUESSES);
  const definitions = useDefinitions(openDef >= 0 || over);

  // A reviewed Rush is already saved, and must not replace the Rush in progress.
  useEffect(() => {
    if (!reviewing) saveRush({ id, run, marks, draft });
  }, [reviewing, id, run, marks, draft]);
  useEffect(() => {
    if (over && !reviewing) {
      const entry = { id, version: HISTORY_VERSION, mode: 'rush' as const, record: toRunRecord(run), marks };
      void saveFinishedGame(entry, profile.memberSince);
    }
  }, [reviewing, over, id, run, marks, profile.memberSince]);
  const newBadges = useBadgesEarnedBy(over && !reviewing ? id : null);

  // A difficulty change mid-Rush is recorded; going easier lowers the difficulty it's scored at.
  const changeDifficulty = (d: Difficulty) => {
    const current = runRef.current;
    const result = setRunDifficulty(current, d, Date.now());
    if (!result.ok) return;
    setRun(result.game);
    if (result.game.scoredDifficulty !== current.scoredDifficulty) {
      setMessage({
        text: `This ${rankByName(runRankBy(result.game))} will now be scored at ${DIFFICULTY_LABEL[result.game.scoredDifficulty]}.`,
        error: false,
      });
    }
  };
  // In ☰ and on the header's difficulty bubble: once a word has a guess, only easier levels.
  const difficultyChoice = over ? undefined
    : { onDifficulty: changeDifficulty, guessed: run.results.some((r) => r.guesses.length > 0) };
  const markLetter = (letter: string) =>
    setMarks(marks.map((m, i) => (i === run.current ? cycleMark(m, letter) : m)));

  // The stopwatch ticks while the run is on.
  useEffect(() => {
    if (over || paused) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [over, paused]);

  const pause = (auto: boolean) => {
    const result = pauseRun(runRef.current, Date.now());
    if (!result.ok) return;
    autoPaused.current = auto;
    setRun(result.game);
  };
  const resumeClock = () => {
    const result = resumeRun(runRef.current, Date.now());
    if (!result.ok) return;
    autoPaused.current = false;
    setNow(Date.now());
    setRun(result.game);
  };

  // Pause while the page is hidden or closed, and resume on return unless
  // Pause was pressed. Leaving the screen (main menu) pauses too.
  useLayoutEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') pause(true);
      else if (autoPaused.current) resumeClock();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onVisibility);
      pause(false);
    };
  }, []);

  const reject = (text: string) => {
    setMessage({ text, error: true });
    setShake(true);
  };

  const playing = () => runRef.current.status === 'playing' && runRef.current.pausedAt === null && !confirming;
  const typeLetter = (letter: string) => {
    if (playing() && draftRef.current.length < 5) setDraft(draftRef.current + letter);
  };
  const backspace = () => {
    if (playing()) setDraft(draftRef.current.slice(0, -1));
  };

  /** After a word ends: say what happened. The next word has its own marks. */
  const nextWord = (next: RunGame, text: string) => {
    setOpenDef(-1);
    setDraft('');
    setMessage(next.status === 'playing'
      ? { text: `${text} Word ${next.current + 1} of ${next.words.length}.`, error: false }
      : null);
  };

  const enter = () => {
    if (!playing()) return;
    const before = runRef.current;
    // Only this word's guesses count: each word starts a fresh list.
    const repeat = earlierGuess(before.results[before.current].guesses, draftRef.current);
    if (repeat) {
      reject(repeatMessage(draftRef.current, repeat, before.playingDifficulty));
      return;
    }
    const result = submitRunGuess(before, draftRef.current, Date.now());
    if (!result.ok) {
      reject(errorMessage(result.error, draftRef.current));
      return;
    }
    setRun(result.game);
    setDraft('');
    const played = result.game.results[before.current];
    const latest = played.guesses[played.guesses.length - 1];
    if (latest.isWin) nextWord(result.game, `Found ${latest.guess.toUpperCase()} in ${guessCount(played.guesses.length)}.`);
    else setMessage({ text: scoreMessage(latest), error: false, quiet: true });
  };

  /** Easy's Suggest: fills the input with a word that fits this word's scores, and records it. */
  const suggest = () => {
    if (!playing()) return;
    const before = runRef.current;
    const word = pickSuggestion(before.results[before.current].guesses);
    if (!word) {
      setMessage({ text: NO_SUGGESTION, error: true });
      return;
    }
    const result = suggestRun(before, word, Date.now());
    if (!result.ok) {
      reject(result.error === 'no-suggestions' ? RUSH_NO_SUGGESTIONS : errorMessage(result.error, word));
      return;
    }
    setRun(result.game);
    setDraft(word);
    setMessage({ text: suggestedMessage(word), error: false });
  };

  usePhysicalKeyboard({ onLetter: typeLetter, onEnter: enter, onBackspace: backspace });

  /** Play again: at the difficulty the last Rush ended at, ranked the same way. */
  const startNewRun = () => {
    autoPaused.current = false;
    setReviewing(false);
    const next = newRun(runRef.current.playingDifficulty, runRankBy(runRef.current));
    const nextMarks = next.words.map(() => ({}));
    idRef.current = newId();
    marksRef.current = nextMarks;
    setId(idRef.current);
    setMarks(nextMarks);
    setRun(next);
    setNow(Date.now());
    setDraft('');
    setOpenDef(-1);
    setConfirming(null);
    setMessage({ text: `New ${wordSetName('solo', runRankBy(next))}: find ${RUSH_WORDS} words. The clock is running.`, error: false });
  };

  /** From a review, a new Rush would replace the one in progress, so that's confirmed first. */
  const playAgain = () => {
    if (reviewing && loadRush()?.run.status === 'playing') setConfirming('replace');
    else startNewRun();
  };

  // Only a run with guesses in it is worth confirming before it's thrown away.
  const requestNewRun = () => {
    const current = runRef.current;
    if (current.status === 'playing' && current.results.some((r) => r.guesses.length > 0)) {
      setConfirming('new-game');
    } else {
      playAgain();
    }
  };

  const confirmGiveUp = () => {
    const result = endRun(runRef.current, Date.now());
    if (result.ok) {
      setRun(result.game);
      setOpenDef(-1);
    }
    setConfirming(null);
  };

  const confirmMoveOn = () => {
    const before = runRef.current;
    const result = giveUpWord(before, Date.now());
    if (result.ok) {
      setRun(result.game);
      nextWord(result.game, `The word was ${before.words[before.current].toUpperCase()}.`);
    }
    setConfirming(null);
  };

  const summary = summarizeSoloRun(run);
  const rankBy = runRankBy(run);
  const name = wordSetName('solo', rankBy);
  const givenUp = run.results.filter((r) => r.outcome === 'gave-up').length;
  const ended = run.results.some((r) => r.outcome === 'unsolved');
  const clock = formatClock(runElapsedMs(run, now) / 1000);

  return (
    <div class="app">
      <GameHeader profile={profile} onHome={onExit} onProfile={onProfile} difficulty={difficulty} difficultyChoice={difficultyChoice}
        review={reviewing ? review : null} suggested={run.results.reduce((n, r) => n + r.suggested, 0)}
        matchup={
          <span>
            <b>{review?.heading ?? name}</b>
            {!over && <> · Word {run.current + 1} of {run.words.length}</>}
          </span>
        }
        menu={(close) => (
          <GameMenuItems close={close} onNewGame={requestNewRun}
            difficulty={difficulty} {...difficultyChoice}
            difficultyNote={over ? undefined
              : `Scored at the easiest difficulty used: ${DIFFICULTY_LABEL[run.scoredDifficulty]} so far.`}
            moveOnLabel="Give up this word and move on" onMoveOn={over ? undefined : () => setConfirming('move-on')}
            giveUpLabel="Give up and reveal the words" canGiveUp={!over}
            onGiveUp={() => setConfirming('give-up')} onExit={onExit} onHowToPlay={() => setHowTo(true)}
            onReport={() => openReport({
              screen: `${name} · ${DIFFICULTY_LABEL[difficulty]}${reviewing ? ' · reviewing a past game' : ''}`,
              record: toRunRecord(runRef.current),
            })}
            onCheckMarks={medium && !over && !paused
              ? () => checks.use() && setMessage(marksCheckMessage(marksFitScores(wordMarks, word.guesses))) : undefined}
            checksLeft={checks.left}
            onClearMarks={medium && !over && !paused
              ? () => setMarks(marks.map((m, i) => (i === run.current ? {} : m))) : undefined} />
        )}>
        {/* A word left when the Rush was given up stays an empty dot. */}
        <RushBar clock={clock} clockLabel={paused ? `Time, paused: ${clock}` : 'Time'} paused={paused}
          dots={<RushDots words={run.results.map((r) => ({ outcome: r.outcome === 'unsolved' ? null : r.outcome }))}
            current={run.current} />}>
          {!over && (
            <button type="button" class="btn small" disabled={!!confirming}
              onClick={() => (paused ? resumeClock() : pause(false))}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}
        </RushBar>
        {shownMarks && !over && !paused && <InSet marks={shownMarks} />}
      </GameHeader>


      {/* While paused the board is hidden, so the pause can't be used to think. */}
      {!over && paused && (
        <section class="panel">
          <h2>Paused</h2>
          <p>The clock stops while you're away. Your guesses are hidden until you resume.</p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={resumeClock}>Resume</button>
          </div>
        </section>
      )}

      {!over && !paused && (
        <RushBoard difficulty={difficulty} guesses={word.guesses} newestFirst={settings.newestFirst[difficulty]}
          label={`Your guesses at word ${run.current + 1}`}
          emptyText={run.current === 0
            ? 'No guesses yet. Type a 5-letter word and press Enter.'
            : `Word ${run.current + 1}: no guesses yet.`}
          marks={shownMarks} onMark={medium ? markLetter : undefined}
          openDef={openDef} onToggleDef={(i) => setOpenDef(openDef === i ? -1 : i)} definitions={definitions}
          entry={!confirming} draft={draft} shake={shake} onShakeEnd={() => setShake(false)} message={message}
          suggested={word.suggested} onSuggest={reviewing ? undefined : suggest}
          onShuffle={shuffle} onLetter={typeLetter} onEnter={enter} onBackspace={backspace} />
      )}

      {confirming === 'move-on' && !over && (
        <section class="panel warning">
          <h2>Give up this word and move on?</h2>
          <p>
            <b>This will hurt your score.</b> The word counts as your worst word found in this {rankByName(rankBy)}
            plus {PENALTY_GUESSES} guesses{rankBy === 'rush' && <> and {PENALTY_SECONDS / 60} minutes</>}, and at least
            the guesses and time you've spent on it. The clock keeps running.
          </p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={confirmMoveOn}>Give up this word</button>
            <button class="btn" type="button" onClick={() => setConfirming(null)}>Keep playing</button>
          </div>
        </section>
      )}

      {confirming === 'give-up' && !over && (
        <section class="panel">
          <h2>End this {rankByName(rankBy)} and reveal the words?</h2>
          <p>A {rankByName(rankBy)} you give up doesn't get a score.</p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={confirmGiveUp}>Reveal the words</button>
            <button class="btn" type="button" onClick={() => setConfirming(null)}>Keep playing</button>
          </div>
        </section>
      )}

      {confirming === 'new-game' && !over && (
        <section class="panel">
          <h2>Start a new {rankByName(rankBy)}?</h2>
          <p>This one will end without revealing the words.</p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={startNewRun}>New {rankByName(rankBy)}</button>
            <button class="btn" type="button" onClick={() => setConfirming(null)}>Keep playing</button>
          </div>
        </section>
      )}

      {confirming === 'replace' && (
        <ReplaceGamePanel what={`a ${rankByName(rankBy)}`} onConfirm={startNewRun} onCancel={() => setConfirming(null)} />
      )}

      {over && confirming !== 'replace' && (
        <section class="panel rush-result">
          <h2>
            {ended ? 'The words were'
              : givenUp === 0 ? `All ${run.words.length} words in ${clock}.`
                : `${rankByName(rankBy)} done in ${clock}.`}
          </h2>
          <RushWords marks={marks} newestFirst={settings.newestFirst[difficulty]} definitions={definitions}
            rows={run.results.map((r) => ({
              word: r.word,
              lit: r.outcome === 'solved',
              guesses: r.guesses,
              reached: r.startedAt !== null,
              missed: r.outcome === 'solved' ? null : r.outcome === 'gave-up' ? 'Gave up' : 'Not found',
              seconds: wordSeconds(r),
            }))} />
          {review?.heading ? review.result : summary && (
            <RushSummary tiers={[
              ['Score', rankBy === 'rush' ? formatClock(summary.score) : summary.score.toFixed(1)],
              ['Your level', STRENGTH_LABEL[summary.level]],
            ]} />
          )}
          {review?.heading ? null : summary && rankBy === 'rush' ? (
            <p class="tally">
              {/* A Rush is scored by time: the average a word, × the difficulty factor where it isn't 1. */}
              {summary.factor !== 1 && <>
                {formatClock(summary.average.seconds)} a word × {summary.factor}{' '}
                ({DIFFICULTY_LABEL[summary.difficulty]}) = {formatClock(summary.score)}.{' '}
              </>}
              Faster is better.{' '}
              {guessCount(summary.words.reduce((sum, w) => sum + w.guesses, 0))} in {formatClock(summary.totalSeconds)}
              {summary.factor === 1 && <> · {formatClock(summary.average.seconds)} and {summary.average.guesses.toFixed(1)} guesses a word</>}
              {summary.factor !== 1 && <> · {summary.average.guesses.toFixed(1)} guesses a word</>}
              {givenUp > 0 && <>, including a penalty for {givenUp === 1 ? 'the word' : `${givenUp} words`} given up</>}.
            </p>
          ) : review?.heading ? null : summary ? (
            <p class="tally">
              {/* The sum only where the difficulty changes the number: at Medium the score is the average. */}
              {summary.factor !== 1 && <>
                {summary.average.guesses.toFixed(1)} guesses a word × {summary.factor}{' '}
                ({DIFFICULTY_LABEL[summary.difficulty]}) = {summary.score.toFixed(1)}.{' '}
              </>}
              Lower is better.{' '}
              {guessCount(summary.words.reduce((sum, w) => sum + w.guesses, 0))} in {formatClock(summary.totalSeconds)}
              {summary.factor === 1 && <> · {summary.average.guesses.toFixed(1)} guesses and {formatClock(summary.average.seconds)} a word</>}
              {summary.factor !== 1 && <> · {formatClock(summary.average.seconds)} a word</>}
              {givenUp > 0 && <>, including a penalty for {givenUp === 1 ? 'the word' : `${givenUp} words`} given up</>}.
            </p>
          ) : (
            <p class="tally">{ended ? `No score: this ${rankByName(rankBy)} was given up.` : 'No score: no words were found.'}</p>
          )}
          <BadgeToast badges={newBadges} onOpen={onProfile} />
          <div class="row-btns">
            {!review?.heading && <button class="btn primary" type="button" onClick={playAgain}>Play again</button>}
            {!reviewing && summary && (
              <ShareResult text={soloRushShareText({
                difficulty: summary.difficulty,
                rankBy,
                words: run.results.map((r) => ({ guesses: r.guesses.length, found: r.outcome === 'solved' })),
                score: summary.score,
                level: summary.level,
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
