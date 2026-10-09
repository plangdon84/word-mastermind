import type { OpenProfile } from './profilePages';
import { useEffect, useMemo, useState } from 'preact/hooks';
// Inlined, so its fill (currentColor) follows the text colour in dark mode.
import logo from '../assets/logo.svg?raw';
import { ProfileButton } from './gameHeader';
import { BackIcon, LockIcon } from './panels';
import { RankBySwitch } from './rushParts';
import { API_URL } from './config';
import { receivePlacements } from './badges';
import { dailyApi, type DailyToday } from './dailyApi';
import { FriendGameButton, friendGameWaits, LobbyInviteButton, useFriendGames, useLobbyInvites } from './FriendGamesList';
import { listOpen, loadListChoice, saveListChoice } from './gamesInProgress';
import { useNow } from './hooks';
import { countdownText } from './messages';
import { openReport } from './reportIssue';
import { DAILY_NAME } from './messages';
import type { ApiIdentity } from './apiIdentity';
import type { Profile } from './profileStorage';
import type { Difficulty, Mode, Opponent, RushKind, Settings, Strength } from './settings';
import {
  DAILY_MODES, FEATURES, isLive, isRatedDifficulty, ratedDifficultyFor, normalizeLobbyCode, runRankBy, wordSetName, type DailyMode,
  type LobbyKind, type OpenModes, type TimeControl,
} from '../game';
import { loadRush } from './rushStorage';
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
    offer="Get a notification when it's your turn against a friend, or a Word Set with friends ends, even with the game closed." />;
}

type Step = 'home' | 'rush' | 'friends' | 'opponent' | 'strength' | 'turn' | 'difficulty' | 'news';

interface Choice<T> {
  value: T;
  label: string;
  detail: string;
  /** Shown but not selectable yet. */
  later?: boolean;
}

// Single player is Practice, and Rush is Word Sets, to players (Dev Plan item 18za); saved data keeps the old names.
const MODES: Choice<Mode>[] = [
  { value: 'single', label: 'Practice', detail: 'Find a secret word on your own, at your own pace.' },
  { value: 'two', label: 'Two player', detail: "Race an opponent to find each other's word: the computer or a friend." },
  { value: 'rush', label: 'Word Sets', detail: 'Find 4 words in a row against the clock, on your own or with friends.' },
];

const CONTINUE_LABEL: Record<Mode | 'lobby' | 'competitive', string> = {
  single: 'Continue Practice', two: 'Continue two player', rush: 'Continue Solo Rush',
  lobby: 'Continue Word Set with friends', competitive: 'Continue Competitive Word Set',
};

/** Continue's label: a Solo Word Set says whether it's a Rush or a Crush. */
function continueLabel(key: keyof typeof CONTINUE_LABEL): string {
  if (key !== 'rush') return CONTINUE_LABEL[key];
  const saved = loadRush();
  return saved ? `Continue ${wordSetName('solo', runRankBy(saved.run))}` : CONTINUE_LABEL.rush;
}

/** The kinds of Word Set (README "Rush modes"), Daily Set aside on its own card; one switched off for the launch isn't offered. */
const RUSH_KINDS = ([
  { value: 'solo', label: 'Solo', detail: "4 random words, on your own. The clock pauses while you're away." },
  { value: 'friends', label: 'With friends', detail: 'Up to 5 players solve the same 4 words on one clock.', later: !API_URL },
  { value: 'competitive', label: 'Competitive', detail: "Each player sets a word and solves the others'. Rated.", later: !API_URL },
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
  two: 'Win a Practice game to unlock.',
  rush: 'Win a two player game to unlock.',
  otherRush: 'Finish a Solo Rush or Solo Crush in Word Sets without giving up a word to unlock.',
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

/** One daily game's row on the Daily card. */
function DailyRow({ mode, today, inProgress, onPlay, onResult }: {
  mode: DailyMode;
  /** Today's game from the server, or null while it loads. */
  today: DailyToday | null;
  /** Today's run was started on this device and isn't over. */
  inProgress: boolean;
  onPlay: () => void;
  /** Opens the run you've started or played: its board, or its result. */
  onResult: () => void;
}) {
  const set = mode === 'daily';
  const run = today?.run ?? null;
  // Yesterday's run, still going when the day changed: it can be finished, off the board.
  const late = run?.status === 'playing' && run.day !== today?.day;
  const playing = run ? run.status === 'playing' : inProgress;
  const over = run !== null && run.status !== 'playing';
  const detail = !set
    ? (late ? "Yesterday's word · in progress" : `One word for everyone${playing ? ' · in progress' : ''}`)
    : late ? `Yesterday's ${today?.runTheme ?? 'set'} · in progress`
      : !today ? '4 themed words'
        : !today.theme ? 'No set today'
          : `4 themed words · Today: ${today.theme}${playing ? ' · in progress' : ''}`;
  return (
    <button type="button" class={over ? 'daily-game done' : 'daily-game'}
      // The Daily Set needs a theme; the Daily Word is there every day.
      disabled={set && !!today && !today.theme && !run && !inProgress}
      onClick={run || inProgress ? onResult : onPlay}>
      <span class="daily-marker" aria-hidden="true">{set ? 4 : 1}</span>
      <span class="daily-name">
        {DAILY_NAME[mode]}
        {over && <span class="tag">{run.status === 'finished' ? 'Played' : 'Given up'}</span>}
      </span>
      <span class="daily-detail">{detail}</span>
      {!over && <span class="daily-play">{playing ? 'Continue' : 'Play'}</span>}
      {over && <span class="daily-result">{run.status === 'finished' ? 'Your place ›' : 'Your result ›'}</span>}
    </button>
  );
}

/**
 * The Daily card (Dev Plan item 18za, README "Title screen"): a row per daily
 * game, the Daily Set and the Daily Word (item 7b), each with its marker (the
 * number of words) and Play. A played row is greyed but still opens that
 * game's result, through a line that isn't.
 */
function DailyCard({ today, now, inProgress, lock, onPlay, onResult }: {
  /** Today's Daily Set and Daily Word from the server, each null while it loads. */
  today: Record<DailyMode, DailyToday | null>;
  now: number;
  /** Today's run of each was started on this device and isn't over. */
  inProgress: Record<DailyMode, boolean>;
  /** How to unlock them, while they're locked. */
  lock: string | null;
  onPlay: (mode: DailyMode) => void;
  onResult: (mode: DailyMode) => void;
}) {
  const nextAt = today.daily?.nextAt ?? today.dailyWord?.nextAt;
  const head = (
    <div class="daily-head">
      <h2>Daily</h2>
      {nextAt !== undefined && <span class="daily-next">New games in {countdownText(nextAt - now)}</span>}
    </div>
  );
  if (!API_URL || lock) {
    return (
      <section class="daily-card" aria-label="Daily">
        {head}
        {DAILY_MODES.map((mode) => (
          <div class="daily-game locked" key={mode}>
            <span class="daily-marker" aria-hidden="true">{mode === 'daily' ? 4 : 1}</span>
            <span class="daily-name">{DAILY_NAME[mode]}{!API_URL && <span class="tag">Coming later</span>}</span>
            <span class="daily-detail">
              {lock ?? (mode === 'daily' ? 'The same 4 themed words for everyone, once a day.' : 'The same word for everyone, once a day.')}
            </span>
            {lock && <LockIcon />}
          </div>
        ))}
      </section>
    );
  }
  return (
    <section class="daily-card" aria-label="Daily">
      {head}
      {DAILY_MODES.map((mode) => (
        <DailyRow key={mode} mode={mode} today={today[mode]} inProgress={inProgress[mode]}
          onPlay={() => onPlay(mode)} onResult={() => onResult(mode)} />
      ))}
    </section>
  );
}

/** One row of Games in progress: a game on this device to continue. */
interface ContinueRow {
  key: Mode | 'lobby' | 'competitive';
  label: string;
  onOpen: () => void;
}

/**
 * Games in progress (Dev Plan item 18za, README "Title screen"): Continue,
 * games against friends (your turn first) and friends' lobby invites in one
 * list, open when something waits on you. Its header counts them, closed too.
 */
function GamesInProgress({ continues, identity, onOpenFriendGame, onLobby }: {
  continues: ContinueRow[];
  identity: ApiIdentity;
  onOpenFriendGame: (id: string) => void;
  onLobby: (code: string) => void;
}) {
  const friendGames = useFriendGames(API_URL, identity);
  const invites = useLobbyInvites(API_URL, identity);
  const waitingGames = friendGames.filter((r) => friendGameWaits(r.game));
  // Your turn against a friend, or an invite; the tag counts these.
  const yourTurn = [...waitingGames.map((r) => r.id), ...invites.map((i) => `lobby:${i.code}`)];
  // Your own games here wait on your move too, so they open the list.
  const waiting = [...yourTurn, ...continues.map((c) => `continue:${c.key}`)];
  const [choice, setChoice] = useState(loadListChoice);
  const total = continues.length + friendGames.length + invites.length;
  if (total === 0) return null;
  const open = listOpen(choice, waiting);
  const toggle = () => {
    const next = { open: !open, waiting };
    saveListChoice(next);
    setChoice(next);
  };
  const others = friendGames.filter((r) => !friendGameWaits(r.game));
  return (
    <section class="games-in-progress friend-games" aria-label="Games in progress">
      <button type="button" class="progress-head" aria-expanded={open} aria-controls="games-in-progress" onClick={toggle}>
        <h2>Games in progress</h2>
        {yourTurn.length > 0 && <span class="tag yours">{yourTurn.length} your turn</span>}
        <span class="tag" aria-label={`${total} ${total === 1 ? 'game' : 'games'}`}>{total}</span>
        <span class="progress-chevron" aria-hidden="true">›</span>
      </button>
      {open && (
        <div class="choices" id="games-in-progress">
          {waitingGames.map((row) => <FriendGameButton key={row.id} row={row} onOpen={onOpenFriendGame} />)}
          {invites.map((invite) => <LobbyInviteButton key={invite.code} invite={invite} onOpen={onLobby} />)}
          {continues.map(({ key, label, onOpen }) => (
            <button type="button" class="choice" key={key} onClick={onOpen}>
              <span class="choice-label">{label}</span>
            </button>
          ))}
          {others.map((row) => <FriendGameButton key={row.id} row={row} onOpen={onOpenFriendGame} />)}
        </div>
      )}
    </section>
  );
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
  /** Today's Daily Set and Daily Word were started on this device and aren't over. */
  dailyInProgress: Record<DailyMode, boolean>;
  onContinue: (mode: Mode) => void;
  /** Opens today's Daily Set or Daily Word, one already played or in progress, without starting one. */
  onDaily: (mode: DailyMode) => void;
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
  // A Daily Set in progress stays on the Daily card. A Solo game's label reads its saved run, once.
  const soloLabel = useMemo(() => continueLabel('rush'), [inProgress.rush]);
  const continues: ContinueRow[] = [
    ...(['single', 'two', 'rush'] as const).filter((m) => inProgress[m])
      .map((m) => ({ key: m, label: m === 'rush' ? soloLabel : CONTINUE_LABEL[m], onOpen: () => onContinue(m) })),
    ...(lobbyInProgress ? [lobbyInProgress === 'competitive' ? 'competitive' as const : 'lobby' as const]
      .map((key) => ({ key, label: CONTINUE_LABEL[key], onOpen: () => onLobby() })) : []),
  ];
  // Today's Daily Set and Daily Word, for the theme and countdown, and whether you've played them.
  const [daily, setDaily] = useState<Record<DailyMode, DailyToday | null>>({ daily: null, dailyWord: null });
  /** The server's clock minus this device's, for the countdown. */
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!API_URL) return;
    let live = true;
    for (const mode of DAILY_MODES) {
      dailyApi(API_URL, identity, fetch, mode).today().then((t) => {
        if (!live) return;
        setDaily((d) => ({ ...d, [mode]: t }));
        setOffset(t.now - Date.now());
        receivePlacements(t.placements, mode);
      }, () => {});
    }
    return () => {
      live = false;
    };
  }, [identity]);
  const now = useNow(30_000) + offset;
  /** Today's Daily Set or Daily Word, its difficulty being picked. */
  const dailyChosen = settings.mode === 'rush' && (settings.rushKind === 'daily' || settings.rushKind === 'dailyWord');
  const dailyName = DAILY_NAME[settings.rushKind === 'dailyWord' ? 'dailyWord' : 'daily'];
  const lobbyChosen = settings.mode === 'rush' && (settings.rushKind === 'friends' || settings.rushKind === 'competitive');
  const competitiveChosen = lobbyChosen && settings.rushKind === 'competitive';
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('home');
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
    difficulty: friend || random ? 'turn' : two ? 'strength' : lobbyChosen ? 'friends' : dailyChosen ? 'home' : settings.mode === 'rush' ? 'rush' : 'home',
  };

  // Modes not yet unlocked are greyed out, saying how to open them. The tutorial, How to play and Leaderboards never are.
  const modeLocks = {
    two: open && !open.twoPlayer ? locked(HOW_TO_UNLOCK.two) : undefined,
    rush: open && !open.soloRush ? locked(HOW_TO_UNLOCK.rush) : undefined,
  };
  const rushLock = open && !open.otherRush ? locked(HOW_TO_UNLOCK.otherRush) : undefined;

  const heading: Record<Step, string> = {
    home: '',
    rush: 'Word Sets',
    friends: 'Word Sets with friends',
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
          <DailyCard today={daily} now={now} inProgress={dailyInProgress} lock={rushLock?.detail ?? null}
            onResult={onDaily} onPlay={(mode) => {
              onSettings({ ...settings, mode: 'rush', rushKind: mode });
              setStep('difficulty');
            }} />
          {/* Games and invites waiting on you come before starting something new. */}
          <GamesInProgress key={friendGamesVersion} continues={continues} identity={identity}
            onOpenFriendGame={onOpenFriendGame} onLobby={(code) => onLobby(code)} />
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
          {/* One wrapped row of small print (Dev Plan item 18p): the static pages (public/*.html, for
              search engines and anyone who wants to read more; Google's sign-in approval checks the
              homepage links to Privacy), Report an issue and the version. Full rules stands in for
              How to play here; the popup stays in ☰ and the profile's Help. */}
          <footer class="credit title-footer">
            <ul>
              <li><a href="/how-to-play">Full rules</a></li>
              <li><a href="/strategy">Strategy</a></li>
              <li><a href="/jotto-and-wordle">Jotto and Wordle</a></li>
              {!settings.showTutorial && (
                <li><button type="button" onClick={() => setTutorial(true)}>Tutorial</button></li>
              )}
              <li><a href="/privacy">Privacy</a></li>
              <li><a href="/terms">Terms</a></li>
              <li><button type="button" onClick={() => openReport({ screen: 'Title screen' })}>Report an issue</button></li>
              <li><VersionLink onOpen={() => setStep('news')} /></li>
            </ul>
          </footer>
        </>
      )}

      {step === 'rush' && (
        <Choices label="Kind of Rush" choices={RUSH_KINDS} selected={settings.rushKind}
          details={rushLock ? { friends: rushLock.detail, competitive: rushLock.detail } : undefined}
          done={rushLock ? {
            // A friend's join code still works: the lock is only on opening a lobby.
            friends: { ...rushLock.done, link: { label: 'Join with a code', onClick: () => {
              onSettings({ ...settings, rushKind: 'friends' });
              setStep('friends');
            } } },
            competitive: rushLock.done,
          } : undefined}
          onPick={(kind) => {
            onSettings({ ...settings, rushKind: kind });
            setStep(kind === 'friends' || kind === 'competitive' ? 'friends' : 'difficulty');
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
            ? `How much the app helps you track your own guesses. It's chosen once: it can't change during today's ${dailyName}, and each difficulty has its own leaderboard.`
            : lobbyChosen
              ? 'How much the app helps everyone track their own guesses. One difficulty for the whole lobby; you can change it until you start.'
                + (competitiveChosen ? " It's the same for everyone, so it doesn't change the rating." : '')
              : random
              ? "How much the app helps you track your own guesses. You'll be matched with a player at the same difficulty, and it's fixed for the game."
              : 'How much the app helps you track your own guesses. You can change it during a game from the menu.'}</p>
          {/* A Word Set ranks by time (Rush) or guesses (Crush); the Daily Set is on both boards. */}
          {settings.mode === 'rush' && !dailyChosen && (
            <RankBySwitch label rankBy={settings.rankBy} onPick={(rankBy) => onSettings({ ...settings, rankBy })} />
          )}
          <Choices label="Your difficulty" selected={rated ? ratedDifficultyFor(settings.difficulty) : settings.difficulty}
            // A matched game and Competitive Rush are rated, so they leave Easy out.
            choices={rated ? DIFFICULTIES.filter((c) => isRatedDifficulty(c.value)) : DIFFICULTIES}
            onPick={(difficulty) => onSettings({ ...settings, difficulty })} />
          <button type="button" class="btn primary big" onClick={onStart}>
            {friend || random || competitiveChosen ? 'Next: your word' : dailyChosen ? `Start ${dailyName}` : lobbyChosen ? 'Open lobby' : 'Start game'}
          </button>
        </>
      )}
      {step === 'news' && <WhatsNew />}

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
