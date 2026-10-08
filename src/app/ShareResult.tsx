import { useRef, useState } from 'preact/hooks';
import { ShareIcon } from './friendParts';
import { shareLink } from './share';

/**
 * Share a result (`shareText.ts`): the system share sheet where there is
 * one, else Copy, as the invite link does. Without clipboard access the text
 * is shown, selected, to copy by hand.
 */
export function ShareResult({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setShown(true);
      requestAnimationFrame(() => field.current?.select());
    }
  };
  return (
    <>
      {'share' in navigator ? (
        <button class="btn share" type="button" onClick={() => shareLink({ text })}><ShareIcon />Share</button>
      ) : (
        <button class="btn share" type="button" onClick={() => void copy()}>
          <ShareIcon />{copied ? 'Copied' : 'Copy result'}
        </button>
      )}
      {shown && (
        <textarea class="invite-link share-text" ref={field} readOnly rows={text.split('\n').length} aria-label="Your result"
          value={text} onFocus={(e) => e.currentTarget.select()} />
      )}
    </>
  );
}
