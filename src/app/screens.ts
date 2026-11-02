import { lazy } from './lazy';

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
export const ReleasePopup = lazy(() => import('./ReleaseNotes').then((m) => m.ReleasePopup));
export const WhatsNew = lazy(() => import('./ReleaseNotes').then((m) => m.WhatsNew));
