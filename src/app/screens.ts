import { lazy, preloadToo } from './lazy';

/*
 * The screens and pages that load when first needed (`lazy.tsx`, Dev Plan
 * item 19m): every one but the title screen and the games a new player
 * starts with (single player and two player vs. the computer). Import them
 * from here, never from their own modules, or they load at start-up again.
 */

export const FriendScreen = lazy(() => import('./FriendScreen').then((m) => m.FriendScreen));
export const MatchScreen = lazy(() => import('./MatchScreen').then((m) => m.MatchScreen));
export const DailyScreen = lazy(() => import('./DailyScreen').then((m) => m.DailyScreen));
export const LobbyScreen = lazy(() => import('./LobbyScreen').then((m) => m.LobbyScreen));
export const RushScreen = lazy(() => import('./RushScreen').then((m) => m.RushScreen));
export const LeaderboardsScreen = lazy(() => import('./LeaderboardsScreen').then((m) => m.LeaderboardsScreen));
export const ProfileScreen = lazy(() => import('./ProfileScreen').then((m) => m.ProfileScreen));
export const FriendProfileScreen = lazy(() => import('./FriendProfileScreen').then((m) => m.FriendProfileScreen));
export const GameHistory = lazy(() => import('./GameHistory').then((m) => m.GameHistory));
export const Analytics = lazy(() => import('./Analytics').then((m) => m.Analytics));
export const AccountSection = lazy(() => import('./AccountSection').then((m) => m.AccountSection));
export const FriendsSection = lazy(() => import('./FriendsSection').then((m) => m.FriendsSection));
export const GoogleNamePrompt = lazy(() => import('./GoogleNamePrompt').then((m) => m.GoogleNamePrompt));
export const Tutorial = lazy(() => import('./Tutorial').then((m) => m.Tutorial));
// Quiet: a release popup that can't load waits for the next visit rather than showing a panel there's no closing.
export const ReleasePopup = lazy(() => import('./ReleaseNotes').then((m) => m.ReleasePopup), { quiet: true });
export const WhatsNew = lazy(() => import('./ReleaseNotes').then((m) => m.WhatsNew));
// Quiet: the toast waits for the next result rather than show a hole. The badges load after the page has (Dev Plan item 19zq).
export const BadgeToast = lazy(() => import('./Badge').then((m) => m.BadgeToast), { quiet: true });
export const StatsPage = lazy(() => import('./profileSubpages').then((m) => m.StatsPage));
export const AchievementsPage = lazy(() => import('./profileSubpages').then((m) => m.AchievementsPage));
export const ReportForm = lazy(() => import('./ReportIssue').then((m) => m.ReportForm));
export const SampleGame = lazy(() => import('./sampleGame').then((m) => m.SampleGame));
export const MovedNotice = lazy(() => import('./MovedNotice').then((m) => m.MovedNotice));

// Modules the start-up code loads with `import()` when it first needs them: fetched with the screens, after the page has loaded.
preloadToo(() => import('../game/achievements'));
preloadToo(() => import('../game/stats'));
preloadToo(() => import('./sharedSummary'));
preloadToo(() => import('./sharedParse'));
