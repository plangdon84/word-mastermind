import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { evaluateGuess, FEATURES, type GuessResult, type Marks } from '../game';
import { Bubble, History, InSet, Keyboard, MarkKey, ScoreHistory, Slots } from './components';
import { GameMenuItems } from './gameHeader';
import { LockIcon, Modal } from './panels';
import { useDefinitions } from './definitions';

/*
 * The tutorial (README "Tutorial"): a walk through a sample game, one mocked-up
 * screen per step, with numbered rings on the parts worth knowing about. The
 * mock-ups are the game's own components with sample data, made inert.
 */

/** The sample game's secret word, and its guesses so far. */
const SECRET = 'beach';
const sample = (...words: string[]): GuessResult[] => words.map((w) => evaluateGuess(w, SECRET));

const CRANE = sample('crane');
const THREE = sample('crane', 'dummy', 'stoic');
const MARKS: Marks = { d: 'out', u: 'out', m: 'out', y: 'out', a: 'in', c: 'in' };
const noop = () => {};

/** A ring and number around one part of a mock-up; its note has the same number. */
function Spot({ n, class: extra = '', children }: { n: number; class?: string; children: ComponentChildren }) {
  return <div class={['tut-spot', extra].filter(Boolean).join(' ')} data-n={n}>{children}</div>;
}

/** A phone-sized game screen, for looking at only. */
function Phone({ difficulty = 'Medium', children }: { difficulty?: string; children: ComponentChildren }) {
  return (
    // inert: nothing in a mock-up can be focused or tapped. Screen readers get the notes instead.
    <div class="tut-phone" inert aria-hidden="true">
      <div class="brand">
        <span class="tut-title">Word Mastermind</span>
        <span class="tut-icons"><Bubble letter="" class="mini" /> ☰</span>
      </div>
      <div class="matchup">
        <span><b>You</b> vs. <b>Computer</b></span>
        <span class={`matchup-diff diff-${difficulty.toLowerCase()}`}>{difficulty}</span>
      </div>
      {children}
    </div>
  );
}

const Notes = ({ notes }: { notes: ComponentChildren[] }) => (
  <ol class="tut-notes">
    {notes.map((note, i) => <li key={i} data-n={i + 1}><div>{note}</div></li>)}
  </ol>
);

interface Step {
  title: string;
  body: ComponentChildren;
}

function steps(definitions: ReturnType<typeof useDefinitions>): Step[] {
  const history = (guesses: GuessResult[], marks?: Marks, openDef = -1) => (
    <History guesses={guesses} newestFirst={false} openDef={openDef} marks={marks}
      onMark={marks ? noop : undefined} onToggleDef={noop} definitions={definitions} />
  );
  return [
    {
      title: 'Find the secret word',
      body: (
        <>
          <div class="tut-hero" aria-hidden="true">
            {[...'?????'].map((c, i) => <Bubble key={i} letter={c} />)}
          </div>
          <p>
            The game picks a secret <b>5-letter word, each letter used only once</b>. You try to guess the word in
            as few turns as possible. Let's see how the game plays out if the secret word was <b>BEACH</b>.
          </p>
        </>
      ),
    },
    {
      title: 'Make a guess',
      body: (
        <>
          <Phone>
            {history(CRANE)}
            <Spot n={1} class="fit"><Slots draft="crane" shake={false} onShakeEnd={noop} /></Spot>
            <p class="message error tut-message">You already guessed CRANE (guess 1).</p>
            <Spot n={2}><Keyboard ready onShuffle={noop} onLetter={noop} onEnter={noop} onBackspace={noop} /></Spot>
          </Phone>
          <Notes notes={[
            'Your guess fills these bubbles. Any 5-letter English word counts, and guesses may repeat letters.',
            <>Type, or tap the keys, then <b>Enter</b>, which lights up once all 5 letters are in. On Easy and Medium,
              the shuffle key mixes up the letters you've typed. A word you've already guessed isn't taken: you're told
              which guess it was.</>,
          ]} />
        </>
      ),
    },
    {
      title: 'Read the score',
      body: (
        <>
          <Phone>
            <Spot n={1}>{history(CRANE)}</Spot>
          </Phone>
          <Notes notes={[
            <>CRANE scores <b>3</b>: three of its letters are in BEACH (C, A and E). You're never told which three,
              and where they sit doesn't matter.</>,
          ]} />
          <ul>
            <li>Each letter counts once, even if your guess repeats it.</li>
            <li>An anagram of the word scores 5 but doesn't win: only the exact word wins.</li>
          </ul>
        </>
      ),
    },
    {
      title: 'Mark what you know',
      body: (
        <>
          <Phone>
            <Spot n={2}><InSet marks={MARKS} /></Spot>
            <Spot n={1}>{history(THREE, MARKS)}</Spot>
            <Spot n={3}><Keyboard marks={MARKS} onShuffle={noop} onLetter={noop} onEnter={noop} onBackspace={noop} /></Spot>
          </Phone>
          <Notes notes={[
            <>On Medium, tap a letter to cycle it: unmarked, then in, then out. A mark applies to that letter in
              every guess. DUMMY scored 0, so all its letters are out.<MarkKey /></>,
            'Letters you mark in collect up here.',
            'The keyboard shows your marks too.',
          ]} />
          <p class="field-note">On <b>Easy</b>, the app marks the letters for you after each guess, working them out from
            the scores alone.</p>
        </>
      ),
    },
    {
      title: 'Look up a word',
      body: (
        <>
          <Phone>
            <Spot n={1}>{history(CRANE, undefined, 0)}</Spot>
          </Phone>
          <Notes notes={[<>Tap <b>ⓘ</b> beside any guess to see what the word means.</>]} />
        </>
      ),
    },
    {
      title: 'The ☰ menu',
      body: (
        <>
          <div class="tut-phone tut-menu" inert aria-hidden="true">
            <div class="menu">
              <GameMenuItems close={noop} onNewGame={noop} difficulty="medium" onDifficulty={noop}
                giveUpLabel="Give up and reveal the word" canGiveUp onGiveUp={noop} onExit={noop}
                onHowToPlay={noop} onReport={noop} onCheckMarks={noop} checksLeft={1} onClearMarks={noop} />
            </div>
          </div>
          <Notes notes={[
            <><b>Your difficulty</b>: pick any before your first guess, then only easier ones. A game is scored at the easiest one you used.</>,
            <><b>Check for mistakes</b> tells you whether your marks contradict a score (not which one).
              <b> Clear all highlights</b> starts your marks again.</>,
            <><b>How to play</b> has the rules, and <b>Report an issue</b> sends us a bug, an idea or a word
              problem, with a screenshot if you like.</>,
            <><b>Give up</b> reveals the word. <b>New game</b> and <b>Main menu</b> are at the bottom; the main menu
              keeps your game to continue.</>,
          ]} />
        </>
      ),
    },
    {
      title: 'Harder difficulties',
      body: (
        <>
          <div class="tut-pair">
            <Phone difficulty="Hard"><Spot n={1}>{history(THREE)}</Spot></Phone>
            <Phone difficulty="Extreme"><Spot n={2}><ScoreHistory guesses={THREE} newestFirst={false} /></Spot></Phone>
          </div>
          <Notes notes={[
            <><b>Hard:</b> just your guesses and their scores. No marking: keep track in your head.</>,
            <><b>Extreme:</b> your words are hidden. Only the latest stays until your next guess, then just
              the scores. Repeat a word and you're reminded of its score.</>,
          ]} />
          <p class="field-note">Set the difficulty new games start at, and the guess order, in your profile's Settings.</p>
        </>
      ),
    },
    {
      title: 'Ways to play',
      body: (
        <ul class="tut-modes">
          <li><b>Daily Set</b> and <b>Daily Word</b> (the Daily card at the top): the day's 4 themed words, and
            one word, each once a day, on a leaderboard. <b>Games in progress</b> below it lists the games waiting for you.</li>
          <li><b>Practice:</b> find the computer's word on your own.</li>
          <li><b>Two player:</b> you and an opponent each pick a word and take turns. If the first player finds it,
            the other gets one final guess to tie. Play the computer (Casual to Mastermind), or a friend: send an
            invite link, or challenge someone on your friends list. Play live on a chess clock, or take a day or
            three per guess.</li>
          <li><b>Word Sets:</b> 4 words in a row against the clock, ranked as a <b>Rush</b> (fastest) or a
            <b> Crush</b> (fewest guesses). <b>Solo</b> ranks your average against the computer's strengths;
            <b> With friends</b> is up to 5 players on the same words and one clock, joined by a code
            {FEATURES.competitiveRush
              ? <>; in <b>Competitive</b> each player sets a word and solves the others', and it's rated.</>
              : '.'}</li>
          <li><b>Your profile</b> (top right) has a page each for your stats, achievements, game history, settings and
            more. Games against friends and every Word Set land in your history too.</li>
        </ul>
      ),
    },
    {
      title: 'Unlock as you play',
      body: (
        <>
          {/* A mock-up of the title screen's choices: inert, like the other steps'. */}
          <div class="choices tut-locks" inert aria-hidden="true">
            <div class="choice"><span class="choice-label">Practice</span></div>
            <div class="choice done locked">
              <LockIcon />
              <span class="choice-label">Two player <span class="tag">Locked</span></span>
              <span class="choice-detail choice-extra">Win a Practice game to unlock.</span>
            </div>
          </div>
          <ol class="tut-modes">
            <li><b>Win a Practice game</b> to open <b>Two player</b>.</li>
            <li><b>Win a two player game</b> (against the computer or a friend) to open <b>Word Sets</b> and its <b>Solo</b> games.</li>
            <li><b>Finish a Solo Rush or Solo Crush (in Word Sets) without giving up a word</b> to open <b>Daily Set</b>, <b>Daily Word</b>
              {FEATURES.competitiveRush ? <>, Word Sets <b>With friends</b> and <b>Competitive</b></>
                : <> and Word Sets <b>With friends</b></>}.</li>
          </ol>
          <p class="field-note">Each step earns a badge. A friend's invite link or join code always works, locked
            or not.</p>
        </>
      ),
    },
  ];
}

/**
 * The tutorial, opened from the title screen or the profile's Help. `onClose` gets whether to hide
 * it from the title screen from now on, or undefined if closed before the
 * last step (nothing changes).
 */
export function Tutorial({ hidden, onClose, onPlay }: {
  /** Whether the title screen hides it now. */
  hidden: boolean;
  onClose: (hide?: boolean) => void;
  /** Closes the tutorial and starts a single-player game. */
  onPlay: (hide: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [hide, setHide] = useState(hidden);
  // The definitions file is big: loaded from the step before the one that shows one.
  const definitions = useDefinitions(index >= 3);
  const all = steps(definitions);
  const last = index === all.length;
  const step = all[index];

  // The arrow keys step through too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(all.length, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [all.length]);

  return (
    <Modal title={last ? "You're ready" : step.title} class="tutorial" onClose={() => onClose(last ? hide : undefined)}>
      <div class="tut-step" key={index}>
        {last ? (
          <>
            <p>That's the game. Find the word from how many letters each guess shares with it.</p>
            <p>How to play, on the home page, in ☰ and in your profile's Help, has all the rules whenever you need them.</p>
            <label class="toggle tut-hide">
              <input type="checkbox" checked={hide} onChange={(e) => setHide(e.currentTarget.checked)} />
              Don't show the tutorial on the home page again
            </label>
            <p class="field-note">You can still open it from the home page's links, or turn it back on in your profile's Help.</p>
          </>
        ) : step.body}
      </div>
      <div class="tut-nav">
        <span class="tut-dots" hidden={last} role="img" aria-label={`Step ${index + 1} of ${all.length + 1}`}>
          {Array.from({ length: all.length + 1 }, (_, i) => (
            <span key={i} class={i === index ? 'dot current' : 'dot'} />
          ))}
        </span>
        <div class="row-btns">
          {index > 0 && <button type="button" class="btn" onClick={() => setIndex(index - 1)}>Back</button>}
          {last ? (
            <>
              {/* Done sits where Next was, so a quick tap through the steps ends on the home page, not a game. */}
              <button type="button" class="btn" onClick={() => onPlay(hide)}>Play now</button>
              <button type="button" class="btn primary" onClick={() => onClose(hide)}>Done</button>
            </>
          ) : (
            <button type="button" class="btn primary" onClick={() => setIndex(index + 1)}>Next</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
