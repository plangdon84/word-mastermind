import { useState } from 'preact/hooks';
import { NAME_MAX, validateName } from '../game';
import { NAME_ERROR } from './messages';
import type { Profile } from './profileStorage';

/**
 * Asks a player still on their Guest name to choose one, on a finished game
 * that goes on a leaderboard (Dev Plan item 18zy, README "Leaderboards").
 * It asks after every such game while the name is a Guest one: Skip only
 * hides it here, and isn't remembered. Item 18zw shows the new name on
 * every board, today's and past days'; the two ship together.
 */
export function GuestNamePrompt({ profile, onProfile }: { profile: Profile; onProfile: (profile: Profile) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  if (saved) {
    return (
      <p class="guest-name-saved" role="status">
        Saved. You'll be <b>{saved}</b> on the leaderboards.
      </p>
    );
  }
  if (skipped || profile.name !== null) return null;

  const save = (e: Event) => {
    e.preventDefault();
    const result = validateName(value);
    if (!result.ok) {
      setError(NAME_ERROR[result.error]);
      return;
    }
    onProfile({ ...profile, name: result.name });
    setSaved(result.name);
  };

  return (
    <form class="guest-name" onSubmit={save} aria-labelledby="guest-name-title">
      <p id="guest-name-title">
        You're on the leaderboard as <b>{profile.guestName}</b>. Choose a name for other players to see?
      </p>
      <label class="visually-hidden" for="guest-name-input">Your name</label>
      <input id="guest-name-input" class="text-input" type="text" value={value} maxLength={NAME_MAX * 2}
        placeholder="Your name" autoComplete="nickname" aria-describedby={error ? 'guest-name-error' : undefined}
        onInput={(e) => {
          setValue(e.currentTarget.value);
          setError(null);
        }} />
      <div class="row-btns">
        <button type="submit" class="btn primary small">Save name</button>
        <button type="button" class="btn small" onClick={() => setSkipped(true)}>Skip</button>
      </div>
      {error && <span id="guest-name-error" class="field-note error" role="alert">{error}</span>}
    </form>
  );
}
