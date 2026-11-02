import { APP_VERSION } from './version';

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
