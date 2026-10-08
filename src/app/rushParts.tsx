import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import {
  FEATURES, RANK_BYS, rankByHow, rankByName, SUGGEST_LIMIT, type Difficulty, type GuessResult, type Marks, type RankBy,
} from '../game';
import { Bubble, DefinitionBox, History, InfoIcon, Keyboard, ScoreHistory, Slots, SuggestButton } from './components';
import type { DefinitionsState } from './definitions';
import type { Message } from './hooks';
import { guessCount } from './messages';

/** The parts Solo Rush, Daily Rush and the lobbies share: the board while playing, and the words at the end. */

/**
 * The Rush · fastest / Crush · fewest switch (README "Rush modes"): what a
 * Word Set ranks by, or which Daily Set board is shown. With `label`, it's
 * headed "Ranked by:".
 */
export function RankBySwitch({ rankBy, onPick, label = false, disabled = false }: {
  rankBy: RankBy;
  onPick: (rankBy: RankBy) => void;
  label?: boolean;
  disabled?: boolean;
}) {
  return (
    <div class="rank-by">
      {label && <span class="rank-by-label" id="rank-by-label">Ranked by:</span>}
      <div class="seg" role="group" aria-label={label ? undefined : 'Ranked by'} aria-labelledby={label ? 'rank-by-label' : undefined}>
        {RANK_BYS.map((r) => (
          <button type="button" key={r} aria-pressed={rankBy === r} disabled={disabled} onClick={() => onPick(r)}>
            {rankByName(r)} · {rankByHow(r)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 83.4 seconds → "1:23". */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** A word's seconds, once it has an outcome. */
export const spentSeconds = (w: { startedAt: number | null; endedAt: number | null }) =>
  w.startedAt === null || w.endedAt === null ? null : (w.endedAt - w.startedAt) / 1000;

/**
 * One dot per word: green once found, grey once given up or not found,
 * outlined while being played (`current`, or null for none). `label` names
 * whose words they are, for a list of players.
 */
export function RushDots({ words, current, label }: {
  words: readonly { outcome: string | null }[];
  current: number | null;
  label?: string;
}) {
  const found = words.filter((w) => w.outcome === 'solved').length;
  const text = `${found} of ${words.length} words found`;
  return (
    <span class="rush-progress" role="img" aria-label={label ? `${label}: ${text}` : text}>
      {words.map((w, i) => (
        <span key={i} class={w.outcome === 'solved' ? 'dot solved' : w.outcome ? 'dot gave-up'
          : i === current ? 'dot current' : 'dot'} />
      ))}
    </span>
  );
}

/** The header's Rush bar: your dots, then any button (Pause, Players) and the clock. */
export function RushBar({ dots, clock, clockLabel, paused = false, children }: {
  dots: ComponentChildren;
  clock: string;
  clockLabel: string;
  paused?: boolean;
  children?: ComponentChildren;
}) {
  return (
    <div class="rush-bar">
      {dots}
      <span class="rush-clock">
        {children}
        <span class={paused ? 'stopwatch paused' : 'stopwatch'} role="timer" aria-label={clockLabel}>{clock}</span>
      </span>
    </div>
  );
}

/**
 * The word being played: its guesses (scores only on Extreme), then, unless
 * `entry` is false (a question is being asked), the input, its message line,
 * Easy's Suggest and the keyboard.
 */
export function RushBoard({
  difficulty, guesses, newestFirst, label, emptyText, marks, onMark, openDef, onToggleDef, definitions,
  entry, draft, shake, onShakeEnd, message, suggested, onSuggest, onShuffle, onLetter, onEnter, onBackspace,
}: {
  difficulty: Difficulty;
  guesses: readonly GuessResult[];
  newestFirst: boolean;
  label: string;
  emptyText: string;
  /** The marks shown (Easy's and Medium's), and on Medium what tapping a letter does. */
  marks: Marks | undefined;
  onMark?: (letter: string) => void;
  openDef: number;
  onToggleDef: (index: number) => void;
  definitions: DefinitionsState;
  entry: boolean;
  draft: string;
  shake: boolean;
  onShakeEnd: () => void;
  message: Message | null;
  /** Easy's Suggest: how many times this word has used it. Left out without `onSuggest`. */
  suggested: number;
  onSuggest?: () => void;
  onShuffle?: () => void;
  onLetter: (letter: string) => void;
  onEnter: () => void;
  onBackspace: () => void;
}) {
  return (
    <>
      {difficulty === 'extreme' ? (
        <ScoreHistory guesses={guesses} newestFirst={newestFirst} />
      ) : (
        <History guesses={guesses} newestFirst={newestFirst} openDef={openDef} label={label} emptyText={emptyText}
          marks={marks} onMark={onMark} onToggleDef={onToggleDef} definitions={definitions} />
      )}
      {entry && (
        <>
          <section class="entry">
            <Slots draft={draft} shake={shake} onShakeEnd={onShakeEnd} />
            <div class={message?.error ? 'message error' : 'message'} role="status">
              {message?.quiet ? <span class="visually-hidden">{message.text}</span> : message?.text}
            </div>
            {FEATURES.suggest && difficulty === 'easy' && onSuggest && (
              <SuggestButton left={SUGGEST_LIMIT - suggested} onSuggest={onSuggest} />
            )}
          </section>
          <Keyboard marks={marks} ready={draft.length === 5} onShuffle={onShuffle} onLetter={onLetter}
            onEnter={onEnter} onBackspace={onBackspace} />
        </>
      )}
    </>
  );
}

/** One word of a finished Rush. */
export interface RushWordRow {
  /** Null while it's hidden (a word you didn't find, until the day or the Rush is over). */
  word: string | null;
  /** Its bubbles show green. */
  lit: boolean;
  guesses: readonly GuessResult[];
  /** Whether you got to it. */
  reached: boolean;
  /** Why it wasn't found ("Gave up", "Not found"), or null once found. */
  missed: string | null;
  seconds: number | null;
  /** Whose word it is, in Competitive Rush. */
  setBy?: string;
}

/**
 * A finished Rush's words, a row each: its definition, the word, its
 * guesses (a tap shows them, with their marks, as they were) and its time.
 * `hiddenLabel` reads out a word that's still hidden.
 */
export function RushWords({ rows, marks, newestFirst, definitions, hiddenLabel }: {
  rows: readonly RushWordRow[];
  marks: readonly Marks[];
  newestFirst: boolean;
  definitions: DefinitionsState;
  hiddenLabel?: string;
}) {
  const [openDef, setOpenDef] = useState(-1);
  /** The word whose guesses are showing, and the guess whose definition is. */
  const [openWord, setOpenWord] = useState(-1);
  const [openGuessDef, setOpenGuessDef] = useState(-1);
  return (
    <ol class="rush-words">
      {rows.map((r, i) => (
        <li key={i}>
          {r.word ? (
            <button type="button" class="info" aria-label={`Definition of ${r.word}`}
              aria-expanded={openDef === i} onClick={() => setOpenDef(openDef === i ? -1 : i)}>
              <InfoIcon />
            </button>
          ) : <span class="info placeholder" aria-hidden="true" />}
          <span class="letters" aria-label={hiddenLabel && (r.word ?? hiddenLabel)}>
            {[...(r.word ?? '     ')].map((c, j) => (
              <Bubble key={j} letter={c.trim()} mark={r.lit ? 'in' : 'unmarked'} class="mini" />
            ))}
          </span>
          {r.guesses.length === 0 ? (
            <span class="rush-stat">{r.reached ? r.missed : 'Not reached'}</span>
          ) : (
            <button type="button" class="rush-stat toggle-guesses" aria-expanded={openWord === i}
              onClick={() => {
                setOpenWord(openWord === i ? -1 : i);
                setOpenGuessDef(-1);
              }}>
              {r.missed === null ? guessCount(r.guesses.length) : `${r.missed} · ${r.guesses.length}`}
              <span aria-hidden="true">{openWord === i ? ' ▴' : ' ▾'}</span>
            </button>
          )}
          <span class="rush-stat time">{r.seconds === null ? '' : formatClock(r.seconds)}</span>
          {r.setBy && <span class="rush-setter">{r.setBy}'s word</span>}
          {openDef === i && r.word && <DefinitionBox word={r.word} state={definitions} />}
          {openWord === i && (
            <History guesses={r.guesses} newestFirst={newestFirst} openDef={openGuessDef}
              label={`Your guesses at word ${i + 1}`} emptyText="No guesses." marks={marks[i]}
              onToggleDef={(g) => setOpenGuessDef(openGuessDef === g ? -1 : g)} definitions={definitions} />
          )}
        </li>
      ))}
    </ol>
  );
}

/** The two big numbers under a finished Rush's words: a label and a value each. */
export function RushSummary({ tiers }: { tiers: readonly (readonly [string, ComponentChildren])[] }) {
  return (
    <div class="rush-summary">
      {tiers.map(([label, value]) => (
        <div class="rush-tier" key={label}>
          <span class="rush-tier-label">{label}</span>
          <span class="rush-tier-value">{value}</span>
        </div>
      ))}
    </div>
  );
}
