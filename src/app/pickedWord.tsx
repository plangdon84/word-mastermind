import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { DefinitionBox, InfoIcon } from './components';
import { type ReportRequest, WordReportContext } from './reportIssue';

/**
 * The secret word step's ⓘ beside a word chosen by Pick for me (Dev Plan item
 * 19zf): it opens the word's definition and Report this word. A word the
 * player typed gets neither. The definitions load on the first tap, and the
 * box stays open for each new pick until the ⓘ closes it.
 *
 * The slots (with the ⓘ) and the definition are separate rows of the step, so
 * the word stays put whatever the definition's length: `slots` goes where the
 * word is, `definition` in the row under it that takes the step's spare room.
 */
export function usePickedWord({ draft, picked, report, slots }: {
  draft: string;
  /** The word Pick for me last gave, if any: the ⓘ shows while the slots still hold it. */
  picked: string | null;
  /** What Report this word sends: this step's screen name. */
  report: () => ReportRequest;
  /** The slots. */
  slots: ComponentChildren;
}): { slots: ComponentChildren; definition: ComponentChildren } {
  const shown = picked !== null && draft === picked;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!shown) setOpen(false);
  }, [shown]);
  return {
    slots: (
      <div class="picked-word">
        <span />
        {slots}
        <span>
          {shown && (
            <button type="button" class="info" aria-label={`Definition of ${draft}`} aria-expanded={open}
              onClick={(e) => {
                setOpen(!open);
                e.currentTarget.blur();
              }}>
              <InfoIcon />
            </button>
          )}
        </span>
      </div>
    ),
    definition: (
      <div class="setup-definition">
        {shown && open && (
          <WordReportContext.Provider value={report}>
            <DefinitionBox word={draft} />
          </WordReportContext.Provider>
        )}
      </div>
    ),
  };
}
