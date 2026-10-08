import type { OpenProfile } from './profilePages';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  createSoloGame, cycleMark, earlierGuess, FEATURES, giveUp, SUGGEST_LIMIT, suggestSolo, marksFitScores, HISTORY_VERSION, pickRandomSecret, SECRET_WORDS, setSoloDifficulty, submitGuess,
  toSoloRecord, type Difficulty, type Marks, type SoloGame,
} from '../game';
import { useCheckLimit } from './checkLimit';
import {
  Bubble, DefinitionBox, DIFFICULTY_LABEL, History, InSet, Keyboard, ScoreHistory, Slots, SuggestButton,
} from './components';
import { GameHeader, GameMenuItems } from './gameHeader';
import { HowToPlay, ReplaceGamePanel, type Review } from './panels';
import { BadgeToast, SuggestNote } from './Badge';
import { useBadgesEarnedBy } from './badges';
import { useDefinitions } from './definitions';
import { useShownMarks } from './easyMarks';
import { saveFinishedGame } from './historyDb';
import { useMessage, usePhysicalKeyboard } from './hooks';
import { errorMessage, guessCount, marksCheckMessage, repeatMessage, scoreMessage } from './messages';
import type { Profile } from './profileStorage';
import type { Settings } from './settings';
import { newId } from './ids';
import { openReport } from './reportIssue';
import { clearSaved, loadSaved, onOtherTabSave, save, savedSince, type Saved } from './storage';
import { NO_SUGGESTION, pickSuggestion, suggestedMessage } from './suggestion';
import { shuffleLetters } from './keyboard';

function newGame(difficulty: Difficulty): SoloGame {
  const result = createSoloGame(pickRandomSecret(SECRET_WORDS), Date.now(), difficulty);
  if (!result.ok) throw new Error(`Secret list produced an invalid word: ${result.error}`);
  return result.game;
}

/**
 * Single player: find the computer's word. With `resume`, it picks up the saved
 * game in progress; otherwise it starts a new one. With `review`, it shows a
 * past game read-only until you play again.
 */
export function SoloScreen({ settings, profile, onProfile, resume, onExit, review }: {
  settings: Settings;
  profile: Profile;
  onProfile: OpenProfile;
  resume: boolean;
  onExit: () => void;
  review?: Review & { id: string; game: SoloGame; marks: Marks };
}) {
  const [reviewing, setReviewing] = useState(review !== undefined);
  const [saved] = useState(() => (resume && !review ? loadSaved() : null));
  const [id, setId] = useState(() => review?.id ?? saved?.id ?? newId());
  const [game, setGameState] = useState<SoloGame>(() => review?.game ?? saved?.game ?? newGame(settings.difficulty));
  const [draft, setDraftState] = useState(saved?.draft ?? '');
  // Preact renders asynchronously, so fast typing can outrun it. Handlers read
  // and write these refs, which always hold the latest game and draft.
  const gameRef = useRef(game);
  const draftRef = useRef(draft);
  const setGame = (g: SoloGame) => {
    gameRef.current = g;
    setGameState(g);
  };
  const setDraft = (d: string) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const [marks, setMarks] = useState<Marks>(review?.marks ?? saved?.marks ?? {});
  const [message, setMessage] = useMessage();
  const [shake, setShake] = useState(false);
  /** Which confirmation is showing: giving up, or abandoning this game for a new one. */
  const [confirming, setConfirming] = useState<'give-up' | 'new-game' | 'replace' | null>(null);
  const [openDef, setOpenDef] = useState(-1);
  const [howTo, setHowTo] = useState(false);

  const over = game.status !== 'playing';
  const difficulty = game.playingDifficulty;
  const medium = difficulty === 'medium';
  const checks = useCheckLimit(`solo:${id}`);
  // Easy and Medium: the Shuffle key reorders the typed letters, whenever the letter keys would type.
  const shuffle = difficulty === 'easy' || medium
    ? () => {
      if (playing()) setDraft(shuffleLetters(draftRef.current));
    }
    : undefined;
  const shownMarks = useShownMarks(difficulty, marks, game.guesses);
  const definitions = useDefinitions(openDef >= 0 || over);

  /** What this page last saved, so coming back can tell whether another page saved since. */
  const written = useRef<string | null>(null);
  // A reviewed game is already saved, and must not replace the game in progress.
  useEffect(() => {
    if (!reviewing) written.current = save({ id, game, marks, draft }) ?? written.current;
  }, [reviewing, id, game, marks, draft]);
  // The same game open in another tab: follow its moves and marks, so its
  // guesses aren't lost when this tab saves next (Dev Plan item 17). Only a
  // change is taken, so the two tabs' saves don't echo back and forth.
  useEffect(() => {
    if (reviewing) return undefined;
    const follow = (other: Saved) => {
      if (JSON.stringify(toSoloRecord(other.game)) !== JSON.stringify(toSoloRecord(gameRef.current))) {
        setId(other.id);
        setGame(other.game);
      }
      setMarks((m) => (JSON.stringify(m) === JSON.stringify(other.marks) ? m : other.marks));
    };
    // A page that slept (a tab in the background, or one Back brought back)
    // may have missed those saves: it catches up on coming back (issue #163).
    const catchUp = () => {
      if (document.visibilityState !== 'visible') return;
      const other = savedSince(written.current);
      if (other) follow(other);
    };
    const stop = onOtherTabSave(follow);
    document.addEventListener('visibilitychange', catchUp);
    window.addEventListener('pageshow', catchUp);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', catchUp);
      window.removeEventListener('pageshow', catchUp);
    };
  }, [reviewing]);
  // A finished game goes into your history, and is saved again if you change its marks afterwards.
  useEffect(() => {
    if (over && !reviewing) {
      const entry = { id, version: HISTORY_VERSION, mode: 'single' as const, record: toSoloRecord(game), marks };
      void saveFinishedGame(entry, profile.memberSince);
    }
  }, [reviewing, over, id, game, marks, profile.memberSince]);
  const newBadges = useBadgesEarnedBy(over && !reviewing ? id : null);

  const changeDifficulty = (d: Difficulty) => {
    const result = setSoloDifficulty(gameRef.current, d, Date.now());
    if (result.ok) setGame(result.game);
  };
  // In ☰ and on the header's difficulty bubble.
  const difficultyChoice = over ? undefined : { onDifficulty: changeDifficulty, guessed: game.guesses.length > 0 };

  const reject = (text: string) => {
    setMessage({ text, error: true });
    setShake(true);
  };

  const playing = () => gameRef.current.status === 'playing' && !confirming;
  const typeLetter = (letter: string) => {
    if (playing() && draftRef.current.length < 5) setDraft(draftRef.current + letter);
  };
  const backspace = () => {
    if (playing()) setDraft(draftRef.current.slice(0, -1));
  };
  const enter = () => {
    if (!playing()) return;
    const repeat = earlierGuess(gameRef.current.guesses, draftRef.current);
    if (repeat) {
      reject(repeatMessage(draftRef.current, repeat, gameRef.current.playingDifficulty));
      return;
    }
    const result = submitGuess(gameRef.current, draftRef.current, Date.now());
    if (!result.ok) {
      reject(errorMessage(result.error, draftRef.current));
      return;
    }
    const latest = result.game.guesses[result.game.guesses.length - 1];
    setGame(result.game);
    setDraft('');
    setMessage(latest.isWin ? null : { text: scoreMessage(latest), error: false, quiet: true });
  };

  /** Easy's Suggest: fills the input with a word that fits, and records it. */
  const suggest = () => {
    if (!playing()) return;
    const word = pickSuggestion(gameRef.current.guesses);
    if (!word) {
      setMessage({ text: NO_SUGGESTION, error: true });
      return;
    }
    const result = suggestSolo(gameRef.current, word, Date.now());
    if (!result.ok) {
      reject(errorMessage(result.error, word));
      return;
    }
    setGame(result.game);
    setDraft(word);
    setMessage({ text: suggestedMessage(word), error: false });
  };
  const canSuggest = FEATURES.suggest && difficulty === 'easy' && !reviewing;

  usePhysicalKeyboard({ onLetter: typeLetter, onEnter: enter, onBackspace: backspace });

  const startNewGame = () => {
    setReviewing(false);
    setId(newId());
    setGame(newGame(gameRef.current.playingDifficulty));
    setMarks({});
    setDraft('');
    setOpenDef(-1);
    setConfirming(null);
    setMessage({ text: 'New game. The computer has picked a word.', error: false });
  };

  /** From a review, a new game would replace the one in progress, so that's confirmed first. */
  const playAgain = () => {
    if (reviewing && loadSaved()?.game.status === 'playing') setConfirming('replace');
    else startNewGame();
  };

  // Only a game with guesses in it is worth confirming before it's thrown away.
  const requestNewGame = () => {
    if (gameRef.current.status === 'playing' && gameRef.current.guesses.length > 0) {
      setConfirming('new-game');
    } else {
      playAgain();
    }
  };

  const confirmGiveUp = () => {
    const result = giveUp(gameRef.current, Date.now());
    if (result.ok) setGame(result.game);
    setConfirming(null);
  };

  const n = game.guesses.length;
  const guesses = guessCount(n);
  // Before your first guess, ☰ cancels the game instead: no word revealed, nothing saved.
  const unstarted = !over && !reviewing && n === 0;
  const cancelGame = () => {
    clearSaved();
    onExit();
  };

  return (
    <div class="app">
      <GameHeader profile={profile} onHome={onExit} onProfile={onProfile} opponent="Computer" difficulty={difficulty}
        difficultyChoice={difficultyChoice}
        review={reviewing ? review : null} suggested={game.suggested}
        menu={(close) => (
          <GameMenuItems close={close} onNewGame={requestNewGame}
            difficulty={difficulty} {...difficultyChoice}
            giveUpLabel={unstarted ? 'Cancel this game' : 'Give up and reveal the word'} canGiveUp={!over}
            onGiveUp={unstarted ? cancelGame : () => setConfirming('give-up')} onExit={onExit} onHowToPlay={() => setHowTo(true)}
            onReport={() => openReport({
              screen: `Single player · ${DIFFICULTY_LABEL[difficulty]}${reviewing ? ' · reviewing a past game' : ''}`,
              record: toSoloRecord(gameRef.current),
            })}
            onCheckMarks={medium && !over && !reviewing
              ? () => checks.use() && setMessage(marksCheckMessage(marksFitScores(marks, game.guesses))) : undefined}
            checksLeft={checks.left}
            onClearMarks={medium && !over && !reviewing ? () => setMarks({}) : undefined} />
        )}>
        {shownMarks && !over && <InSet marks={shownMarks} />}
      </GameHeader>

      {/* Extreme hides your words until the game is over. */}
      {difficulty === 'extreme' && !over ? (
        <ScoreHistory guesses={game.guesses} newestFirst={settings.newestFirst[difficulty]} />
      ) : (
        <History guesses={game.guesses} newestFirst={settings.newestFirst[difficulty]} openDef={openDef}
          marks={shownMarks}
          onMark={medium && !reviewing ? (letter) => setMarks(cycleMark(marks, letter)) : undefined}
          onToggleDef={(i) => setOpenDef(openDef === i ? -1 : i)} definitions={definitions} />
      )}

      {!over && !confirming && (
        <>
          <section class="entry">
            <Slots draft={draft} shake={shake} onShakeEnd={() => setShake(false)} />
            <div class={message?.error ? 'message error' : 'message'} role="status">
              {message?.quiet ? <span class="visually-hidden">{message.text}</span> : message?.text}
            </div>
            {canSuggest && <SuggestButton left={SUGGEST_LIMIT - game.suggested} onSuggest={suggest} />}
          </section>
          <Keyboard marks={shownMarks} ready={draft.length === 5} onShuffle={shuffle} onLetter={typeLetter} onEnter={enter} onBackspace={backspace} />
        </>
      )}

      {confirming === 'give-up' && !over && (
        <section class="panel">
          <h2>Reveal the word and end this game?</h2>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={confirmGiveUp}>Reveal the word</button>
            <button class="btn" type="button" onClick={() => setConfirming(null)}>Keep playing</button>
          </div>
        </section>
      )}

      {confirming === 'new-game' && !over && (
        <section class="panel">
          <h2>Start a new game?</h2>
          <p>This game will end without revealing the word.</p>
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={startNewGame}>New game</button>
            <button class="btn" type="button" onClick={() => setConfirming(null)}>Keep playing</button>
          </div>
        </section>
      )}

      {confirming === 'replace' && (
        <ReplaceGamePanel what="a single-player game" onConfirm={startNewGame} onCancel={() => setConfirming(null)} />
      )}

      {over && confirming !== 'replace' && (
        <section class="panel">
          <h2>{game.status === 'won' ? `You found it in ${guesses}.` : 'The word was'}</h2>
          <div class="letters reveal">
            {[...game.secret].map((c, i) => <Bubble key={i} letter={c} mark="in" />)}
          </div>
          <DefinitionBox word={game.secret} state={definitions} />
          {game.status === 'gave-up' && <p>You made {guesses}.</p>}
          <SuggestNote found={game.status === 'won'} guesses={game.guesses.length} suggested={game.suggested} />
          <BadgeToast badges={newBadges} onOpen={onProfile} />
          <div class="row-btns">
            <button class="btn primary" type="button" onClick={playAgain}>Play again</button>
            <button class="btn" type="button" onClick={onExit}>Main menu</button>
          </div>
        </section>
      )}

      {howTo && <HowToPlay onClose={() => setHowTo(false)} />}
    </div>
  );
}
