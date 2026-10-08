import type { OpenProfile } from './profilePages';
import { useEffect, useMemo, useState } from 'preact/hooks';
// Inlined, so its fill (currentColor) follows the text colour in dark mode.
import logo from '../assets/logo.svg?raw';
import { ProfileButton } from './gameHeader';
import { BackIcon, HowToPlay, LockIcon } from './panels';
import { API_URL } from './config';
import { receivePlacements } from './badges';
import { dailyApi, type DailyToday } from './dailyApi';
import { FriendGamesList, LobbyInvitesList } from './FriendGamesList';
import { useNow } from './hooks';
import { countdownText } from './messages';
import { openReport } from './reportIssue';
import type { ApiIdentity } from './apiIdentity';
import type { Profile } from './profileStorage';
import type { Difficulty, Mode, Opponent, RushKind, Settings, Strength } from './settings';
import { FEATURES, isLive, isRatedDifficulty, ratedDifficultyFor, normalizeLobbyCode, type LobbyKind, type OpenModes, type TimeControl } from '../game';
import type { BoardId } from './LeaderboardsScreen';
import { Tutorial } from './Tutorial';
import { TurnAlertsPrompt } from './TurnAlerts';
import { MovedNotice } from './MovedNotice';
import { movedNoticeDue } from './moved';
import { ReleasePopup, VersionLink, WhatsNew } from './ReleaseNotes';
import { markVersionSeen, readSeenVersion, releasePopupDue } from './releases';

const SIGN_IN_OFFER_KEY = 'word-mastermind:sign-in-offer:v1';

/** Whether "Not now" was said to the title screen's offer to sign in. Browser storage can be blocked. */
function signInOfferDismissed(): boolean {
  try {
    return localStorage.getItem(SIGN_IN_OFFER_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

/**
 * New players (Dev Plan item 18, issue #81): signing in, then turn alerts,
 * offered on the title screen rather than only in the profile and a first
 * friend game. One card at a time, each until it's done or you say Not now.
 */
function SetupOffers({ apiUrl, identity, onSignIn }: { apiUrl: string; identity: ApiIdentity; onSignIn: () => void }) {
  const [dismissed, setDismissed] = useState(signInOfferDismissed);
  if (identity.token === null && !dismissed) {
    return (
      <section class="tutorial-card" aria-label="Sign in">
        <p><b>Keep your games safe.</b> Sign in to keep your profile and games with an account on every device,
          and add friends.</p>
        <div class="row-btns">
          <button type="button" class="btn primary" onClick={onSignIn}>Sign in</button>
          <button type="button" class="btn" onClick={() => {
            try {
              localStorage.setItem(SIGN_IN_OFFER_KEY, 'dismissed');
            } catch {
              // It shows again next visit; nothing else is lost.
            }
            setDismissed(true);
          }}>Not now</button>
        </div>
      </section>
    );
  }
  return <TurnAlertsPrompt apiUrl={apiUrl} identity={identity}
    offer="Get a notification when it's your turn against a friend, or a Rush with Friends ends, even with the game closed." />;
}

type Step = 'home' | 'rush' | 'friends' | 'opponent' | 'strength' | 'turn' | 'difficulty' | 'news';

interface Choice<T> {
  value: T;
  label: string;
  detail: string;
  /** Shown but not selectable yet. */
  later?: boolean;
}

const MODES: Choice<Mode>[] = [
  { value: 'single', label: 'Single player', detail: "Find the computer's secret word." },
  { value: 'two', label: 'Two player', detail: "Race an opponent to find each other's word." },
  { value: 'rush', label: 'Rush', detail: 'Find 4 words in a row against the clock.' },
];

const CONTINUE_LABEL: Record<Mode | 'daily' | 'lobby' | 'competitive', string> = {
  single: 'Continue single player', two: 'Continue two player', rush: 'Continue Solo Rush', daily: 'Continue Daily Set',
  lobby: 'Continue Rush with Friends', competitive: 'Continue Competitive Rush',
};

/** The kinds of Rush (README "Rush modes"); one switched off for the launch isn't offered. */
const RUSH_KINDS = ([
  { value: 'solo', label: 'Solo Rush', detail: 'Practice solving multiple secret words in a timed trial.' },
  { value: 'daily', label: 'Daily Set', detail: "The day's themed set of 4 words, once a day, on a leaderboard.", later: !API_URL },
  { value: 'friends', label: 'Rush with Friends', detail: 'Up to 5 players solve the same 4 words on one clock.', later: !API_URL },
  { value: 'competitive', label: 'Competitive Rush', detail: "Each player sets a word and solves the others'. Rated.", later: !API_URL },
] satisfies Choice<RushKind>[]).filter((c) => c.value !== 'competitive' || FEATURES.competitiveRush);

const OPPONENTS = ([
  { value: 'computer', label: 'Computer', detail: 'Play now, on this device.' },
  API_URL
    ? { value: 'friend', label: 'A friend', detail: 'Send an invite link. Play live, or take turns over days.' }
    : { value: 'friend', label: 'A friend', detail: 'Challenge someone you know.', later: true },
  { value: 'random', label: 'Random opponent', detail: 'Get matched with a player near your rating. Signed in.', later: !API_URL },
] satisfies Choice<Opponent>[]).filter((c) => c.value !== 'random' || FEATURES.randomOpponent);

/** The timings, in two groups: live on a chess clock, or turns over days. */
const TIME_GROUPS: { label: string; note: string; choices: { value: TimeControl; label: string }[] }[] = [
  {
    label: 'Live',
    note: 'Play now, together. Each player has a chess clock that runs only on their turn: run out and you lose.',
    choices: [{ value: '15m', label: '15 min' }, { value: '10m', label: '10 min' }, { value: '5m', label: '5 min' }],
  },
  {
    label: 'Take turns over days',
    note: 'Guess when it suits you. Miss your time and you concede.',
    choices: [{ value: '1d', label: '1 day a guess' }, { value: '3d', label: '3 days a guess' }],
  },
];

// How each plays is in README "Computer strength"; the descriptions stay in character.
const STRENGTHS: Choice<Strength>[] = [
  { value: 'casual', label: 'Casual', detail: 'Can play, but sometimes loses its train of thought.' },
  { value: 'skilled', label: 'Skilled', detail: 'Determined, but still working on its technique.' },
  { value: 'expert', label: 'Expert', detail: 'Highly skilled, and can challenge the best players.' },
  { value: 'mastermind', label: 'Mastermind', detail: 'The savant Word Mastermind player.' },
];

const DIFFICULTIES: Choice<Difficulty>[] = [
  { value: 'easy', label: 'Easy', detail: 'The app works out which letters are in or out for you.' },
  { value: 'medium', label: 'Medium', detail: 'Tap letters to mark them in or out yourself.' },
  { value: 'hard', label: 'Hard', detail: 'Just your guesses and their scores.' },
  { value: 'extreme', label: 'Extreme', detail: 'Only the scores. Remember your words.' },
];

/**
 * A choice you can't pick for now (today's Daily Rush, once played, or a
 * mode not yet unlocked), greyed out with a tag and maybe a link.
 */
interface Done {
  tag: string;
  /** A padlock at the tile's right: the mode unlocks as you play. */
  lock?: boolean;
  link?: { label: string; onClick: () => void };
}

/** How to open each locked choice (README "Unlocking modes"). */
const HOW_TO_UNLOCK = {
  two: 'Win a single player game to unlock.',
  rush: 'Win a two player game to unlock.',
  otherRush: 'Finish a Solo Rush without giving up a word to unlock.',
};

const locked = (how: string, link?: Done['link']): { done: Done; detail: string } =>
  ({ done: { tag: 'Locked', lock: true, link }, detail: how });

function Choices<T>({ label, choices, selected, onPick, details, done }: {
  label: string;
  choices: Choice<T>[];
  /** The choice to mark as picked, or null for none (the home screen, where a tap goes straight on). */
  selected: T | null;
  onPick: (value: T) => void;
  /** A second line under a choice's detail, e.g. today's Daily Rush theme. */
  details?: Partial<Record<string, string>>;
  done?: Partial<Record<string, Done>>;
}) {
  return (
    <div class="choices" role="group" aria-label={label}>
      {choices.map((c) => {
        const finished = done?.[String(c.value)];
        if (finished) {
          // Not a button (the tag says why), so the link inside it can be one.
          return (
            <div class={finished.lock ? 'choice done locked' : 'choice done'} key={String(c.value)}>
              {finished.lock && <LockIcon />}
              <span class="choice-label">
                {c.label}
                <span class="tag">{finished.tag}</span>
              </span>
              {/* Locked, how to unlock it stands in for the description, which comes back once it's open. */}
              {!finished.lock && <span class="choice-detail">{c.detail}</span>}
              {details?.[String(c.value)] && <span class="choice-detail choice-extra">{details[String(c.value)]}</span>}
              {finished.link && (
                <button type="button" class="link-btn choice-link" onClick={finished.link.onClick}>
                  {finished.link.label}
                </button>
              )}
            </div>
          );
        }
        return (
        <button type="button" class="choice" key={String(c.value)} disabled={c.later}
          aria-pressed={!c.later && c.value === selected} onClick={() => onPick(c.value)}>
          <span class="choice-label">
            {c.label}
            {c.later && <span class="tag">Coming later</span>}
          </span>
          <span class="choice-detail">{c.detail}</span>
          {!c.later && details?.[String(c.value)] && <span class="choice-detail choice-extra">{details[String(c.value)]}</span>}
        </button>
        );
      })}
    </div>
  );
}

/** What Daily Rush says on the title screen: today's theme and the time until the next set. */
function dailyDetail(today: DailyToday | null, now: number): string | undefined {
  if (!today) return undefined;
  const next = `next set in ${countdownText(today.nextAt - now)}`;
  const status = today.run?.status;
  // Yesterday's run, still going when the day changed: it can be finished, off the board.
  if (status === 'playing' && today.run?.day !== today.day) return `Yesterday's ${today.runTheme ?? 'set'} · in progress`;
  if (!today.theme) return `No set today · ${next}`;
  if (status === 'playing') return `Today: ${today.theme} · in progress`;
  if (status) return `Today: ${today.theme} · ${next}`;
  return `Today: ${today.theme} · ${next}`;
}

/**
 * The title screen and the setup steps after it:
 * Single player → difficulty, Rush → kind → difficulty, or Two player → opponent → strength → difficulty.
 * Each step pre-selects the last choice made.
 */
export function TitleScreen({
  settings, onSettings, profile, identity, friendGamesVersion, onProfile, inProgress, dailyInProgress, onContinue, onStart,
  onOpenFriendGame, onDaily, lobbyInProgress, onLobby, onLeaderboards, open,
}: {
  settings: Settings;
  onSettings: (settings: Settings) => void;
  profile: Profile;
  /** Who the app is to the server, for the list of games against friends. */
  identity: ApiIdentity;
  /** Changes when games from your other devices arrive, so the list reloads. */
  friendGamesVersion: number;
  onProfile: OpenProfile;
  /** Which modes have a game in progress that can be resumed. */
  inProgress: Record<Mode, boolean>;
  /** Today's Daily Rush was started on this device and isn't over. */
  dailyInProgress: boolean;
  onContinue: (mode: Mode) => void;
  /** Opens today's Daily Rush, one already played or in progress, without starting one. */
  onDaily: () => void;
  /** Opens the Leaderboards page, or one board on it (Back then returns here). */
  onLeaderboards: (board?: BoardId) => void;
  onStart: () => void;
  /** You're in a Rush with Friends or Competitive Rush lobby that isn't over. */
  lobbyInProgress: LobbyKind | null;
  /** Opens a Rush with Friends lobby: yours in progress (no code), or one to join by its code. */
  onLobby: (code?: string) => void;
  /** Opens a game against a friend from the list of yours. */
  onOpenFriendGame: (id: string) => void;
  /** Which modes you've unlocked (README "Unlocking modes"); null while your games load, when nothing shows locked. */
  open: OpenModes | null;
}) {
  const resumable = (['single', 'two', 'rush'] as const).filter((m) => inProgress[m]);
  const continues: (Mode | 'daily' | 'lobby' | 'competitive')[] = [
    ...resumable, ...(dailyInProgress ? ['daily' as const] : []),
    ...(lobbyInProgress ? [lobbyInProgress === 'competitive' ? 'competitive' as const : 'lobby' as const] : []),
  ];
  // Today's Daily Rush, for its theme and countdown, and whether you've played it.
  const [daily, setDaily] = useState<DailyToday | null>(null);
  /** The server's clock minus this device's, for the countdown. */
  const [offset, setOffset] = useState(0);
  const api = useMemo(() => (API_URL ? dailyApi(API_URL, identity) : null), [identity]);
  useEffect(() => {
    let live = true;
    api?.today().then((t) => {
      if (!live) return;
      setDaily(t);
      setOffset(t.now - Date.now());
      receivePlacements(t.placements);
    }, () => {});
    return () => {
      live = false;
    };
  }, [api]);
  const now = useNow(30_000) + offset;
  const dailyChosen = settings.mode === 'rush' && settings.rushKind === 'daily';
  const lobbyChosen = settings.mode === 'rush' && (settings.rushKind === 'friends' || settings.rushKind === 'competitive');
  const competitiveChosen = lobbyChosen && settings.rushKind === 'competitive';
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('home');
  const [howTo, setHowTo] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  // On the old address, the game has moved (issue #92): each visit until Done.
  const [moved, setMoved] = useState(() => movedNoticeDue(location.hostname));
  // The first visit on a new version shows its notes once (issue #91), after the move's popup.
  const [release, setRelease] = useState(() => releasePopupDue(readSeenVersion()));
  const closeRelease = () => {
    markVersionSeen();
    setRelease(false);
  };
  const two = settings.mode === 'two';
  const friend = two && settings.opponent === 'friend';
  const random = two && settings.opponent === 'random';
  // Rated play leaves Easy out: with Easy as your default, it plays at Medium (`ratedDifficultyFor`).
  const rated = random || competitiveChosen;
  const back: Record<Step, Step> = {
    home: 'home',
    rush: 'home',
    friends: 'rush',
    opponent: 'home',
    strength: 'opponent',
    turn: 'opponent',
    news: 'home',
    difficulty: friend || random ? 'turn' : two ? 'strength' : lobbyChosen ? 'friends' : settings.mode === 'rush' ? 'rush' : 'home',
  };

  // Modes not yet unlocked are greyed out, saying how to open them. The tutorial, How to play and Leaderboards never are.
  const modeLocks = {
    two: open && !open.twoPlayer ? locked(HOW_TO_UNLOCK.two) : undefined,
    rush: open && !open.soloRush ? locked(HOW_TO_UNLOCK.rush) : undefined,
  };
  const rushLock = open && !open.otherRush ? locked(HOW_TO_UNLOCK.otherRush) : undefined;

  const heading: Record<Step, string> = {
    home: '',
    rush: 'Which Rush?',
    friends: 'Rush with Friends',
    opponent: 'Who do you want to play?',
    strength: 'How strong is the computer?',
    turn: 'How is the game timed?',
    difficulty: 'Your difficulty',
    news: "What's new",
  };

  return (
    <div class="app title-screen">
      {step === 'home' ? (
        <header class="title-hero">
          <div class="title-top"><ProfileButton profile={profile} onOpen={onProfile} /></div>
          <div class="logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logo }} />
          {/* The logo spells out the name, so the heading is for screen readers only. */}
          <h1 class="visually-hidden">Word Mastermind</h1>
          <p class="tagline">Find the secret word from how many letters each guess shares with it.</p>
        </header>
      ) : (
        <header class="step-head">
          <button type="button" class="icon-btn" aria-label="Back" onClick={() => setStep(back[step])}>
            <BackIcon />
          </button>
          <h2>{heading[step]}</h2>
        </header>
      )}

      {step === 'home' && (
        <>
          {continues.map((mode) => (
            <button type="button" class="btn primary big" key={mode}
              onClick={() => (mode === 'daily' ? onDaily() : mode === 'lobby' || mode === 'competitive' ? onLobby() : onContinue(mode))}>
              {CONTINUE_LABEL[mode]}
            </button>
          ))}
          {/* Games and invites waiting on you come before starting something new. */}
          {API_URL && <LobbyInvitesList apiUrl={API_URL} identity={identity} onOpen={(code) => onLobby(code)} />}
          {API_URL && <FriendGamesList key={friendGamesVersion} apiUrl={API_URL} identity={identity}
            onOpen={onOpenFriendGame} />}
          <Choices label="Game mode" choices={MODES} selected={null}
            details={{ two: modeLocks.two?.detail, rush: modeLocks.rush?.detail }}
            done={{ two: modeLocks.two?.done, rush: modeLocks.rush?.done }}
            onPick={(mode) => {
              onSettings({ ...settings, mode });
              setStep(mode === 'two' ? 'opponent' : mode === 'rush' ? 'rush' : 'difficulty');
            }} />
          {API_URL && <SetupOffers apiUrl={API_URL} identity={identity} onSignIn={() => onProfile('account')} />}
          <button type="button" class="btn big leaderboards-btn" onClick={() => onLeaderboards()}>Leaderboards</button>
          {settings.showTutorial && (
            <section class="tutorial-card" aria-label="Tutorial">
              <p><b>New here?</b> A short walk-through of a sample game shows how to play and where everything is.</p>
              <div class="row-btns">
                <button type="button" class="btn primary" onClick={() => setTutorial(true)}>Take the tutorial</button>
                <button type="button" class="btn" onClick={() => onSettings({ ...settings, showTutorial: false })}>
                  Hide
                </button>
              </div>
            </section>
          )}
          <div class="link-row">
            <button type="button" class="link-btn" onClick={() => setHowTo(true)}>How to play</button>
            {!settings.showTutorial && (
              <button type="button" class="link-btn" onClick={() => setTutorial(true)}>Tutorial</button>
            )}
            <button type="button" class="link-btn" onClick={() => openReport({ screen: 'Title screen' })}>
              Report an issue
            </button>
          </div>
          {/* The static pages (public/*.html), for search engines and anyone who wants to read more. */}
          <footer class="credit title-footer">
            <a href="/how-to-play">Full rules</a>
            <a href="/strategy">Strategy</a>
            <a href="/jotto-and-wordle">Jotto and Wordle</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </footer>
          <VersionLink onOpen={() => setStep('news')} />
        </>
      )}

      {step === 'rush' && (
        <Choices label="Kind of Rush" choices={RUSH_KINDS} selected={settings.rushKind}
          details={rushLock ? { daily: rushLock.detail, friends: rushLock.detail, competitive: rushLock.detail }
            : { daily: dailyDetail(daily, now) }}
          done={rushLock ? {
            daily: rushLock.done,
            // A friend's join code still works: the lock is only on opening a lobby.
            friends: { ...rushLock.done, link: { label: 'Join with a code', onClick: () => {
              onSettings({ ...settings, rushKind: 'friends' });
              setStep('friends');
            } } },
            competitive: rushLock.done,
          } : daily?.run && daily.run.status !== 'playing' ? {
            daily: {
              tag: daily.run.status === 'finished' ? 'Played today' : 'Given up today',
              link: { label: "See today's leaderboard", onClick: () => onLeaderboards('daily') },
            },
          } : undefined}
          onPick={(kind) => {
            onSettings({ ...settings, rushKind: kind });
            // Played or started today: its difficulty is set, so straight to it.
            if (kind === 'daily' && daily?.run) onDaily();
            else setStep(kind === 'friends' || kind === 'competitive' ? 'friends' : 'difficulty');
          }} />
      )}

      {step === 'friends' && (
        <>
          <p class="step-note">{competitiveChosen
            ? "5 seats: each player sets a secret word and solves the other 4, at one difficulty, on one clock that never pauses. Computers fill the empty seats with random words. Rated, so it needs an account."
            : 'Up to 5 players solve the same 4 words, at one difficulty, on one clock that never pauses. Open a lobby to host, or join one with its code.'}</p>
          {rushLock ? (
            <Choices label="Open a lobby" selected={null}
              choices={[{ value: 'open', label: 'Open a lobby', detail: "You're the host: share its join code, then start when everyone's in." }]}
              details={{ open: rushLock.detail }} done={{ open: rushLock.done }}
              onPick={() => setStep('difficulty')} />
          ) : (
            <button type="button" class="btn primary big" onClick={() => setStep('difficulty')}>Open a lobby</button>
          )}
          <form class="join-code" onSubmit={(e) => {
            e.preventDefault();
            const code = normalizeLobbyCode(joinCode);
            if (code) onLobby(code);
            else setJoinError('A join code is 6 letters and numbers, like KX7P2M.');
          }}>
            <label class="menu-label" for="join-code">Or join one with its code</label>
            <div class="join-code-row">
              <input id="join-code" class="invite-link" value={joinCode} maxLength={8} autoComplete="off"
                autoCapitalize="characters" spellcheck={false} placeholder="KX7P2M"
                onInput={(e) => {
                  setJoinCode(e.currentTarget.value.toUpperCase());
                  setJoinError(null);
                }} />
              <button type="submit" class="btn primary">Join</button>
            </div>
            {joinError && <p class="message error" role="status">{joinError}</p>}
          </form>
        </>
      )}

      {step === 'opponent' && (
        <Choices label="Opponent" choices={OPPONENTS} selected={settings.opponent}
          onPick={(opponent) => {
            onSettings({ ...settings, opponent });
            setStep(opponent === 'computer' ? 'strength' : 'turn');
          }} />
      )}

      {step === 'turn' && TIME_GROUPS
        // The queue is live only: a matched correspondence game would need it to work without an open page.
        .filter((g) => !random || g.choices.every((c) => isLive(c.value)))
        .map((g) => (
          <section class="time-group" key={g.label} aria-label={g.label}>
            <h3 class="menu-label">{g.label}</h3>
            <p class="step-note">{g.note}</p>
            <div class="time-choices">
              {g.choices.map((c) => (
                <button type="button" class="choice" key={c.value} aria-pressed={c.value === settings.timeControl}
                  onClick={() => {
                    onSettings({ ...settings, timeControl: c.value });
                    setStep('difficulty');
                  }}>
                  <span class="choice-label">{c.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}

      {step === 'strength' && (
        <Choices label="Computer strength" choices={STRENGTHS} selected={settings.strength}
          onPick={(strength) => {
            onSettings({ ...settings, strength });
            setStep('difficulty');
          }} />
      )}

      {step === 'difficulty' && (
        <>
          <p class="step-note">{dailyChosen
            ? "How much the app helps you track your own guesses. It's chosen once: it can't change during today's Daily Set, and each difficulty has its own leaderboard."
            : lobbyChosen
              ? 'How much the app helps everyone track their own guesses. One difficulty for the whole lobby; you can change it until you start.'
                + (competitiveChosen ? " It's the same for everyone, so it doesn't change the rating." : '')
              : random
              ? "How much the app helps you track your own guesses. You'll be matched with a player at the same difficulty, and it's fixed for the game."
              : 'How much the app helps you track your own guesses. You can change it during a game from the menu.'}</p>
          <Choices label="Your difficulty" selected={rated ? ratedDifficultyFor(settings.difficulty) : settings.difficulty}
            // A matched game and Competitive Rush are rated, so they leave Easy out.
            choices={rated ? DIFFICULTIES.filter((c) => isRatedDifficulty(c.value)) : DIFFICULTIES}
            onPick={(difficulty) => onSettings({ ...settings, difficulty })} />
          <button type="button" class="btn primary big" onClick={onStart}>
            {friend || random || competitiveChosen ? 'Next: your word' : dailyChosen ? 'Start Daily Set' : lobbyChosen ? 'Open lobby' : 'Start game'}
          </button>
        </>
      )}
      {step === 'news' && <WhatsNew />}

      {howTo && <HowToPlay onClose={() => setHowTo(false)} />}
      {moved && step === 'home' && (
        <MovedNotice signedIn={identity.token !== null} onClose={() => setMoved(false)}
          onSignIn={() => onProfile('account')} onBackup={() => onProfile('data')} />
      )}
      {release && !moved && step === 'home' && (
        <ReleasePopup onClose={closeRelease} onAll={() => {
          closeRelease();
          setStep('news');
        }} />
      )}
      {tutorial && (
        <Tutorial hidden={!settings.showTutorial}
          onClose={(hide) => {
            setTutorial(false);
            if (hide !== undefined) onSettings({ ...settings, showTutorial: !hide });
          }}
          onPlay={(hide) => {
            setTutorial(false);
            onSettings({ ...settings, mode: 'single', showTutorial: !hide });
            setStep('difficulty');
          }} />
      )}
    </div>
  );
}
