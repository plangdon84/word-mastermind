/*
 * The profile's sections (README "Profile" Layout): the hub has a row for
 * each, and each opens as its own subpage. Links from elsewhere in the app
 * (the badge toast, a friend's link, signing in) open the right one.
 */

export type ProfilePage = 'account' | 'friends' | 'stats' | 'achievements' | 'history' | 'settings' | 'help' | 'data';

export const PROFILE_PAGES: readonly ProfilePage[] = ['account', 'friends', 'stats', 'achievements', 'history', 'settings', 'help', 'data'];

export const isProfilePage = (value: unknown): value is ProfilePage => PROFILE_PAGES.includes(value as ProfilePage);

export const PROFILE_PAGE_TITLE: Record<ProfilePage, string> = {
  account: 'Account',
  friends: 'Friends',
  stats: 'Stats',
  achievements: 'Achievements',
  history: 'Game history',
  settings: 'Settings',
  help: 'Help',
  data: 'Your data',
};

/** Opens the profile, at a section's subpage or (with none) the hub. */
export type OpenProfile = (page?: ProfilePage) => void;
