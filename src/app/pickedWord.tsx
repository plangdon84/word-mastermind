import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { DefinitionBox, InfoIcon } from './components';
import { useDefinitions } from './definitions';
import { type ReportRequest, WordReportContext } from './reportIssue';

/**
 * The secret word step's slots, with an ⓘ beside a word chosen by Pick for me
 * (Dev Plan item 19zf): it opens the word's definition and Report this word.
 * A word the player typed gets neither. The definitions load on the first tap.
 */
export function PickedWordSlots({ draft, picked, report, children }: {
  draft: string;
  /** The word Pick for me last gave, if any: the ⓘ shows while the slots still hold it. */
  picked: string | null;
  /** What Report this word sends: this step's screen name. */
  report: () => ReportRequest;
  /** The slots. */
  children: ComponentChildren;
}) {
  const shown = picked !== null && draft === picked;
  const [open, setOpen] = useState(false);
  const definitions = useDefinitions(open);
  useEffect(() => {
    if (!shown) setOpen(false);
  }, [shown]);
  return (
    <>
      <div class="picked-word">
        <span />
        {children}
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
      {shown && open && (
        <WordReportContext.Provider value={report}>
          <DefinitionBox word={draft} state={definitions} />
        </WordReportContext.Provider>
      )}
    </>
  );
}
