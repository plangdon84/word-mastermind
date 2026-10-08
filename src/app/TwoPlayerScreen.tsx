import type { OpenProfile } from './profilePages';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  canPlayOn, concede, createTwoPlayerGame, cycleMark, earlierGuess, HISTORY_VERSION, isTwoPlayerOver, pickComputerGuess, pickFirstSide, pickRandomSecret,
  SECRET_WORDS, setTwoPlayerDifficulty, submitTurn, FEATURES, SUGGEST_LIMIT, suggestTwoPlayer, toTwoPlayerRecord, whoseTurn,
  marksFitScores, type Difficulty, type GuessResult, type Marks, type Strength, type TwoPlayerGame,
} from '../game';
import { useCheckLimit } from './checkLimit';
import {
  Bubble, DefinitionBox, DIFFICULTY_LABEL, History, InSet, Keyboard, ScoreHistory, Slots, STRENGTH_LABEL,
  SuggestButton, YourWord,
} from './components';
import { GameHeader, GameMenuItems } from './gameHeader';
import { ResultCard, TheirWord } from './resultCard';
import { BackIcon, HowToPlay, ReplaceGamePanel, type Review } from './panels';
import { BadgeToast, SuggestNote } from './Badge';
import { NO_SUGGESTION, pickSuggestion, suggestedMessage } from './suggestion';
import { useBadgesEarnedBy } from './badges';
import { NO_GUESSES, useOpponentMarks, useShownMarks } from './easyMarks';
import { useDefinitions } from './definitions';
import { gameSource } from './gameSource';
import { saveFinishedGame } from './historyDb';
import { useMessage, usePhysicalKeyboard } from './hooks';
import { errorMessage, guessCount, marksCheckMessage, repeatMessage, scoreMessage, secretErrorMessage } from './messages';
import { newId } from './ids';
import { openReport } from './reportIssue';
import { addRecentSecret, loadRecentSecrets, saveRecentSecrets } from './recentSecrets';
import type { Profile } from './profileStorage';
import type { Settings } from './settings';
import { clearTwoPlayer, loadTwoPlayer, saveTwoPlayer } from './twoPlayerStorage';
import { shuffleLetters } from './keyboard';
import { ShareResult } from './ShareResult';
import { twoPlayerShareText } from './shareText';
import { PlayOnChoice, PracticeEntry, PracticeLine, usePlayOn } from './playOn';

/** How long the computer "thinks" before guessing, so its move is visible. */
const THINK_MS = 800;
/** Longer on its final guess, to hold the suspense. */
const FINAL_THINK_MS = 2000;

/** How the game ended, from the human's point of view. See README "Final guess and draws". */
type Outcome =
  | 'won' // you found it first, going second
  | 'won-held' // you found it first, then the computer's final guess missed
  | 'lost' // the computer found it first, going second
  | 'lost-final' // the computer found it first, then your final guess missed
  | 'clutch' // your final guess found it: a draw
  | 'tied' // the computer's final guess found it: a draw
  | 'gave-up';

function outcomeOf(game: TwoPlayerGame): Outcome | null {
  switch (game.status) {
    case 'human-won': return game.first === 'human' ? 'won-held' : 'won';
    case 'computer-won': return game.first === 'computer' ? 'lost-final' : 'lost';
    case 'draw': return game.first === 'computer' ? 'clutch' : 'tied';
    case 'gave-up': return 'gave-up';
    default: return null;
  }
}

const upper = (word: string) => word.toUpperCase();

/** A confetti burst for the clutch draw. CSS only; hidden under reduced motion. */
function Confetti() {
  const colors = ['var(--in-bg)', 'var(--accent)', '#F2B705', '#E4572E', 'var(--ink)'];
  return (
    <div class="confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => (
        <span key={i} style={{
          '--x': `${(i * 37) % 100}vw`,
          '--drift': `${((i * 53) % 40) - 20}vw`,
          '--delay': `${(i % 9) * 70}ms`,
          '--spin': `${(i % 2 ? 1 : -1) * (360 + (i * 47) % 360)}deg`,
          background: colors[i % colors.length],
        }} />
      ))}
    </div>
  );
}

/**
 * Two player vs. the computer: choose your secret word, then take turns
 * guessing each other's. With `resume`, it picks up the saved game in progress.
 */
export function TwoPlayerScreen({ settings, profile, onProfile, resume, onExit, review }: {
  settings: Settings;
  profile: Profile;
  onProfile: OpenProfile;
  resume: boolean;
  onExit: () => void;
  /** A past game, shown read-only until you play again. */
  review?: Review & { id: string; game: TwoPlayerGame; marks: Marks };
}) {
  const [reviewing, setReviewing] = useState(review !== undefined);
  const [saved] = useState(() => (review ? { ...review, draft: '' } : resume ? loadTwoPlayer() : null));
  const [id, setId] = useState(() => saved?.id ?? newId());
  /** Null while you choose your secret word. */
  const [game, setGameState] = useState<TwoPlayerGame | null>(saved?.game ?? null);
  /** For the next game; a game in progress keeps its own. */
  const [strength, setStrength] = useState<Strength>(saved?.game.strength ?? settings.strength);
  const [nextDifficulty, setNextDifficulty] = useState<Difficulty>(saved?.game.playingDifficulty ?? settings.difficulty);
  const [draft, setDraftState] = useState(saved?.draft ?? '');
  // Preact renders asynchronously, so fast typing can outrun it. Handlers read
  // and write these refs, which always hold the latest game and draft.
  const gameRef = useRef(game);
  const draftRef = useRef(draft);
  const setGame = (g: TwoPlayerGame | null) => {
    gameRef.current = g;
    setGameState(g);
  };
  const setDraft = (d: string) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const [marks, setMarks] = useState<Marks>(saved?.marks ?? {});
  const [message, setMessage] = useMessage();
  const [shake, setShake] = useState(false);
  const [confirming, setConfirming] = useState<'give-up' | 'new-game' | 'replace' | null>(null);
  const [tab, setTab] = useState<'you' | 'computer'>('you');
  /** How many of the computer's guesses you've seen on its tab. */
  const [seen, setSeen] = useState(saved?.game.computerGuesses.length ?? 0);
  const [openYou, setOpenYou] = useState(-1);
  const [openComputer, setOpenComputer] = useState(-1);
  const [howTo, setHowTo] = useState(false);
  /** Your last 10 secret words, newest first, offered while choosing a new one. */
  const [recent, setRecent] = useState(loadRecentSecrets);

  const turn = game ? whoseTurn(game) : null;
  const over = game !== null && turn === null;
  const outcome = game ? outcomeOf(game) : null;
  const difficulty = game?.playingDifficulty ?? nextDifficulty;
  const medium = difficulty === 'medium';
  // Easy and Medium: the Shuffle key reorders the typed letters, whenever the letter keys would type.
  const shuffle = difficulty === 'easy' || medium
    ? () => {
      if (typing()) setDraft(shuffleLetters(draftRef.current));
    }
    : undefined;
  // A loss where you never found its word can be played on, for practice (README "Play on after a loss").
  const lost = outcome === 'lost' || outcome === 'lost-final' || outcome === 'gave-up';
  const playOn = usePlayOn(`computer:${id}`, over ? game.computerSecret : null,
    over && !reviewing && canPlayOn(lost, game.humanGuesses), marks);
  const practising = playOn.stage === 'playing';
  const checks = useCheckLimit(`computer:${id}`);
  /** Your board: the game's guesses, then any practice ones. */
  const yourGuesses = useMemo(
    (): readonly GuessResult[] => (playOn.guesses.length > 0 ? [...game!.humanGuesses, ...playOn.guesses] : game?.humanGuesses ?? []),
    [game, playOn.guesses],
  );
  const shownMarks = useShownMarks(difficulty, playOn.practised ? playOn.marks : marks, yourGuesses);
  // The computer's board shows Easy's marks: what its scores prove (README "Two player vs. computer").
  const computerMarks = useOpponentMarks('easy', null, game?.computerGuesses ?? NO_GUESSES);
  const finalGuess = game?.status === 'final-guess';
  const yourLastChance = finalGuess && turn === 'human';
  const definitions = useDefinitions(openYou >= 0 || openComputer >= 0 || over);

  // A reviewed game is already saved, and must not replace the game in progress.
  useEffect(() => {
    if (game && !reviewing) saveTwoPlayer({ id, game, marks, draft });
  }, [reviewing, id, game, marks, draft]);
  // A finished game goes into your history, and is saved again if you change its marks afterwards.
  useEffect(() => {
    if (game && over && !reviewing) {
      const entry = { id, version: HISTORY_VERSION, mode: 'computer' as const, record: toTwoPlayerRecord(game), marks };
      void saveFinishedGame(entry, profile.memberSince);
    }
  }, [reviewing, over, id, game, marks, profile.memberSince]);
  const newBadges = useBadgesEarnedBy(over && !reviewing ? id : null);

  const changeDifficulty = (d: Difficulty) => {
    const current = gameRef.current;
    const result = current && setTwoPlayerDifficulty(current, d, Date.now());
    if (result?.ok) setGame(result.game);
  };

  // The computer's turn: think briefly, then guess.
  useEffect(() => {
    if (!game || turn !== 'computer') return;
    const timer = setTimeout(() => {
      const current = gameRef.current;
      if (!current || whoseTurn(current) !== 'computer') return;
      const guess = pickComputerGuess(current.computerGuesses, current.strength);
      const result = submitTurn(current, 'computer', guess, Date.now());
      if (result.ok) setGame(result.game);
    }, finalGuess ? FINAL_THINK_MS : THINK_MS);
    return () => clearTimeout(timer);
  }, [game, turn]);

  const computerCount = game?.computerGuesses.length ?? 0;
  useEffect(() => {
    if (tab === 'computer') setSeen(computerCount);
  }, [tab, computerCount]);

  const reject = (text: string) => {
    setMessage({ text, error: true });
    setShake(true);
  };

  // You can type ahead while the computer thinks; only Enter waits for your turn.
  const typing = () => !confirming && (gameRef.current === null || whoseTurn(gameRef.current) !== null || practising);
  const typeLetter = (letter: string) => {
    if (typing() && draftRef.current.length < 5) setDraft(draftRef.current + letter);
  };
  const backspace = () => {
    if (typing()) setDraft(draftRef.current.slice(0, -1));
  };

  /** True while the game source checks your word, so Enter can't start two games. */
  const checkingRef = useRef(false);
  const chooseSecret = async () => {
    if (checkingRef.current) return;
    const word = draftRef.current;
    checkingRef.current = true;
    const validation = await gameSource.checkWord('secret', word).finally(() => {
      checkingRef.current = false;
    });
    if (gameRef.current) return;
    if (!validation.ok) {
      reject(secretErrorMessage(validation.error, word));
      return;
    }
    const first = pickFirstSide();
    const created = createTwoPlayerGame(validation.word, pickRandomSecret(SECRET_WORDS), first, Date.now(), {
      difficulty: nextDifficulty, strength,
    });
    if (!created.ok) return;
    setGame(created.game);
    setDraft('');
    setSeen(0);
    const nextRecent = addRecentSecret(recent, created.game.humanSecret);
    setRecent(nextRecent);
    saveRecentSecrets(nextRecent);
    setMessage({
      text: first === 'human' ? 'Coin toss: you go first.' : 'Coin toss: the computer goes first.',
      error: false,
    });
  };

  const enter = () => {
    if (!typing()) return;
    const current = gameRef.current;
    if (!current) {
      void chooseSecret();
      return;
    }
    if (practising) {
      const said = playOn.guess(draftRef.current, current.humanGuesses, current.playingDifficulty);
      if (said?.error) {
        reject(said.text);
        return;
      }
      setDraft('');
      setMessage(said);
      return;
    }
    const repeat = earlierGuess(current.humanGuesses, draftRef.current);
    if (repeat) {
      reject(repeatMessage(draftRef.current, repeat, current.playingDifficulty));
      return;
    }
    const result = submitTurn(current, 'human', draftRef.current, Date.now());
    if (!result.ok) {
      reject(errorMessage(result.error, draftRef.current));
      return;
    }
    const latest = result.game.humanGuesses[result.game.humanGuesses.length - 1];
    setGame(result.game);
    setDraft('');
    setMessage(latest.isWin ? null : { text: scoreMessage(latest), error: false, quiet: true });
  };

  /** Easy's Suggest: fills the input with a word that fits, and records it. */
  const suggest = () => {
    const current = gameRef.current;
    if (!typing() || !current) return;
    const word = pickSuggestion(current.humanGuesses);
    if (!word) {
      setMessage({ text: NO_SUGGESTION, error: true });
      return;
    }
    const result = suggestTwoPlayer(current, word, Date.now());
    if (!result.ok) {
      reject(errorMessage(result.error, word));
      return;
    }
    setGame(result.game);
    setDraft(word);
    setMessage({ text: suggestedMessage(word), error: false });
  };

  usePhysicalKeyboard({ onLetter: typeLetter, onEnter: enter, onBackspace: backspace });

  /** Play again: the same strength and difficulty as the game just played. */
  const startNewGame = () => {
    const current = gameRef.current;
    if (current) {
      setStrength(current.strength);
      setNextDifficulty(current.playingDifficulty);
    }
    clearTwoPlayer();
    setReviewing(false);
    setId(newId());
    setGame(null);
    setMarks({});
    setDraft('');
    setSeen(0);
    setTab('you');
    setOpenYou(-1);
    setOpenComputer(-1);
    setConfirming(null);
    setMessage(null);
  };

  /** From a review, a new game would replace the one in progress, so that's confirmed first. */
  const playAgain = () => {
    const inProgress = loadTwoPlayer();
    if (reviewing && inProgress && !isTwoPlayerOver(inProgress.game)) setConfirming('replace');
    else startNewGame();
  };

  // Only a game with guesses in it is worth confirming before it's thrown away.
  const requestNewGame = () => {
    const current = gameRef.current;
    const started = current && current.humanGuesses.length + current.computerGuesses.length > 0;
    if (started && whoseTurn(current) !== null) setConfirming('new-game');
    else playAgain();
  };

  const confirmGiveUp = () => {
    const current = gameRef.current;
    const result = current && concede(current, Date.now());
    if (result?.ok) setGame(result.game);
    setConfirming(null);
  };

  if (!game) {
    return (
      <div class="app">
        <header class="step-head">
          <button type="button" class="icon-btn" aria-label="Back to main menu" onClick={onExit}>
            <BackIcon />
          </button>
          <h2>Choose your secret word</h2>
        </header>
        <p class="step-note">
          The computer ({STRENGTH_LABEL[strength]}) will try to guess it. 5 letters, no repeated letters.
        </p>
        <div class="setup-space" />
        <section class="entry">
          <Slots draft={draft} shake={shake} onShakeEnd={() => setShake(false)} label="Your secret word" />
          <div class={message?.error ? 'message error' : 'message'} role="status">{message?.quiet ? <span class="visually-hidden">{message.text}</span> : message?.text}</div>
          {/* Each drops focus after use, so a physical Enter submits instead of pressing it again. */}
          <button type="button" class="btn" onClick={(e) => {
            setDraft(pickRandomSecret(SECRET_WORDS));
            e.currentTarget.blur();
          }}>
            Pick for me
          </button>
          {recent.length > 0 && (
            <div class="recent">
              <span class="info-label">Recently used</span>
              <div class="recent-words">
                {recent.map((w) => (
                  <button type="button" class="chip" key={w} aria-pressed={draft === w}
                    onClick={(e) => { setDraft(w); e.currentTarget.blur(); }}>{upper(w)}</button>
                ))}
              </div>
            </div>
          )}
        </section>
        <Keyboard ready={draft.length === 5} onLetter={typeLetter} onEnter={enter} onBackspace={backspace} />
      </div>
    );
  }

  const computerFoundYours = game.computerGuesses.some((g) => g.isWin);
  const yourFoundTheirs = game.humanGuesses.some((g) => g.isWin);
  const lastComputer = game.computerGuesses[game.computerGuesses.length - 1];
  const unseen = game.computerGuesses.length > seen;

  // Before your first guess (even if the computer has made one), ☰ cancels
  // the game instead: no word revealed, nothing saved.
  // Not on your final guess: the computer has found your word, and that result is already earned.
  const unstarted = !over && !finalGuess && !reviewing && game.humanGuesses.length === 0;
  const cancelGame = () => {
    clearTwoPlayer();
    onExit();
  };

  /** Ends practice: their word is shown. */
  const showWord = () => {
    playOn.reveal();
    setDraft('');
    setMessage(null);
  };

  // In ☰ and on the header's difficulty bubble.
  const difficultyChoice = over ? undefined : { onDifficulty: changeDifficulty, guessed: game.humanGuesses.length > 0 };
  const appClass = ['app', 'two', yourLastChance && !confirming ? 'last-chance' : ''].filter(Boolean).join(' ');

  return (
    <div class={appClass}>
      <GameHeader profile={profile} onHome={onExit} onProfile={onProfile} review={reviewing ? review : null} suggested={game.suggested} opponent={`Computer · ${STRENGTH_LABEL[game.strength]}`}
        difficulty={difficulty} difficultyChoice={difficultyChoice}
        menu={(close) => (
          <GameMenuItems close={close} onNewGame={requestNewGame}
            difficulty={difficulty} {...difficultyChoice}
            giveUpLabel={unstarted ? 'Cancel this game' : practising ? 'Show their word' : 'Give up'} canGiveUp={!over || practising}
            onGiveUp={unstarted ? cancelGame : practising ? showWord : () => setConfirming('give-up')} onExit={onExit} onHowToPlay={() => setHowTo(true)}
            onReport={() => openReport({
              screen: `Two player vs. computer (${STRENGTH_LABEL[game.strength]}) · ${DIFFICULTY_LABEL[difficulty]}`
                + (reviewing ? ' · reviewing a past game' : ''),
              record: toTwoPlayerRecord(game),
            })}
            checksLeft={practising ? undefined : checks.left}
            onCheckMarks={medium && !over && !reviewing
              ? () => checks.use() && setMessage(marksCheckMessage(marksFitScores(marks, game.humanGuesses)))
              : medium && practising ? () => setMessage(marksCheckMessage(marksFitScores(playOn.marks, yourGuesses))) : undefined}
            onClearMarks={medium && !over && !reviewing ? () => setMarks({}) : medium && practising ? () => playOn.setMarks({}) : undefined} />
        )}>
        {/* Row 3 follows the tab: your in-letters on yours, your word on the computer's. */}
        <div class="row3" data-tab={tab}>
          {shownMarks && (!over || practising) && <div class="for-you"><InSet marks={shownMarks} /></div>}
          <div class="for-computer"><YourWord word={game.humanSecret} found={computerFoundYours} known={computerMarks} /></div>
        </div>
      </GameHeader>

      <div class="tabs" role="tablist" aria-label="Guesses">
        <button type="button" role="tab" aria-selected={tab === 'you'} onClick={() => setTab('you')}>
          You ({game.humanGuesses.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'computer'} onClick={() => setTab('computer')}>
          Computer ({game.computerGuesses.length})
          {unseen && tab !== 'computer' && <span class="dot" aria-label="new guess" />}
        </button>
      </div>

      <div class="boards" data-tab={tab}>
        <section class="board you" aria-label="Your guesses">
          <h2 class="board-title">Your guesses</h2>
          {/* Extreme hides your words until the game is over. */}
          {difficulty === 'extreme' && (!over || practising) ? (
            <ScoreHistory guesses={yourGuesses} newestFirst={settings.newestFirst[difficulty]} />
          ) : (
            <History guesses={yourGuesses} newestFirst={settings.newestFirst[difficulty]} openDef={openYou}
              marks={shownMarks} practiceFrom={playOn.guesses.length > 0 ? game.humanGuesses.length : undefined}
              onMark={medium && !reviewing
                ? (letter) => (playOn.practised ? playOn.setMarks(cycleMark(playOn.marks, letter)) : setMarks(cycleMark(marks, letter)))
                : undefined}
              onToggleDef={(i) => setOpenYou(openYou === i ? -1 : i)} definitions={definitions} />
          )}
        </section>
        <section class="board computer" aria-label="The computer's guesses">
          <h2 class="board-title">Computer's guesses</h2>
          <p class="board-note opponent-note">Marked as on Easy: the letters its scores prove in or out.</p>
          <History guesses={game.computerGuesses} newestFirst={settings.newestFirst[difficulty]} openDef={openComputer}
            label="The computer's guesses" emptyText="The computer hasn't guessed yet."
            marks={computerMarks}
            onToggleDef={(i) => setOpenComputer(openComputer === i ? -1 : i)} definitions={definitions} />
        </section>
      </div>

      {!over && !confirming && (
        <>
          {yourLastChance ? (
            <section class="banner danger" role="alert">
              <strong>Last chance</strong>
              <span>The computer found {upper(game.humanSecret)}. One guess to tie the game.</span>
            </section>
          ) : finalGuess ? (
            <section class="banner hope" role="status">
              <strong>You found {upper(game.computerSecret)}!</strong>
              <span class="thinking">Waiting for the computer's final guess…</span>
            </section>
          ) : (
            <div class="status-row">
              {lastComputer && tab === 'you' && (
                <span class="last-move">
                  Computer guessed <b>{upper(lastComputer.guess)}</b> – {lastComputer.score}
                </span>
              )}
              <span class={turn === 'human' ? 'turn yours' : 'turn thinking'} role="status">
                {turn === 'human' ? 'Your turn' : 'Computer is thinking…'}
              </span>
            </div>
          )}
          {/* Nothing to type while the computer takes its final guess (issue #154). */}
          {!(finalGuess && !yourLastChance) && (<>
            <section class="entry">
              <Slots draft={draft} shake={shake} onShakeEnd={() => setShake(false)}
                class={yourLastChance ? 'final' : ''} />
              <div class={message?.error ? 'message error' : 'message'} role="status">
                {message?.quiet ? <span class="visually-hidden">{message.text}</span> : message?.text}
              </div>
              {FEATURES.suggest && difficulty === 'easy' && !reviewing && (
                <SuggestButton left={SUGGEST_LIMIT - game.suggested} onSuggest={suggest} />
              )}
            </section>
            <Keyboard marks={shownMarks} ready={draft.length === 5 && turn === 'human'} onShuffle={shuffle} onLetter={typeLetter} onEnter={enter}
              onBackspace={backspace} enterLabel={yourLastChance ? 'Final guess' : 'Enter'} />
          </>)}
        </>
      )}

      {practising && !confirming && (
        <PracticeEntry draft={draft} shake={shake} onShakeEnd={() => setShake(false)} message={message} marks={shownMarks}
          onShuffle={shuffle} onLetter={typeLetter} onEnter={enter} onBackspace={backspace} onShow={showWord} />
      )}

      {confirming === 'give-up' && !over && (
        <section class="panel">
          <h2>Give up? The computer wins.</h2>
          <p>Then you can see its word, or keep guessing it for practice.</p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={confirmGiveUp}>Give up</button>
            <button class="btn" type="button" onClick={() => setConfirming(null)}>Keep playing</button>
          </div>
        </section>
      )}

      {confirming === 'new-game' && !over && (
        <section class="panel">
          <h2>Start a new game?</h2>
          <p>This game will end, and you'll choose a new secret word.</p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={startNewGame}>New game</button>
            <button class="btn" type="button" onClick={() => setConfirming(null)}>Keep playing</button>
          </div>
        </section>
      )}

      {confirming === 'replace' && (
        <ReplaceGamePanel what="a two-player game" onConfirm={startNewGame} onCancel={() => setConfirming(null)} />
      )}

      {over && outcome && !practising && confirming !== 'replace' && (
        <ResultCard outcome={outcome} word={playOn.stage === 'choose' ? null : game.computerSecret} whose="The computer's word">
          {outcome === 'clutch' && <Confetti />}
          {outcome === 'clutch' ? (
            <>
              <p class="kicker">Clutch!</p>
              <h2>You tied it on your last guess.</h2>
              <p class="badge">Draw</p>
            </>
          ) : (
            <h2>{{
              'won': 'You win!',
              'won-held': 'You win!',
              'lost': 'The computer wins.',
              'lost-final': 'So close. The computer wins.',
              'tied': 'The computer tied it. Draw.',
              'gave-up': 'You gave up. The computer wins.',
            }[outcome]}</h2>
          )}
          <p>{{
            'won': `You found its word in ${guessCount(game.humanGuesses.length)}, before it found yours.`,
            'won-held': `You found its word in ${guessCount(game.humanGuesses.length)}, and its last guess, ${upper(lastComputer?.guess ?? '')}, missed.`,
            'lost': `It found ${upper(game.humanSecret)} in ${guessCount(game.computerGuesses.length)}.`,
            'lost-final': `It found ${upper(game.humanSecret)} in ${guessCount(game.computerGuesses.length)}, and your last guess missed.`,
            'clutch': `The computer found ${upper(game.humanSecret)} first, and you matched it.`,
            'tied': `You found its word first, and it matched you with its last guess.`,
            'gave-up': `You made ${guessCount(game.humanGuesses.length)}; the computer made ${guessCount(game.computerGuesses.length)}.`,
          }[outcome]}</p>
          {playOn.stage === 'choose' ? (
            <PlayOnChoice whose="the computer's word" onKeepGuessing={() => {
              playOn.start();
              setTab('you');
              setMessage(null);
            }} onShow={playOn.reveal} />
          ) : (
            <>
              {!yourFoundTheirs && <p>The computer's word was</p>}
              <TheirWord word={game.computerSecret}
                motion={outcome === 'clutch' ? 'flip' : outcome.startsWith('won') || playOn.stage === 'found' ? 'pop' : undefined} />
              <DefinitionBox word={game.computerSecret} state={definitions} />
              <PracticeLine stage={playOn.stage} practice={playOn.guesses.length} game={game.humanGuesses.length} />
            </>
          )}
          {/* Your count, where the line above didn't already give it. */}
          {!['won', 'won-held', 'gave-up'].includes(outcome) && <p class="tally">You: {guessCount(game.humanGuesses.length)}</p>}
          <SuggestNote found={yourFoundTheirs} guesses={game.humanGuesses.length} suggested={game.suggested} />
          <BadgeToast badges={newBadges} onOpen={onProfile} />
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={playAgain}>Play again</button>
            {(outcome === 'won' || outcome === 'won-held' || outcome === 'clutch' || outcome === 'tied') && !reviewing && (
              <ShareResult text={twoPlayerShareText({
                strength: game.strength, difficulty: game.scoredDifficulty, guesses: game.humanGuesses.length,
                result: outcome === 'won-held' ? 'won' : outcome,
              })} />
            )}
            <button class="btn" type="button" onClick={onExit}>Main menu</button>
          </div>
        </ResultCard>
      )}
      {howTo && <HowToPlay onClose={() => setHowTo(false)} />}
    </div>
  );
}
