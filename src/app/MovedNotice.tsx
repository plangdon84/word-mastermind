import { Modal } from './panels';
import { markMovedNoticeDone, NEW_ORIGIN } from './moved';

/**
 * The popup on the old address (Dev Plan item 18f, issue #92): the game has
 * moved, and how to bring your games along, since each address keeps its
 * own. ✕ closes it for this visit; Done for good.
 */
export function MovedNotice({ signedIn, onSignIn, onBackup, onClose }: {
  signedIn: boolean;
  /** Opens the profile's Account, to sign in here first. */
  onSignIn: () => void;
  /** Opens the profile's Your data, to save a backup. */
  onBackup: () => void;
  onClose: () => void;
}) {
  const host = NEW_ORIGIN.replace('https://', '');
  return (
    <Modal title="Word Mastermind has moved" class="moved" onClose={onClose}>
      <p>The game now lives at <a href={NEW_ORIGIN}><b>{host}</b></a>. This address keeps working for now,
        but your games saved here don't move by themselves.</p>
      <ol class="moved-steps">
        {signedIn ? (
          <li>You're signed in, so your profile and games come with you.</li>
        ) : (
          <li>
            Sign in here first, so your profile and games come with you. Rather not? Save a backup here and
            restore it there (Profile → Your data).
            <div class="row-btns">
              <button type="button" class="btn" onClick={onSignIn}>Sign in here</button>
              <button type="button" class="btn" onClick={onBackup}>Save a backup</button>
            </div>
          </li>
        )}
        <li>Open <a href={NEW_ORIGIN}>{host}</a>.</li>
        <li>Add it to your home screen (in Safari, Share → Add to Home Screen), and remove the old one.</li>
        <li>Sign in there with the same account.</li>
        <li>Turn on turn alerts there, from the title screen or Profile → Settings.</li>
      </ol>
      <div class="row-btns">
        <a class="btn primary" href={NEW_ORIGIN}>Open {host}</a>
        <button type="button" class="btn" onClick={() => {
          markMovedNoticeDone();
          onClose();
        }}>Done</button>
      </div>
    </Modal>
  );
}
