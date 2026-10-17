import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { cycleMark, evaluateGuess, type GuessResult, type Marks } from '../game';
import { History, InSet, MarkKey } from './components';

/*
 * The sample game (Dev Plan item 18zo, README "Tutorial"): a game against
 * BEACH played out one guess at a time, after the tutorial's steps and from
 * How to play. Each guess comes in with its score, the step says what that
 * score tells you, and you tap the letters it settles, on the real guess
 * list. Nothing is saved or counted.
 */

/** One step of the tutorial or the sample game: the dialog's title and what's under it. */
export interface Step {
  title: string;
  body: ComponentChildren;
}

export const SAMPLE_SECRET = 'beach';

/**
 * Each guess, what its score tells you, and every mark you should have once
 * you've taken it in. `sampleGame.test.ts` checks the marks are exactly what
 * Easy's letter logic (`deduceMarks`) settles, so the reasoning never goes
 * beyond the scores.
 */
export const SAMPLE_GUESSES: { word: string; text: ComponentChildren; marks: Marks }[] = [
  {
    word: 'crane',
    text: <>Three of C, R, A, N and E are in the word, but you're not told which three. Nothing is certain yet,
      so there's nothing to mark.</>,
    marks: {},
  },
  {
    word: 'dummy',
    text: <>A 0 rules out every letter in the guess. Mark D, U, M and Y out: tap each one twice. A mark applies
      to that letter everywhere, so both Ms change at once.</>,
    marks: { d: 'out', u: 'out', m: 'out', y: 'out' },
  },
  {
    word: 'crank',
    text: <>CRANK is CRANE with K in place of E, and it scores one less. So E is in and K is out. Tap E once
      for in, and K twice for out.</>,
    marks: { d: 'out', u: 'out', m: 'out', y: 'out', e: 'in', k: 'out' },
  },
  {
    word: 'drunk',
    text: <>Another 0: R and N are out too (you knew about D, U and K). That leaves C, A and E as CRANE's three.
      Mark R and N out, and C and A in.</>,
    marks: { d: 'out', u: 'out', m: 'out', y: 'out', e: 'in', k: 'out', r: 'out', n: 'out', c: 'in', a: 'in' },
  },
  {
    word: 'batch',
    text: <>A and C are in, so 2 of BATCH's other letters, B, T and H, are in too. Which two isn't settled yet,
      so there's nothing new to mark.</>,
    marks: { d: 'out', u: 'out', m: 'out', y: 'out', e: 'in', k: 'out', r: 'out', n: 'out', c: 'in', a: 'in' },
  },
  {
    word: 'tummy',
    text: <>T is out (you knew about U, M and Y, and the double M counts once). So BATCH's other two are B and H.
      Mark T out, and B and H in.</>,
    marks: {
      d: 'out', u: 'out', m: 'out', y: 'out', e: 'in', k: 'out', r: 'out', n: 'out', c: 'in', a: 'in',
      t: 'out', b: 'in', h: 'in',
    },
  },
];

const GUESSES: GuessResult[] = [...SAMPLE_GUESSES.map((g) => g.word), SAMPLE_SECRET]
  .map((w) => evaluateGuess(w, SAMPLE_SECRET));

/** The letters whose mark isn't yet what the step wants, as "E in, K out". */
function stillToMark(marks: Marks, want: Marks): string[] {
  const letters = [...new Set([...Object.keys(marks), ...Object.keys(want)])].sort();
  return letters.filter((c) => marks[c] !== want[c])
    .map((c) => `${c.toUpperCase()} ${want[c] ?? 'unmarked'}`);
}

/**
 * The sample game's steps: an introduction, a step per guess, and the win.
 * Your marks for each step are kept while you go back and forth; a step you
 * didn't finish starts the next with its marks done for you.
 */
export function useSampleSteps(): Step[] {
  const [own, setOwn] = useState<Record<number, Marks>>({});

  // No ⓘ (hidden by the styles): the tutorial shows it earlier, and the letters need the room on a phone.
  const board = (count: number, marks: Marks, onMark?: (letter: string) => void) => (
    <div class="tut-live">
      <InSet marks={marks} />
      <History guesses={GUESSES.slice(0, count)} newestFirst={false} marks={marks} onMark={onMark}
        openDef={-1} onToggleDef={() => {}} definitions={{ status: 'idle' }} />
    </div>
  );

  const guessSteps = SAMPLE_GUESSES.map(({ word, text, marks: want }, i): Step => {
    const marks = own[i] ?? SAMPLE_GUESSES[i - 1]?.marks ?? {};
    const left = stillToMark(marks, want);
    const nothing = stillToMark(SAMPLE_GUESSES[i - 1]?.marks ?? {}, want).length === 0;
    const score = GUESSES[i].score;
    return {
      title: `Guess ${i + 1}: ${word.toUpperCase()} scores ${score}`,
      body: (
        <>
          <p>{text}</p>
          {board(i + 1, marks, (c) => setOwn({ ...own, [i]: cycleMark(marks, c) }))}
          {/* Read out as it changes, so a screen reader hears each tap land. */}
          <p class={left.length ? 'tut-task' : 'tut-task done'} role="status">
            {left.length === 0 ? (nothing ? 'Nothing to mark. Next brings the next guess.' : '✓ That\'s it.')
              : `Still to mark: ${left.join(', ')}.`}
          </p>
          {left.length > 0 && (
            <button type="button" class="link-btn" onClick={() => setOwn({ ...own, [i]: want })}>Mark them for me</button>
          )}
        </>
      ),
    };
  });

  const done = SAMPLE_GUESSES[SAMPLE_GUESSES.length - 1].marks;
  return [
    {
      title: 'Play a sample game',
      body: (
        <>
          <p>Now play a game through. The word is still <b>BEACH</b>, but play as if you didn't know it: everything
            here comes from the scores alone.</p>
          <p>Each guess comes in with its score. Read what it tells you, then tap the letters in the guesses to mark
            them, as on Medium: once for in, twice for out.</p>
          <MarkKey />
        </>
      ),
    },
    ...guessSteps,
    {
      title: `Guess ${GUESSES.length}: BEACH`,
      body: (
        <>
          <p>B, E, A, C and H are all in, and the only word they spell is BEACH. Found it in {GUESSES.length} guesses,
            every step worked out from the scores.</p>
          {board(GUESSES.length, done)}
          <p class="field-note">On Easy, the app marks letters like this for you after each guess.</p>
        </>
      ),
    },
  ];
}

/** The arrow keys step back and forth too, from 0 to `max`. */
export function useArrowSteps(setIndex: (f: (i: number) => number) => void, max: number) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(max, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [max]);
}

/** Step dots for one part: the tutorial's steps, or the sample game's. */
export function StepDots({ index, count, label }: { index: number; count: number; label: string }) {
  return (
    <span class="tut-dots" role="img" aria-label={`${label}${index + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => <span key={i} class={i === index ? 'dot current' : 'dot'} />)}
    </span>
  );
}

/** The sample game on its own, from How to play: its steps, then Done. */
export function SampleGame({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const steps = useSampleSteps();
  const last = index === steps.length - 1;
  useArrowSteps(setIndex, steps.length - 1);
  // Focus starts on Next, as the button that opened this is gone.
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => next.current?.focus(), []);
  return (
    <>
      <h3 class="tut-sub">{steps[index].title}</h3>
      <div class="tut-step" key={index}>{steps[index].body}</div>
      <div class="tut-nav">
        <StepDots index={index} count={steps.length} label="Step " />
        <div class="row-btns">
          {index > 0 && <button type="button" class="btn" onClick={() => setIndex(index - 1)}>Back</button>}
          <button type="button" class="btn primary" ref={next}
            onClick={() => (last ? onDone() : setIndex(index + 1))}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </>
  );
}
