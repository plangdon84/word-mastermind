import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { DIFFICULTIES, NAME_MAX, NAME_MIN, validateName, type NameError } from '../game';
import {
  downloadFile, mergeProfile, mergeRecentSecrets, parseBackup, resetLocalData, serializeBackup, type ParsedBackup,
} from './backup';
import { DIFFICULTY_LABEL } from './components';
import { ProfileBadge } from './gameHeader';
import { BackIcon, HowToPlay } from './panels';
import type { ApiIdentity } from './apiIdentity';
import { useUnseenBadges } from './badges';
import { API_URL } from './config';
import { countriesByName } from './countries';
import { getAllGames, putGames } from './historyDb';
import { displayName, type Profile } from './profileStorage';
import { notePending } from './profileSync';
import { loadRecentSecrets, saveRecentSecrets } from './recentSecrets';
import { PROFILE_PAGES, PROFILE_PAGE_TITLE, type ProfilePage } from './profilePages';
import { openReport } from './reportIssue';
import type { Difficulty, Settings } from './settings';
import { TurnAlertsSetting } from './TurnAlerts';
import { Tutorial } from './Tutorial';
import { plural } from './messages';

const NAME_ERROR: Record<NameError, string> = {
  'too-short': `Use at least ${NAME_MIN} characters.`,
  'too-long': `Use at most ${NAME_MAX} characters.`,
  'invalid-characters': 'Use letters, numbers, spaces and punctuation only.',
  offensive: "Choose another name: this one can't be shown to other players.",
};

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/** `2026-09-28`, in local time, for file names. */
const fileDate = (ms: number) => {
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
};


/** Your name, editable in place. Clearing it goes back to the guest name. */
function NameField({ profile, onProfile }: { profile: Profile; onProfile: (profile: Profile) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = (e: Event) => {
    e.preventDefault();
    if (value.trim() === '') {
      onProfile({ ...profile, name: null });
      setEditing(false);
      return;
    }
    const result = validateName(value);
    if (!result.ok) {
      setError(NAME_ERROR[result.error]);
      return;
    }
    onProfile({ ...profile, name: result.name });
    setEditing(false);
  };

  if (!editing) {
    return (
      <div class="profile-name">
        <span class="profile-name-text">{displayName(profile)}</span>
        <button type="button" class="btn small" onClick={() => {
          setValue(profile.name ?? '');
          setError(null);
          setEditing(true);
        }}>
          {profile.name ? 'Edit name' : 'Set your name'}
        </button>
      </div>
    );
  }
  return (
    <form class="profile-name-form" onSubmit={save}>
      <label class="visually-hidden" for="profile-name">Your name</label>
      <input id="profile-name" class="text-input" type="text" value={value} maxLength={NAME_MAX * 2}
        placeholder={profile.guestName} autoComplete="nickname" autoFocus aria-describedby="profile-name-note"
        onInput={(e) => setValue(e.currentTarget.value)} />
      <div class="row-btns">
        <button type="submit" class="btn primary small">Save</button>
        <button type="button" class="btn small" onClick={() => setEditing(false)}>Cancel</button>
      </div>
      <span id="profile-name-note" class={error ? 'field-note error' : 'field-note'} role={error ? 'alert' : undefined}>
        {error ?? `${NAME_MIN} to ${NAME_MAX} characters. Other players see it in games and on leaderboards. Leave it empty to be ${profile.guestName}.`}
      </span>
    </form>
  );
}

/**
 * The profile (README "Profile"): a hub of who you are and a row per section,
 * each opening as a subpage. Everything stays in this browser unless you sign
 * in, which keeps it with the account too (`profileSync.ts`).
 */
export function ProfileScreen({
  profile, identity, onProfile, settings, onSettings, onBack, onHome, onGamesChanged, synced = false, page, onPage, pages,
  summaries,
}: {
  profile: Profile;
  /** Who the app is to the server, for turn alerts. */
  identity: ApiIdentity;
  onProfile: (profile: Profile) => void;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  /** Leaves the profile, from the hub. */
  onBack: () => void;
  /** Goes to the title screen: the tutorial's Play button, which starts a single player game from there. */
  onHome: () => void;
  /** A restore added games, so the sections showing them reload (and, signed in, sync). */
  onGamesChanged: () => void;
  /** Signed in: the profile, settings and games are kept on the server too. */
  synced?: boolean;
  /** The subpage open, or null for the hub. */
  page: ProfilePage | null;
  onPage: (page: ProfilePage | null) => void;
  /**
   * The sections the app fills in. Account and Friends are left out when
   * there's no server to sign in to.
   */
  pages: { account?: ComponentChildren; friends?: ComponentChildren; stats: ComponentChildren; achievements: ComponentChildren; history: ComponentChildren };
  /** Each row's one-line summary, where there's something to say. */
  summaries: Partial<Record<ProfilePage, string>>;
}) {
  const [countries] = useState(countriesByName);
  const [dataMessage, setDataMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [importing, setImporting] = useState<ParsedBackup | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [help, setHelp] = useState<'tutorial' | 'how-to' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const exportBackup = async () => {
    try {
      const games = await getAllGames();
      const text = serializeBackup({ profile, settings, recentSecrets: loadRecentSecrets(), games }, Date.now());
      downloadFile(`word-mastermind-backup-${fileDate(Date.now())}.json`, 'application/json', text);
      setDataMessage({ text: `Backup saved with ${plural(games.length, 'game')}.`, error: false });
    } catch {
      setDataMessage({ text: "Couldn't read your games to back them up.", error: true });
    }
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseBackup(await file.text(), profile);
    setDataMessage(parsed ? null : { text: "That file isn't a Word Mastermind backup.", error: true });
    setImporting(parsed);
  };

  const confirmImport = async () => {
    if (!importing) return;
    const { backup, skipped } = importing;
    try {
      await putGames(backup.games);
    } catch {
      setDataMessage({ text: "Couldn't save the games from the backup.", error: true });
      setImporting(null);
      return;
    }
    // Signed in, the restored games go to the account too.
    notePending(backup.games.map((g) => g.id));
    onGamesChanged();
    onProfile(mergeProfile(profile, backup.profile));
    onSettings(backup.settings);
    saveRecentSecrets(mergeRecentSecrets(loadRecentSecrets(), backup.recentSecrets));
    setImporting(null);
    setDataMessage({
      text: `Restored ${plural(backup.games.length, 'game')}.${skipped ? ` ${plural(skipped, 'game')} couldn't be read.` : ''}`,
      error: false,
    });
  };

  const reset = async () => {
    try {
      await resetLocalData();
    } finally {
      // Start again from a clean slate: a new profile, no games, default settings.
      location.reload();
    }
  };

  const newBadges = useUnseenBadges();
  // Signed out, Friends is left off: Account already says to sign in to add friends. A friend's link still opens it.
  const rows = PROFILE_PAGES.filter((p) => (p !== 'account' && p !== 'friends') || (pages[p] !== undefined && (p !== 'friends' || synced)));

  if (page !== null) {
    const content = page === 'settings' ? (
      <section class="profile-section" aria-label="Settings">
          <div class="menu-group">
            <span class="menu-label" id="default-diff-label">Difficulty for new games</span>
            <div class="seg" role="group" aria-labelledby="default-diff-label">
              {DIFFICULTIES.map((d) => (
                <button type="button" key={d} aria-pressed={settings.difficulty === d}
                  onClick={() => onSettings({ ...settings, difficulty: d })}>
                  {DIFFICULTY_LABEL[d]}
                </button>
              ))}
            </div>
            <span class="field-note">Also changes when you pick one before a game. Change a game's difficulty from its ☰ menu.</span>
          </div>
          <div class="menu-group">
            <span class="menu-label">Newest guess first</span>
            <div class="guess-order">
              {DIFFICULTIES.map((d) => (
                <label class="toggle" key={d}>
                  <input type="checkbox" checked={settings.newestFirst[d]}
                    onChange={(e) => onSettings({
                      ...settings, newestFirst: { ...settings.newestFirst, [d]: e.currentTarget.checked },
                    })} />
                  {DIFFICULTY_LABEL[d]}
                </label>
              ))}
            </div>
            <span class="field-note">Checked: newest at the top. Otherwise the newest is at the bottom.</span>
          </div>
          <div class="menu-group">
            <span class="menu-label">Keyboard</span>
            <label class="toggle">
              <input type="checkbox" checked={settings.enterRight}
                onChange={(e) => onSettings({ ...settings, enterRight: e.currentTarget.checked })} />
              Enter on the right
            </label>
            <span class="field-note">Puts Enter at the right end of the bottom row and ⌫ at the left. On this device only.</span>
          </div>
          <div class="menu-group">
            <label class="toggle">
              <input type="checkbox" checked={settings.shareMarks}
                onChange={(e) => onSettings({ ...settings, shareMarks: e.currentTarget.checked })} />
              Share my Medium marks
            </label>
            <span class="field-note">Against a friend at Medium, they see the letters you've marked, sent with each guess.</span>
          </div>
          {API_URL && <TurnAlertsSetting apiUrl={API_URL} identity={identity} />}
      </section>
    ) : page === 'help' ? (
      <section class="profile-section" aria-label="Help">
          <label class="toggle">
            <input type="checkbox" checked={settings.showTutorial}
              onChange={(e) => onSettings({ ...settings, showTutorial: e.currentTarget.checked })} />
            Show the tutorial on the home page
          </label>
          <div class="row-btns start">
            <button type="button" class="btn" onClick={() => setHelp('tutorial')}>Take the tutorial</button>
            <button type="button" class="btn" onClick={() => setHelp('how-to')}>How to play</button>
            <button type="button" class="btn" onClick={() => openReport({ screen: 'Profile' })}>Report an issue</button>
          </div>
          <span class="field-note">A bug, an idea, or a word that's missing or wrong. Reports go to the game's GitHub issues.</span>
          {help === 'how-to' && <HowToPlay onClose={() => setHelp(null)} />}
          {help === 'tutorial' && (
            <Tutorial hidden={!settings.showTutorial}
              onClose={(hide) => {
                setHelp(null);
                if (hide !== undefined) onSettings({ ...settings, showTutorial: !hide });
              }}
              onPlay={(hide) => {
                setHelp(null);
                onSettings({ ...settings, mode: 'single', showTutorial: !hide });
                onHome();
              }} />
          )}
      </section>
    ) : page === 'data' ? (
      <section class="profile-section" aria-label="Your data">
          {synced ? (
            <p class="field-note">
              You're signed in, so your profile, settings and games are kept with your account too, and reach
              every device you sign in on. A backup file is still yours to keep.
            </p>
          ) : (
            <p class="field-note">
              Your profile and games are kept in this browser only. Browsers can clear them (Safari may after
              about a week without a visit), so save a backup now, or sign in to keep them with an account.
            </p>
          )}
          <div class="row-btns start">
            <button type="button" class="btn" onClick={exportBackup}>Save a backup</button>
            <button type="button" class="btn" onClick={() => fileInput.current?.click()}>Restore a backup</button>
            <input ref={fileInput} type="file" accept="application/json,.json" hidden
              onChange={(e) => {
                void chooseFile(e.currentTarget.files?.[0]);
                e.currentTarget.value = '';
              }} />
          </div>
          {importing && (
            <div class="panel inline">
              <h2>Restore {plural(importing.backup.games.length, 'game')}?</h2>
              <p>
                Games already here are kept. Your name, country and settings are replaced by the backup's.
                {importing.skipped > 0 && ` ${plural(importing.skipped, 'game')} in the file couldn't be read.`}
              </p>
              <div class="row-btns">
                <button type="button" class="btn primary" onClick={confirmImport}>Restore</button>
                <button type="button" class="btn" onClick={() => setImporting(null)}>Cancel</button>
              </div>
            </div>
          )}
          {dataMessage && (
            <p class={dataMessage.error ? 'field-note error' : 'field-note'} role="status">{dataMessage.text}</p>
          )}
          {confirmReset ? (
            <div class="panel inline warning">
              <h2>Reset your profile?</h2>
              <p>
                <b>This deletes your name, settings, games in progress and your whole game history from this
                browser.</b> It can't be undone, except from a backup.
              </p>
              <div class="row-btns">
                <button type="button" class="btn danger" onClick={reset}>Reset profile</button>
                <button type="button" class="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" class="btn danger-outline" onClick={() => setConfirmReset(true)}>Reset profile</button>
          )}
      </section>
    ) : pages[page];
    return (
      <div class="app profile-screen">
        <header class="step-head">
          <button type="button" class="icon-btn" aria-label="Back to profile" onClick={() => onPage(null)}><BackIcon /></button>
          <h2>{PROFILE_PAGE_TITLE[page]}</h2>
        </header>
        {content}
      </div>
    );
  }

  return (
    <div class="app profile-screen">
      <header class="step-head">
        <button type="button" class="icon-btn" aria-label="Back" onClick={onBack}><BackIcon /></button>
        <h2>Profile</h2>
      </header>

      <section class="profile-card" aria-label="You">
        <ProfileBadge profile={profile} class="big" />
        <div class="profile-who">
          <NameField profile={profile} onProfile={onProfile} />
          <label class="profile-country">
            <span class="info-label">Country</span>
            <select class="select" value={profile.country ?? ''}
              onChange={(e) => onProfile({ ...profile, country: e.currentTarget.value || null })}>
              <option value="">Prefer not to say</option>
              {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
          <span class="field-note">Member since {formatDate(profile.memberSince)}</span>
        </div>
      </section>

      <nav class="choices profile-rows" aria-label="Profile sections">
        {rows.map((p) => (
          <button type="button" class="choice profile-row" key={p} onClick={() => onPage(p)}>
            <span class="choice-label">
              {PROFILE_PAGE_TITLE[p]}
              {/* The profile icon's dot leads here: the same dot, on the row it's about. */}
              {p === 'achievements' && newBadges && <span class="row-dot" role="img" aria-label="new badges" />}
            </span>
            {summaries[p] && <span class="choice-detail">{summaries[p]}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
