import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  authApi, AuthError, authErrorMessage, checkSession, loadSession, loginFailedInUrl, loginTokenFromUrl, saveSession,
  type Session,
} from './account';
import { noteReloadFor, triedReloadFor, useLatestBuild } from './appUpdate';
import { AccountSection, type AccountNotice, type LoginAsk } from './AccountSection';
import { DIFFICULTY_LABEL } from './components';
import { NoServerSection, UpdateBar } from './panels';
import { forgetTappedLink, TAP_LOOKS_MS, takeTappedLink } from './notificationTaps';
import {
  BADGES, computeAchievements, computeStats, computeUnlocks, dailyDay, openModes, isTwoPlayerOver, runRankBy, wordSetName,
  type DailyPlacement, type HistoryFilter, type HistoryMode, type LobbyKind,
} from '../game';
import { Analytics, type RatingsState } from './Analytics';
import type { ApiIdentity } from './apiIdentity';
import { API_URL } from './config';
import { fetchRatings, type PoolRating } from './ratingsApi';
import { Achievements } from './Badge';
import { friendApi } from './friendApi';
import { FriendScreen } from './FriendScreen';
import { MatchScreen } from './MatchScreen';
import { clearFriendGames, gameIdFromUrl, loadFriendGames } from './friendGames';
import { friendCodeFromUrl, inviteFromUrl, loadPendingInvite, savePendingInvite, type Friend } from './friendsApi';
import { FriendsSection } from './FriendsSection';
import { FriendProfileScreen, type FriendPage } from './FriendProfileScreen';
import { DailyScreen } from './DailyScreen';
import { dailyInProgress, loadPlacements } from './dailyStorage';
import { announceBadges, loadBadgeNotices, loadEarnedBadges, localDay, markBadgesSeen } from './badges';
import { LeaderboardsScreen, type BoardId } from './LeaderboardsScreen';
import { LobbyScreen } from './LobbyScreen';
import { activeLobby, activeLobbyKind, lobbyCodeFromUrl } from './lobbyStorage';
import { GameHistory } from './GameHistory';
import { getAllIds, getGames, onGameSaved, putGames, type HistoryGame } from './historyDb';
import { useHistoryGames } from './hooks';
import { newId } from './ids';
import { syncFriendGames } from './nextGame';
import { pullPlayedGames } from './playedGames';
import { ProfileScreen } from './ProfileScreen';
import { DailyResult, friendReviewGame, LobbyPlaces, ratingLine } from './reviews';
import { isProfilePage, type OpenProfile, type ProfilePage } from './profilePages';
import {
  applySynced, clearSyncState, notePending, profileKey, syncAccount, syncedOf, type HistoryStore,
} from './profileSync';
import { displayName, loadProfile, saveProfile, type Profile } from './profileStorage';
import { loadRush } from './rushStorage';
import { RushScreen } from './RushScreen';
import { EnterSide } from './keyboard';
import { loadSettings, saveSettings, type Mode, type Settings } from './settings';
import { SoloScreen } from './SoloScreen';
import { loadSaved } from './storage';
import { syncApi } from './syncApi';
import { TitleScreen } from './TitleScreen';
import { resyncAlerts } from './turnAlerts';
import { TwoPlayerScreen } from './TwoPlayerScreen';
import { loadTwoPlayer } from './twoPlayerStorage';
import { plural } from './messages';

type GameScreen = { name: Mode; resume: boolean };
/** A game against a friend, or (with no ID) a new invite: a link, or a challenge to one friend. */
type FriendGameScreen = { name: 'friend'; id: string | null; challenge?: Friend };
/** Today's Daily Rush; with `start`, starting it if you haven't played. */
type DailyGameScreen = { name: 'daily'; start: boolean };
/** A Rush with Friends or Competitive Rush lobby, or (with no code) a new one of `kind` with you as host. */
type LobbyGameScreen = { name: 'lobby'; code: string | null; kind?: LobbyKind };
/** Finding a random opponent in the matchmaking queue. */
type MatchGameScreen = { name: 'match' };
/** Where the profile's Back goes. */
type ProfileFrom = { name: 'title' } | GameScreen | FriendGameScreen | DailyGameScreen | LobbyGameScreen | MatchGameScreen;
type Screen =
  | { name: 'title' }
  | GameScreen
  | FriendGameScreen
  | MatchGameScreen
  | DailyGameScreen
  | LobbyGameScreen
  /** The Leaderboards page; with `board`, opened at that board, whose Back returns to the title screen. */
  | { name: 'leaderboards'; board: BoardId | null }
  /** The profile's hub, or (with `page`) one of its subpages. */
  | { name: 'profile'; from: ProfileFrom; page: ProfilePage | null }
  /** A friend's profile (Dev Plan item 18c), from your friends list: its hub, or (with `page`) a subpage. */
  | { name: 'friendProfile'; friend: Friend; page: FriendPage | null; from: ProfileFrom }
  /**
   * A past game from the history; its Back goes to the history subpage. A
   * friend's game (`friend`) goes back to the page of their profile it was
   * opened from, and shows their Daily Rush places.
   */
  | {
    name: 'review'; game: HistoryGame; from: ProfileFrom;
    friend?: { friend: Friend; page: FriendPage; placements: readonly DailyPlacement[] };
  };

/** The title screen's mode for a reviewed game, whose Play again starts one; the server's modes have none. */
const SCREEN_MODE: Partial<Record<HistoryMode, Mode>> = { single: 'single', computer: 'two', rush: 'rush' };

/** Which modes have a saved game that isn't over yet. */
const inProgress = (): Record<Mode, boolean> => {
  const two = loadTwoPlayer();
  return {
    single: loadSaved()?.game.status === 'playing',
    two: two !== null && !isTwoPlayerOver(two.game),
    rush: loadRush()?.run.status === 'playing',
  };
};

/** This browser's game history, as syncing with the account sees it. */
const historyStore: HistoryStore = { allIds: getAllIds, getGames, putGames };

/** How long after a change to the profile or settings it's sent, so a burst of changes goes as one. */
const PROFILE_SYNC_DELAY_MS = 1500;

/** The profile's stats subpage, from every saved game. */
function StatsPage({ games, identity, signedIn, onOpen }: {
  games: HistoryGame[] | null;
  identity: ApiIdentity;
  signedIn: boolean;
  onOpen: (game: HistoryGame) => void;
}) {
  const [ratingList, setRatingList] = useState<PoolRating[] | null>(null);
  useEffect(() => {
    let live = true;
    if (API_URL && signedIn) void fetchRatings(API_URL, identity).then((list) => live && setRatingList(list));
    return () => {
      live = false;
    };
  }, [identity, signedIn]);
  const ratings: RatingsState | undefined = API_URL ? { signedIn, list: signedIn ? ratingList : null } : undefined;
  const replayed = useMemo(() => games?.map((g) => ({ id: g.entry.id, replayed: g.replayed })) ?? null, [games]);
  const stats = useMemo(() => replayed && computeStats(replayed, Date.now()), [replayed]);
  return <Analytics stats={stats} games={games ?? []} onOpen={onOpen} ratings={ratings} />;
}

/** The profile's achievements subpage: every badge, earned or not, from every saved game. */
function AchievementsPage({ games }: { games: HistoryGame[] | null }) {
  const earned = useMemo(
    () => games && computeAchievements(games.map((g) => ({ id: g.entry.id, replayed: g.replayed })), localDay, loadPlacements()),
    [games]);
  // Badges new since you last looked are marked as such here, and the profile dot goes.
  const [fresh] = useState(() => new Set(loadBadgeNotices().unseen));
  useEffect(markBadgesSeen, []);
  return <Achievements earned={earned} fresh={fresh} />;
}


/** Each profile row's one-line summary. */
function profileSummaries({ games, session, settings }: {
  games: HistoryGame[] | null;
  session: Session | null;
  settings: Settings;
}): Partial<Record<ProfilePage, string>> {
  const earned = games && computeAchievements(games.map((g) => ({ id: g.entry.id, replayed: g.replayed })), localDay, loadPlacements());
  const unseen = loadBadgeNotices().unseen.length;
  return {
    account: session ? `Signed in as ${session.account.email}` : 'Sign in to play on any device and add friends',
    friends: session ? 'Your friend code, friends and invites' : 'Sign in to add friends',
    stats: 'Your results in each mode',
    achievements: earned
      ? unseen > 0 ? `${plural(unseen, 'new badge')} to see · ${earned.length} of ${BADGES.length}` : `${earned.length} of ${BADGES.length} badges`
      : undefined,
    history: games ? plural(games.length, 'game') : undefined,
    settings: `New games start at ${DIFFICULTY_LABEL[settings.difficulty]}`,
    help: 'The tutorial, how to play, and reporting an issue',
    data: session ? 'Kept with your account. Backup and reset' : 'Kept in this browser. Backup and reset',
  };
}

/**
 * The screen a link opens: an invite link or a turn notification opens its
 * game; a friend's link (a request or a private invite), or a notification
 * about a friend request, the friends list on the profile; a lobby's join link, or a notification about
 * it, the lobby.
 */
function linkScreen(search: string): Screen | null {
  const friendGame = gameIdFromUrl(search);
  if (friendGame) return { name: 'friend', id: friendGame };
  if (API_URL && (friendCodeFromUrl(search) || inviteFromUrl(search) || new URLSearchParams(search).has('friends'))) {
    return { name: 'profile', from: { name: 'title' }, page: 'friends' };
  }
  const lobby = API_URL ? lobbyCodeFromUrl(search) : null;
  if (lobby) return { name: 'lobby', code: lobby };
  return null;
}

/**
 * Chooses the screen. A reload mid-game goes straight back into the game of
 * the mode last played; otherwise the app opens on the title screen.
 */
export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [session, setSession] = useState<Session | null>(loadSession);
  /** How signing in from a link (email, or back from Google) went, for the profile to say. */
  const [accountNotice, setAccountNotice] = useState<AccountNotice | null>(null);
  // Read before the address bar is cleared below.
  const [loginLink] = useState(() => ({ token: loginTokenFromUrl(location.search), failed: loginFailedInUrl(location.search) }));
  /** A friend's code from their link (`?friend=…`), for the profile's friends list to add. */
  const [friendCode] = useState(() => (API_URL ? friendCodeFromUrl(location.search) : null));
  /**
   * A friend's private invite link (`?invite=…`), kept until it's accepted,
   * since you may need to sign in first (and Google's round trip leaves the
   * page). Saved before anything renders, so the friends list finds it.
   */
  const [pendingInvite, setPendingInvite] = useState(() => {
    const opened = API_URL ? inviteFromUrl(location.search) : null;
    if (opened) savePendingInvite(opened);
    return API_URL ? loadPendingInvite() : null;
  });
  /** Kept here so returning from a review keeps the history's filters. */
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>({});
  /** The same for a friend's history, while you review one of their games. */
  const [friendFilter, setFriendFilter] = useState<HistoryFilter>({});
  /** Bumped when games are added outside play (a restore), so the profile reloads them. */
  const [historyVersion, setHistoryVersion] = useState(0);
  /** Bumped when games against a friend arrive from your other devices, so the title screen's list reloads. */
  const [friendGamesVersion, setFriendGamesVersion] = useState(0);
  /** Who the app is to the server: this device, and its session once signed in. */
  const identity = useMemo<ApiIdentity>(
    () => ({ guestId: profile.deviceId, token: session?.token ?? null }), [profile.deviceId, session?.token]);
  const [screen, setScreen] = useState<Screen>(() => {
    const linked = linkScreen(location.search);
    if (linked) return linked;
    const inLobby = API_URL ? activeLobby() : null;
    if (inLobby && settings.mode === 'rush' && (settings.rushKind === 'friends' || settings.rushKind === 'competitive')) {
      return { name: 'lobby', code: inLobby };
    }
    if (API_URL && settings.mode === 'rush' && settings.rushKind === 'daily' && dailyInProgress(dailyDay(Date.now()))) {
      return { name: 'daily', start: false };
    }
    return inProgress()[settings.mode] ? { name: settings.mode, resume: true } : { name: 'title' };
  });
  /** Opened from a link (a game, an invite, a sign-in): read before the address bar is cleared below. */
  const [openedFromLink] = useState(() => location.search !== '');
  // Once opened, the link's game ID leaves the address bar, so a reload doesn't reopen it over another screen.
  useEffect(() => {
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  }, []);
  // A tapped notification, with the app already open, opens its game here (public/sw.js).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: unknown; url?: unknown } | null;
      if (data?.type !== 'open' || typeof data.url !== 'string') return;
      const linked = linkScreen(new URL(data.url, location.origin).search);
      if (!linked) return;
      setScreen(linked);
      void forgetTappedLink();
      // Tells the service worker it's done, so it doesn't reload the page.
      e.ports[0]?.postMessage('opened');
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);
  // A tapped notification the page missed (an iPhone's home-screen app waking up, or opened by the tap on its
  // title screen; issues #132 and #169): the service worker kept its link, taken on opening and coming back.
  useEffect(() => {
    if (!API_URL) return undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const take = () => {
      void takeTappedLink().then((url) => {
        const linked = url && linkScreen(new URL(url).search);
        if (linked) setScreen(linked);
      });
    };
    const look = () => {
      if (document.visibilityState !== 'visible') return;
      timers.splice(0).forEach(clearTimeout);
      for (const ms of TAP_LOOKS_MS) timers.push(setTimeout(take, ms));
    };
    // A page opened by the tap's own link already shows its game.
    if (openedFromLink) void forgetTappedLink();
    else look();
    document.addEventListener('visibilitychange', look);
    window.addEventListener('pageshow', look);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener('visibilitychange', look);
      window.removeEventListener('pageshow', look);
    };
  }, []);

  // A newer build (issue #136): the title screen reloads into it quietly; elsewhere a bar offers it.
  const update = useLatestBuild(openedFromLink);
  const [updateHidden, setUpdateHidden] = useState<string | null>(null);
  useEffect(() => {
    const build = update.latest?.build;
    if (screen.name !== 'title' || !build || triedReloadFor(build)) return;
    noteReloadFor(build);
    location.reload();
  }, [screen.name, update.latest?.build]);
  /** Reloads into the new build, back into this game: one with an address comes back by its link, the rest are saved here. */
  const updateNow = () => {
    if (update.latest) noteReloadFor(update.latest.build);
    const link = screen.name === 'friend' && screen.id ? `/?game=${encodeURIComponent(screen.id)}`
      : screen.name === 'lobby' && screen.code ? `/?lobby=${encodeURIComponent(screen.code)}` : null;
    if (link) location.replace(link);
    else location.reload();
  };
  // Not again in a tab whose Update came back on the old build (a cache in the way): it would do nothing.
  const showUpdate = update.kind === 'offer' && screen.name !== 'title' && !!update.latest
    && updateHidden !== update.latest.build && !triedReloadFor(update.latest.build);

  /** Adds your games against friends from your other devices to this one's list, and challenges sent to you. */
  const pullFriendGames = (signedIn: ApiIdentity) => {
    if (!API_URL) return;
    syncFriendGames(friendApi(API_URL, signedIn)).then((added) => {
      if (added > 0) setFriendGamesVersion((v) => v + 1);
    }, () => {});
  };

  /** The latest profile, settings and session, for a sync that finishes after they've changed. */
  const latest = useRef({ profile, settings, session, identity });
  latest.current = { profile, settings, session, identity };
  const syncing = useRef(false);
  const syncAgain = useRef(false);

  /**
   * Signed in, brings this device and the account into step: the profile and
   * settings, this device's new games up and the account's down (README
   * "Accounts"). One round at a time; a request during one runs another after.
   */
  const syncNow = () => {
    const { session: signedIn, profile: here, settings: set } = latest.current;
    if (!API_URL || !signedIn) return;
    if (syncing.current) {
      syncAgain.current = true;
      return;
    }
    syncing.current = true;
    const sent = syncedOf(here, set);
    const api = syncApi(API_URL, { guestId: here.deviceId, token: signedIn.token });
    syncAccount(api, signedIn.account.id, sent, historyStore).then((result) => {
      const now = latest.current;
      if (now.session?.account.id !== signedIn.account.id) return;
      // Changed again while syncing: the next round sends that instead.
      if (profileKey(syncedOf(now.profile, now.settings)) !== profileKey(sent)) {
        syncAgain.current = true;
      } else if (profileKey(result.profile) !== profileKey(sent)) {
        const applied = applySynced(now.profile, now.settings, result.profile);
        setProfile(applied.profile);
        setSettings(applied.settings);
      }
      if (result.added > 0) setHistoryVersion((v) => v + 1);
    }, () => {
      // Offline, or the session ended (the session check says so): the next round tries again.
    }).finally(() => {
      syncing.current = false;
      if (syncAgain.current) {
        syncAgain.current = false;
        syncNow();
      }
    });
  };

  /**
   * The session ended. With `newGuest` (signing out, or this device's guest
   * ID is an account's it's no longer signed in to), the device plays as a
   * new guest from now on, and the account's games leave its list.
   */
  const signedOut = (newGuest: boolean): string | null => {
    setSession(null);
    clearSyncState();
    if (!newGuest) return null;
    clearFriendGames();
    setFriendGamesVersion((v) => v + 1);
    const deviceId = newId();
    setProfile((p) => ({ ...p, deviceId }));
    return deviceId;
  };

  // Is this browser's session still good? Signed in, bring in games started on other devices.
  const checkOnOpening = () => {
    if (!API_URL) return;
    const { profile, session, identity } = latest.current;
    checkSession(authApi(API_URL, profile.deviceId), session?.token ?? null).then((check) => {
      if (check.ended || check.newGuest) signedOut(check.newGuest);
      else if (session && check.account) {
        setSession({ ...session, account: check.account });
        pullFriendGames(identity);
      } else if (!session && loadFriendGames().length > 0) {
        // A guest who has played a friend: a rematch they were sent joins their list.
        pullFriendGames(identity);
      }
    }, () => {});
  };
  // Opened from a sign-in link, the link decides instead, or this runs once it's left unused.
  useEffect(() => {
    if (!loginLink.token) checkOnOpening();
  }, []);

  /**
   * Adds your finished games against friends, Daily Rushes and lobbies from
   * the server to the history (README "Game history"). One pull at a time.
   */
  const pulling = useRef(false);
  const pullPlayed = () => {
    const { session: signedIn, profile: here, identity: who } = latest.current;
    if (!API_URL || pulling.current) return;
    pulling.current = true;
    pullPlayedGames(API_URL, who, signedIn?.account.id ?? here.deviceId, here.memberSince, historyStore)
      .then(async (ids) => {
        if (ids.length === 0) return;
        setHistoryVersion((v) => v + 1);
        // Their result screens were the server's, so badges they earned show as the profile dot.
        const earned = await loadEarnedBadges();
        announceBadges(earned.filter((b) => ids.includes(b.gameId)).map((b) => b.id));
      })
      .catch(() => {})
      .finally(() => {
        pulling.current = false;
      });
  };
  // On opening the app and signing in or out, and on coming back to the title screen or the profile after a game.
  useEffect(pullPlayed, [identity]);
  useEffect(() => {
    if (screen.name === 'title' || screen.name === 'profile') pullPlayed();
  }, [screen.name]);

  // The server keeps turn alerts under this device's guest ID, which signing out changes.
  useEffect(() => {
    if (API_URL) void resyncAlerts(API_URL, identity);
  }, [identity]);

  /** After switching this device to a new guest ID, a Google sign-in (tied to the old one) must start again. */
  const SIGN_IN_AGAIN = 'This device was signed out of another account. Sign in again to continue.';
  /**
   * An emailed sign-in link's address, while the Account page asks "Sign in
   * as …?" (a link someone made for their own account and sent you mustn't
   * sign this device in to it unnoticed), then while it signs in.
   */
  const [loginAsk, setLoginAsk] = useState<LoginAsk | null>(null);
  /** Shows how signing in from a link went, on the profile's Account page. */
  const showLoginNotice = (notice: AccountNotice) => {
    setLoginAsk(null);
    setAccountNotice(notice);
    // Signed in to accept a friend's invite: the friends list accepts it.
    setScreen({ name: 'profile', from: { name: 'title' }, page: !notice.error && loadPendingInvite() ? 'friends' : 'account' });
  };
  /** Trades the sign-in link for a session on this device (as `deviceId`, if it just changed), then shows the profile. */
  const tradeLoginLink = (token: string, deviceId = latest.current.profile.deviceId) => {
    if (!API_URL) return;
    const apiUrl = API_URL;
    const trade = (deviceId: string, retry: boolean): Promise<void> => authApi(apiUrl, deviceId).signIn(token).then((signedIn) => {
      setSession(signedIn);
      showLoginNotice({ text: "You're signed in.", error: false });
      pullFriendGames({ guestId: deviceId, token: signedIn.token });
    }, (e: unknown): Promise<void> | void => {
      // This device's guest ID is another account's (its session lapsed): sign in as a new guest. An emailed
      // link works for that; a Google one belongs to the old guest ID, so it asks for sign-in again instead.
      if (retry && e instanceof AuthError && e.code === 'sign-in-needed') return trade(signedOut(true)!, false);
      const code = e instanceof AuthError ? e.code : 'unreachable';
      showLoginNotice({ text: !retry && code === 'bad-login' ? SIGN_IN_AGAIN : authErrorMessage(code), error: true });
    });
    void trade(deviceId, true);
  };
  // A sign-in link (emailed, or the end of Google's round trip) signs this browser in, then shows the profile.
  useEffect(() => {
    const { token, failed } = loginLink;
    if (!API_URL || (!token && !failed)) return;
    if (!token) {
      showLoginNotice({ text: "Google sign-in didn't finish. Try again.", error: true });
      return;
    }
    authApi(API_URL, profile.deviceId).checkLink(token).then(({ email, confirm }) => {
      // Asked only of an emailed link for an account other than the one this device is signed in to.
      if (!confirm || session?.account.email === email) {
        tradeLoginLink(token);
        return;
      }
      setLoginAsk({ email, signingIn: false });
      setAccountNotice(null);
      setScreen({ name: 'profile', from: { name: 'title' }, page: 'account' });
    }, (e: unknown) => {
      showLoginNotice({ text: authErrorMessage(e instanceof AuthError ? e.code : 'unreachable'), error: true });
      checkOnOpening();
    });
  }, []);

  // Signed in (on opening the app, or just now), sync; then whenever a game is saved or you come back to the page.
  useEffect(syncNow, [session?.account.id]);
  useEffect(() => {
    const stop = onGameSaved((id) => {
      notePending([id]);
      syncNow();
    });
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      syncNow();
      pullPlayed();
      // A friend may have challenged you since, or (a guest too) asked for a rematch.
      if (latest.current.session || loadFriendGames().length > 0) pullFriendGames(latest.current.identity);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  // A change to the synced profile or settings goes to the account shortly after.
  const syncedKey = profileKey(syncedOf(profile, settings));
  const firstKey = useRef(syncedKey);
  useEffect(() => {
    if (syncedKey === firstKey.current) return;
    firstKey.current = '';
    const timer = setTimeout(syncNow, PROFILE_SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [syncedKey]);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveProfile(profile), [profile]);
  useEffect(() => saveSession(session), [session]);

  // The profile's rows and stats, and the title screen's unlocked modes, need every finished game; loaded only there.
  const historyGames = useHistoryGames(historyVersion,
    screen.name === 'profile' || screen.name === 'title' || screen.name === 'friendProfile');
  const open = useMemo(
    () => historyGames && openModes(computeUnlocks(historyGames.map((g) => ({ id: g.entry.id, replayed: g.replayed })))),
    [historyGames]);

  const exit = () => setScreen({ name: 'title' });
  // Leaving a game for the profile keeps it (a Rush pauses), and Back picks it up again.
  const openProfile: OpenProfile = (page) => setScreen({
    name: 'profile',
    // Some callers pass a click event; only a section name opens a subpage.
    page: isProfilePage(page) ? page : null,
    from: screen.name === 'title' || screen.name === 'profile' || screen.name === 'leaderboards' ? { name: 'title' }
      : screen.name === 'friendProfile' ? screen.from
      // After Play again from a review, the new game is the one to come back to.
      : screen.name === 'review' ? (SCREEN_MODE[screen.game.replayed.mode]
        ? { name: SCREEN_MODE[screen.game.replayed.mode]!, resume: true } : { name: 'title' })
        : screen.name === 'friend' || screen.name === 'lobby' || screen.name === 'match' ? screen
          : screen.name === 'daily' ? { name: 'daily', start: false }
            : { name: screen.name, resume: true },
  });

  // The screen, with the keyboard's layout (a setting) for every game on it.
  const view = (() => {
    if (screen.name === 'profile') {
      const openReview = (game: HistoryGame) => setScreen({ name: 'review', game, from: screen.from });
      return (
        <ProfileScreen profile={profile} identity={identity} onProfile={setProfile} settings={settings} onSettings={setSettings}
          synced={!!API_URL && session !== null}
          page={screen.page}
          onPage={(page) => {
            if (page === null) setAccountNotice(null);
            setScreen({ ...screen, page });
          }}
          onBack={() => {
            setAccountNotice(null);
            setScreen(screen.from);
          }}
          onHome={() => {
            setAccountNotice(null);
            setScreen({ name: 'title' });
          }} onGamesChanged={() => {
            setHistoryVersion((v) => v + 1);
            syncNow();
          }}
          summaries={profileSummaries({ games: historyGames, session: API_URL ? session : null, settings })}
          pages={{
            account: API_URL ? (
              <AccountSection apiUrl={API_URL} guestId={profile.deviceId} session={session}
                onAccount={(account) => setSession((s) => s && { ...s, account })} onSignedOut={(newGuest, deliberate) => {
                // Signing out (or deleting the account) on purpose: a friend's invite opened on this
                // device isn't the next person's to accept. An expired session keeps it, to sign in again.
                if (deliberate) {
                  savePendingInvite(null);
                  setPendingInvite(null);
                }
                signedOut(newGuest);
              }}
                notice={accountNotice}
                loginAsk={loginAsk} onLoginAsk={(yes) => {
                  const token = loginLink.token;
                  if (yes && token && loginAsk && API_URL) {
                    setLoginAsk({ ...loginAsk, signingIn: true });
                    // Signed in to another account: sign out of it properly first (the question said so),
                    // on the server too, then sign in as a new guest, as signing out does.
                    const old = latest.current.session;
                    if (!old) {
                      tradeLoginLink(token);
                      return;
                    }
                    void authApi(API_URL, profile.deviceId).signOut(old.token).catch(() => {})
                      .then(() => tradeLoginLink(token, signedOut(true)!));
                    return;
                  }
                  setLoginAsk(null);
                  setAccountNotice({ text: "You didn't sign in. This device stays as it was.", error: false, quiet: true });
                  checkOnOpening();
                }} />
            ) : <NoServerSection label="Account" needs="Signing in" />,
            friends: API_URL ? (
              <FriendsSection apiUrl={API_URL} identity={identity} name={displayName(profile)} addCode={friendCode}
              onSignIn={() => setScreen({ name: 'profile', from: screen.from, page: 'account' })}
              invite={pendingInvite} onInviteDone={() => {
                savePendingInvite(null);
                setPendingInvite(null);
              }}
                onChallenge={(friend) => {
                  setSettings({ ...settings, mode: 'two', opponent: 'friend' });
                  setScreen({ name: 'friend', id: null, challenge: friend });
                }}
                onOpenFriend={(friend) => {
                  setFriendFilter({});
                  setScreen({ name: 'friendProfile', friend, page: null, from: screen.from });
                }} />
            ) : <NoServerSection label="Friends" needs="Friends" />,
            stats: <StatsPage games={historyGames} identity={identity} signedIn={session !== null} onOpen={openReview} />,
            achievements: <AchievementsPage games={historyGames} />,
            history: <GameHistory key={historyVersion} filter={historyFilter} onFilter={setHistoryFilter} onOpen={openReview} />,
          }} />
      );
    }
    if (screen.name === 'friendProfile' && API_URL) {
      const { friend, from } = screen;
      return (
        <FriendProfileScreen apiUrl={API_URL} identity={identity} friend={friend} page={screen.page}
          onPage={(page) => setScreen({ ...screen, page })}
          onBack={() => setScreen({ name: 'profile', from, page: 'friends' })}
          yourGames={historyGames} filter={friendFilter} onFilter={setFriendFilter}
          onOpen={(game, name, placements) => setScreen({
            name: 'review', game, from, friend: { friend: { ...friend, name }, page: screen.page ?? 'history', placements },
          })} />
      );
    }
    const game = { settings, profile, onProfile: openProfile, onExit: exit };
    if (screen.name === 'review') {
      const { entry, replayed, summary } = screen.game;
      const { friend: theirs, from } = screen;
      const review = {
        id: entry.id, date: summary.endedAt, owner: theirs?.friend.name,
        onBack: () => setScreen(theirs ? { name: 'friendProfile', friend: theirs.friend, page: theirs.page, from }
          : { name: 'profile', from, page: 'history' }),
      };
      // The name on the player's side: a friend's, reviewing their game.
      const yourName = theirs ? theirs.friend.name : displayName(profile);
      // Each review is its own screen, even when one follows another of the same mode.
      if (replayed.mode === 'single' && entry.mode === 'single') {
        return <SoloScreen key={entry.id} {...game} resume={false} review={{ ...review, game: replayed.game, marks: entry.marks }} />;
      }
      if (replayed.mode === 'computer' && entry.mode === 'computer') {
        return <TwoPlayerScreen key={entry.id} {...game} resume={false} review={{ ...review, game: replayed.game, marks: entry.marks }} />;
      }
      if (replayed.mode === 'rush' && entry.mode === 'rush') {
        return <RushScreen key={entry.id} {...game} resume={false} review={{ ...review, run: replayed.game, marks: entry.marks }} />;
      }
      if (replayed.mode === 'friend' && entry.mode === 'friend') {
        return (
          <FriendScreen key={entry.id} settings={settings} profile={profile} identity={identity} onProfile={openProfile}
            onExit={exit} gameId={null} onGameId={(id) => setScreen({ name: 'friend', id })}
            onNewInvite={() => {
              setSettings({ ...settings, mode: 'two', opponent: 'friend' });
              setScreen({ name: 'friend', id: null });
            }}
            onNewMatch={() => setScreen({ name: 'match' })} onOpenGame={(id) => setScreen({ name: 'friend', id })}
            review={{
              ...review, marks: entry.marks, rating: ratingLine(replayed.rating),
              game: friendReviewGame(replayed.game, replayed.seat, yourName, replayed.opponent),
            }} />
        );
      }
      if (replayed.mode === 'daily' && entry.mode === 'daily') {
        const places = (theirs?.placements ?? loadPlacements()).filter((p) => p.day === replayed.day);
        const crush = places.find((p) => !p.rankBy) ?? null;
        const rush = places.find((p) => p.rankBy === 'rush') ?? null;
        return (
          <RushScreen key={entry.id} {...game} resume={false} review={{
            ...review, run: replayed.game, marks: entry.marks, heading: 'Daily Set',
            result: <DailyResult total={summary.yourGuesses} crush={crush} rush={rush} />,
          }} />
        );
      }
      if (replayed.mode === 'lobby' && entry.mode === 'lobby') {
        return (
          <RushScreen key={entry.id} {...game} resume={false} review={{
            ...review, run: replayed.game, marks: entry.marks,
            heading: wordSetName(replayed.kind, runRankBy(replayed.game)),
            result: <LobbyPlaces places={replayed.places} rankBy={runRankBy(replayed.game)} rating={ratingLine(replayed.rating)} />,
          }} />
        );
      }
    }
    if (screen.name === 'friend') {
      return (
        <FriendScreen key={screen.id ?? `new-${screen.challenge?.code ?? ''}`} settings={settings} profile={profile}
          identity={identity} challenge={screen.challenge ?? null} onProfile={openProfile}
          onExit={exit} gameId={screen.id} onGameId={(id) => setScreen({ name: 'friend', id })}
          onNewInvite={() => setScreen({ name: 'friend', id: null })}
          onNewMatch={() => {
            setSettings({ ...settings, mode: 'two', opponent: 'random' });
            setScreen({ name: 'match' });
          }}
          onOpenGame={(id) => setScreen({ name: 'friend', id })} />
      );
    }
    if (screen.name === 'match') {
      return (
        <MatchScreen settings={settings} profile={profile} identity={identity} signedIn={session !== null}
          onProfile={openProfile} onExit={exit} onMatched={(id) => setScreen({ name: 'friend', id })} />
      );
    }
    if (screen.name === 'daily') {
      return <DailyScreen {...game} identity={identity} start={screen.start}
        onBoardRankBy={(boardRankBy) => setSettings({ ...settings, boardRankBy })} />;
    }
    if (screen.name === 'leaderboards') {
      return <LeaderboardsScreen identity={identity} difficulty={settings.difficulty} board={screen.board} onExit={exit}
        rankBy={settings.boardRankBy} onRankBy={(boardRankBy) => setSettings({ ...settings, boardRankBy })} />;
    }
    if (screen.name === 'lobby') {
      return (
        <LobbyScreen key={screen.code ?? `new-${screen.kind ?? 'friends'}`} {...game} identity={identity} signedIn={session !== null}
          code={screen.code} kind={screen.kind ?? 'friends'} onCode={(code) => setScreen({ name: 'lobby', code })}
          onRankBy={(rankBy) => setSettings({ ...settings, rankBy })} />
      );
    }
    const resume = screen.name !== 'title' && screen.name !== 'review' && screen.name !== 'friendProfile' && screen.resume;
    if (screen.name === 'single') return <SoloScreen {...game} resume={resume} />;
    if (screen.name === 'rush') return <RushScreen {...game} resume={resume} />;
    if (screen.name === 'two') return <TwoPlayerScreen {...game} resume={resume} />;
    return (
      <TitleScreen open={open} friendGamesVersion={friendGamesVersion} settings={settings} onSettings={setSettings} inProgress={inProgress()}
        dailyInProgress={!!API_URL && dailyInProgress(dailyDay(Date.now()))}
        lobbyInProgress={API_URL ? activeLobbyKind() : null}
        onLobby={(code) => {
          const open = code ?? activeLobby();
          if (!open) return;
          const kind = code ? null : activeLobbyKind();
          setSettings({ ...settings, mode: 'rush', rushKind: kind ?? (settings.rushKind === 'competitive' ? 'competitive' : 'friends') });
          setScreen({ name: 'lobby', code: open });
        }}
        onDaily={() => {
          setSettings({ ...settings, mode: 'rush', rushKind: 'daily' });
          setScreen({ name: 'daily', start: false });
        }}
        onLeaderboards={(board) => setScreen({ name: 'leaderboards', board: board ?? null })}
        profile={profile} identity={identity} onProfile={openProfile}
        onContinue={(mode) => {
          setSettings({ ...settings, mode });
          setScreen({ name: mode, resume: true });
        }}
        onOpenFriendGame={(id) => setScreen({ name: 'friend', id })}
        onStart={() => setScreen(settings.mode === 'two' && settings.opponent === 'friend' ? { name: 'friend', id: null }
          : settings.mode === 'two' && settings.opponent === 'random' ? { name: 'match' }
          : settings.mode === 'rush' && settings.rushKind === 'daily' ? { name: 'daily', start: true }
            : settings.mode === 'rush' && (settings.rushKind === 'friends' || settings.rushKind === 'competitive')
              ? { name: 'lobby', code: null, kind: settings.rushKind }
            : { name: settings.mode, resume: false })} />
    );
  })();
  return (
    <EnterSide.Provider value={settings.enterRight ? 'right' : 'left'}>
      {view}
      {showUpdate && <UpdateBar onUpdate={updateNow} onHide={() => setUpdateHidden(update.latest?.build ?? null)} />}
    </EnterSide.Provider>
  );
}
