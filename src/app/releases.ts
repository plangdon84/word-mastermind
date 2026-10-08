/*
 * Version number and release notes (Dev Plan item 18g, issue #91; README
 * "Version and release notes"). A PR that changes what players see adds a
 * release at the top of RELEASES: 1.1.0 for a feature, 1.0.1 for a fix,
 * with one-line notes the owner reviews in the PR's Release note section.
 * Other PRs leave it alone.
 */

/** A picture a note can show in the popup: a mock-up of the real thing (ReleaseNotes.tsx). */
export type ReleasePicture = 'how-to-play' | 'version';

export interface ReleaseNote {
  /** One line, in plain words. */
  text: string;
  /** Shown under the note in the popup only; the What's new page is text alone. */
  picture?: ReleasePicture;
}

export interface Release {
  /** major.minor.patch */
  version: string;
  notes: ReleaseNote[];
}

/** Every version, newest first. */
export const RELEASES: Release[] = [
  {
    version: '1.10.0',
    notes: [
      { text: 'A new title screen: today’s Daily Set is at the top, then your games in progress, then Practice, Two player and Word Sets.' },
      { text: 'Daily Rush is now called Daily Set. It has its own card at the top, with your place a tap away once you’ve played, instead of sitting in the Rush menu.' },
      { text: 'Games in progress: all your in-progress multiplayer games and solo play are grouped here, except the Daily ones. The list is open by default when a game is waiting on you.' },
      { text: 'Single player is now called Practice, and Rush is now Word Sets. Your past games, badges and unlocks stay as they were.' },
    ],
  },
  {
    version: '1.9.0',
    notes: [
      { text: 'Two new badges for beating a friend by finding their word while playing at a harder level than them: one level harder, and two or more.' },
      { text: 'A new Clairvoyant badge for finding a word with your first guess, in any mode, without Suggest.' },
      { text: 'Achievement Hunter now counts the new badges, but any Hunter badge you’ve already earned stays earned.' },
    ],
  },
  {
    version: '1.8.0',
    notes: [
      { text: 'Daily Rush now changes over at midnight New York time (4am or 5am UTC, depending on the time of year). On the day it switches, that day’s set runs a few hours longer.' },
      { text: 'If the day changes while you’re playing Daily Rush, you can still finish. It just won’t go on the leaderboard or your streak.' },
      { text: 'Daily Rush warns you when there are 5 minutes or less left in the day, before you start and while you play.' },
      { text: 'Daily Rush now has a Pause button: your clock stops and your guesses are hidden until you resume.' },
    ],
  },
  {
    version: '1.7.5',
    notes: [
      { text: 'On Extreme, your latest guess and its score stay at the top while you scroll back through your scores.' },
      { text: 'When challenging a friend, the whole keyboard for choosing your word is visible without scrolling. The settings above it scroll if they need room.' },
      { text: 'Your Rating in Stats now fits inside its box on small phones.' },
    ],
  },
  {
    version: '1.7.4',
    notes: [
      { text: 'Report an issue now always sends your report privately. If it can’t be sent, it says to try again later and keeps what you wrote.' },
    ],
  },
  {
    version: '1.7.3',
    notes: [
      { text: 'A report you post on GitHub yourself (when the game can’t send it) no longer includes your game, so it can’t show your secret word.' },
    ],
  },
  {
    version: '1.7.2',
    notes: [
      { text: 'The home-screen icon now follows your iPhone’s icon style: white behind it in Default, black in Dark, and Clear and Tinted too. Add the game to your home screen again to get it.' },
    ],
  },
  {
    version: '1.7.1',
    notes: [
      { text: 'Best win counts only games you won by finding their word, not ones won because your opponent gave up, ran out of time or left.' },
      { text: 'The few-guesses badges now say they don’t count a word found with Suggest, and the end of a game tells you when Suggest kept you from one.' },
      { text: 'Daily Rush’s “better than X%” now leaves you out of the count, so first place shows 100%.' },
      { text: 'The friends list sits below the boxes for adding friends, so you can add someone without scrolling past a long list.' },
    ],
  },
  {
    version: '1.7.0',
    notes: [
      { text: 'A draw in a rated game no longer changes either rating. It still counts as a game played toward being listed on the boards.' },
      { text: 'The rating change at the end of a rated game is now that game’s own, even when other rated games finished while it was going.' },
      { text: 'Games against friends show each player’s current name, so a new profile name or a guest who signs in shows up straight away.' },
      { text: 'Rematch sent → turns back into Rematch as soon as your rematch is declined or runs out.' },
    ],
  },
  {
    version: '1.6.2',
    notes: [
      { text: 'Keyboard keys now match the letters in your guesses, and How to play and the tutorial show what each mark looks like.' },
      { text: 'Tapping ⓘ on your last guess shows its definition, the keyboard steps aside while they take their final guess, and on a computer or tablet both guess lists line up.' },
      { text: 'Finding their word in practice after a loss now gives both counts: your practice guesses and the game’s.' },
    ],
  },
  {
    version: '1.6.1',
    notes: [
      { text: 'Emirs and uteri are no longer picked as secret words. You can still guess them.' },
      { text: 'Babby and bints are no longer accepted as guesses.' },
      { text: 'Knurl, flams and doled now have a definition behind ⓘ.' },
    ],
  },
  {
    version: '1.6.0',
    notes: [
      { text: 'Before your first guess you can pick any difficulty. After it you can only switch to an easier one, so the level everyone sees is the one your game counts at.' },
      { text: 'The difficulty bubble at the top of a game now has its badge colour. Tap it to change difficulty.' },
      { text: 'Check for mistakes now works once a game (once a word in a Rush). The menu says when you’ve used it.' },
      { text: 'The computer no longer forgets a guess that scored 5: from then on it only guesses anagrams of it.' },
    ],
  },
  {
    version: '1.5.0',
    notes: [
      { text: 'Challenging a friend from your friends list now lets you pick the difficulty and clock for that game. Your defaults stay as they are.' },
      { text: 'Ticking Rated game while on Easy now moves you to Medium, with a note, instead of refusing.' },
      { text: 'Your opponent’s rating in the header is no longer cut off on a phone.' },
      { text: 'A long finished game against a friend now scrolls all the way to its last guess.' },
      { text: 'The Word Mastermind link in the header now has the app’s icon beside it.' },
    ],
  },
  {
    version: '1.4.2',
    notes: [
      { text: 'Updates to app versioning process.' },
      { text: 'Tapping a turn notification on an iPhone now opens that game, even when the app was already open on another screen.' },
      { text: 'When your opponent plays on Medium but isn’t sharing their marks, their guess sheet now says so.' },
    ],
  },
  {
    version: '1.4.1',
    notes: [
      { text: 'Time played on your profile no longer counts time away from a game: at most 5 minutes counts between two moves.' },
    ],
  },
  {
    version: '1.4.0',
    notes: [
      { text: "Lost a two player game? Keep guessing their word for practice, or see it. Practice never changes the result." },
    ],
  },
  {
    version: '1.3.0',
    notes: [
      { text: 'Your opponent’s guess sheet will show you what difficulty they are playing on.' },
      { text: 'Letters your opponent thinks are in or out of your word are marked on your copy of their guess sheet when playing against Computer players and opponents playing on Easy or Medium.' },
      { text: 'You can prevent your opponents from seeing the letters you mark in or out by disabling this feature in Profile->Settings.' },
    ],
  },
  {
    version: '1.2.0',
    notes: [
      { text: 'At the end of a two player game, you can collapse the game results to one line by pressing the x button, so you can look back over your guesses.' },
      { text: 'When viewing a previous game from Profile->Game History, return to your Game History page by clicking the “<-Past Game” button next to menu.' },
      { text: "The padlock on the unlock badges no longer covers the word UNLOCKED." },
    ],
  },
  {
    version: '1.1.0',
    notes: [
      { text: 'Rematch: after a game against a friend, click the “Rematch” button to challenge them again to another game with the same settings as the game you just finished.' },
      { text: 'Players are notified when their opponent requests a rematch, and have the option to accept or decline it.' },
    ],
  },
  {
    version: '1.0.0',
    notes: [
      { text: 'Word Mastermind 1.0: single player, two player and every Rush, at Easy, Medium, Hard and Extreme.' },
      { text: 'The version is at the bottom of the title screen: tap it to see what changed in each version.', picture: 'version' },
      { text: 'New to the game? How to play, on the title screen, has the rules.', picture: 'how-to-play' },
    ],
  },
];

export const APP_VERSION = RELEASES[0].version;

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** A version's numbers, or null if it isn't major.minor.patch. */
export function parseVersion(version: string): [number, number, number] | null {
  const m = VERSION.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative if a is older than b, positive if newer, 0 if the same. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a) ?? [0, 0, 0];
  const y = parseVersion(b) ?? [0, 0, 0];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/**
 * Whether the popup shows, given the last version this device was told
 * about: only for a newer one. A device that's never been told (null) was
 * here before versions began, since a new device is marked on its first
 * visit (`noteFirstVisit`).
 */
export const releasePopupDue = (seen: string | null, current: string = APP_VERSION): boolean =>
  seen === null || compareVersions(current, seen) > 0;

export const SEEN_KEY = 'word-mastermind:seen-version:v1';

/** The last version this device was told about. Browser storage can be blocked. */
export function readSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return APP_VERSION;
  }
}

export function markVersionSeen(version: string = APP_VERSION): void {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    // It shows again next visit; nothing else is lost.
  }
}

/**
 * Run once at start-up, before the app makes a profile: a device on its
 * first visit (no profile yet) has nothing to catch up on, so it's marked as
 * having seen this version and gets no popup.
 */
export function noteFirstVisit(profileKey: string): void {
  try {
    if (localStorage.getItem(SEEN_KEY) === null && localStorage.getItem(profileKey) === null) markVersionSeen();
  } catch {
    // Blocked storage: readSeenVersion says seen, so no popup either way.
  }
}
