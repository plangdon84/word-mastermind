import { useEffect, useRef, useState } from 'preact/hooks';
import { NAME_MAX, validateName } from '../game';
import { NAME_ERROR } from './messages';
import type { Profile } from './profileStorage';

/**
 * After a new account's first sign-in with Google (Dev Plan item 18zz,
 * README "Accounts"), asks "Use <name> as your name?" with **Use it** or
 * **Choose another**, while the player's name is still a Guest one. Google's
 * name is only kept if it's chosen, as the profile's name (which the synced
 * profile carries to every device, so no later sign-in asks again).
 */
export function GoogleNamePrompt({ name, profile, onProfile }: {
  /** Google's name, already passing `validateName`. */
  name: string;
  profile: Profile;
  onProfile: (profile: Profile) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const asking = !saved && !skipped && profile.name === null;
  // The question takes focus, so keyboard and screen reader users know a choice is waiting.
  useEffect(() => {
    if (asking) title.current?.focus();
  }, [asking]);

  if (saved) {
    return (
      <p class="field-note google-name-saved" role="status">
        You're <b>{saved}</b> now. You can change your name at any time on your profile.
      </p>
    );
  }
  if (!asking) return null;

  const keep = (chosen: string) => {
    onProfile({ ...profile, name: chosen });
    setSaved(chosen);
  };
  const save = (e: Event) => {
    e.preventDefault();
    const result = validateName(value);
    if (!result.ok) {
      setError(NAME_ERROR[result.error]);
      return;
    }
    keep(result.name);
  };

  return (
    <div class="panel inline account-ask google-name" role="group" aria-labelledby="google-name-title">
      <h2 id="google-name-title" ref={title} tabIndex={-1}>Use {name} as your name?</h2>
      <p>
        Other players see your name in games and on leaderboards. To stay anonymous, choose another. Your Google
        name isn't kept unless you use it.
      </p>
      {choosing ? (
        <form class="guest-name" onSubmit={save}>
          <label class="visually-hidden" for="google-name-input">Your name</label>
          <input id="google-name-input" class="text-input" type="text" value={value} maxLength={NAME_MAX * 2}
            placeholder="Your name" autoComplete="nickname" autoFocus
            aria-describedby={error ? 'google-name-error' : undefined}
            onInput={(e) => {
              setValue(e.currentTarget.value);
              setError(null);
            }} />
          <div class="row-btns">
            <button type="submit" class="btn primary small">Save name</button>
            <button type="button" class="btn small" onClick={() => setSkipped(true)}>
              Stay {profile.guestName}
            </button>
          </div>
          {error && <span id="google-name-error" class="field-note error" role="alert">{error}</span>}
        </form>
      ) : (
        <div class="row-btns">
          <button type="button" class="btn primary" onClick={() => keep(name)}>Use it</button>
          <button type="button" class="btn" onClick={() => setChoosing(true)}>Choose another</button>
        </div>
      )}
    </div>
  );
}
