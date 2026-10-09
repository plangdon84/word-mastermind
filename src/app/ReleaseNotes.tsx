import { Modal } from './panels';
import { APP_VERSION, RELEASES, type ReleasePicture } from './releases';

/**
 * The version in the title screen's footer; tapping it opens What's new. The label is
 * short to fit the footer's small print, and the name says What's new.
 */
export function VersionLink({ onOpen, tabIndex }: { onOpen?: () => void; tabIndex?: number }) {
  return (
    <button type="button" class="version-link" aria-label={`Version ${APP_VERSION} · What's new`}
      title="What's new" tabIndex={tabIndex} onClick={onOpen}>
      Version {APP_VERSION}
    </button>
  );
}

/** A mock-up of the thing a note is about: the real look, made inert. */
function Picture({ picture }: { picture: ReleasePicture }) {
  return (
    <div class="release-picture" inert aria-hidden="true">
      <footer class="credit title-footer">
        <ul>
          <li>{picture === 'how-to-play'
            ? <button type="button" tabIndex={-1}>How to play</button>
            : <VersionLink tabIndex={-1} />}</li>
        </ul>
      </footer>
    </div>
  );
}

/**
 * The popup the first time this device reaches the title screen on a new
 * version: that version's notes only. Closing it either way marks it seen.
 */
export function ReleasePopup({ onClose, onAll }: {
  onClose: () => void;
  /** Opens What's new, with every version's notes. */
  onAll: () => void;
}) {
  const release = RELEASES[0];
  return (
    <Modal title={`What's new in ${release.version}`} class="release-popup" onClose={onClose}>
      <ul class="release-notes">
        {release.notes.map((note) => (
          <li key={note.text}>
            {note.text}
            {note.picture && <Picture picture={note.picture} />}
          </li>
        ))}
      </ul>
      <div class="row-btns">
        <button type="button" class="btn primary" onClick={onClose}>Got it</button>
        {RELEASES.length > 1 && <button type="button" class="btn" onClick={onAll}>Earlier versions</button>}
      </div>
    </Modal>
  );
}

/** What's new: every version's notes, newest first. */
export function WhatsNew() {
  return (
    <div class="whats-new">
      {RELEASES.map((release) => (
        <section key={release.version} aria-labelledby={`release-${release.version}`}>
          <h3 id={`release-${release.version}`}>
            {release.version}{release.version === APP_VERSION && <span class="tag">This version</span>}
          </h3>
          <ul class="release-notes">
            {release.notes.map((note) => <li key={note.text}>{note.text}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
