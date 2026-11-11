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
    version: '2.7.1',
    notes: [
      { text: 'Tapping ⓘ for a definition is now much lighter: it loads only the definitions you need, so the first tap uses far less data.' },
    ],
  },
  {
    version: '2.7.0',
    notes: [
      { text: "A friend's profile now shows your Win % against them in the You vs. box, with a draw counting as half a win." },
    ],
  },
  {
    version: '2.6.1',
    notes: [
      { text: "A rated draw now moves ratings a little: the lower rated player gains and the higher rated one loses. Everyone's rating has been recalculated this way." },
    ],
  },
  {
    version: '2.6.0',
    notes: [
      { text: "Win % now counts a draw as half a win, everywhere it's shown, including a friend's Stats." },
      { text: 'The Rated ladder in Stats now shows arrows for how your Win % and your rating have moved over the last 30 days.' },
    ],
  },
  {
    version: '2.5.0',
    notes: [
      { text: "You can report a word you think shouldn't be in the game: tap ⓘ beside it and then Report this word." },
    ],
  },
  {
    version: '2.4.1',
    notes: [
      { text: 'Game history now lists games in the order they finished, so rated games show your rating changes in order.' },
    ],
  },
  {
    version: '2.4.0',
    notes: [
      { text: 'A solo Word Set open in two tabs no longer loses a guess when you switch between them quickly.' },
      { text: 'Sending a friend request again within a week no longer alerts the other player a second time.' },
      { text: 'After you remove a friend, either of you can add the other again straight away.' },
      { text: "When two players add each other at the same moment, they're now made friends straight away, and neither gets an alert for a request they can't answer." },
      { text: 'Cancelling the Rated ladder while a computer game is being set up no longer leaves that game under Games in progress.' },
    ],
  },
  {
    version: '2.3.0',
    notes: [
      { text: 'Your game history has a Rated ladder filter, and Stats shows your ladder record and rating.' },
      { text: "The rating board's column headings now line up with their numbers." },
      { text: 'After a Rated ladder game against a person, you can send them a friend request.' },
      { text: 'Opening the Rated ladder shows how many players are waiting and how many are in ladder games now.' },
    ],
  },
  {
    version: '2.2.0',
    notes: [
      { text: 'Picking a difficulty on a phone no longer leaves a second choice looking picked.' },
      { text: 'The two player rating board has column headings, and long names end in … to fit.' },
      { text: 'Some very obscure words are no longer picked as secret words.' },
      { text: 'Clearer definition for a word that only showed an unkind meaning.' },
      { text: "In a live game, each clock now sits in its player's tab, leaving more room for your guesses." },
      { text: 'A name that\'s no longer allowed now shows as "A player" in friend games and Rush lobbies too, old results included.' },
    ],
  },
  {
    version: '2.1.0',
    notes: [
      { text: 'New: the Rated ladder. Play live, 10 minutes each, at Medium against a player near your rating, or a computer at your level if no one is free after 30 seconds.' },
      { text: "Correspondence, rated challenges and the Rated ladder now share one two player rating and leaderboard, which shows how many of each player's games were against computers." },
    ],
  },
  {
    version: '2.0.1',
    notes: [
      { text: 'A name that\'s no longer allowed now shows as "A player" on every leaderboard.' },
      { text: 'A new name chosen as a guest now reaches the daily leaderboards, even if you were offline when you chose it.' },
    ],
  },
  {
    version: '2.0.0',
    notes: [
      { text: 'New leaderboard for players that compete in rated games.' },
      { text: 'Squashed some obscure bugs.' },
      { text: 'Made the app smaller, faster, and more efficient behind the curtain.' },
    ],
  },
  {
    version: '1.24.0',
    notes: [
      { text: 'Coming back to the title screen no longer shows today\'s daily games as not played while they load.' },
      { text: 'Word Sets with friends: once you\'ve finished, Games in progress reads Waiting for others, then See results when everyone\'s done.' },
      { text: 'The notification that a Word Set with friends is over no longer waits until someone opens it.' },
      { text: 'Setting up a game against a friend now lists the time choices shortest first.' },
      { text: 'Tapping a difficulty on an iPhone no longer leaves a white outline around it.' },
      { text: '"NEATH" is no longer accepted as a guess.' },
      { text: 'Live games against a friend: your clock starts after your first guess.' },
      { text: "If a player hasn't made their first guess within 2 minutes of their turn starting, the live game is cancelled, with no winner." },
      { text: 'The Daily Word now has Pause, twice a day, like the Daily Set.' },
    ],
  },
  {
    version: '1.23.0',
    notes: [
      { text: 'Signing in with Google for the first time? You can use your Google name as your player name, or pick another.' },
    ],
  },
  {
    version: '1.22.0',
    notes: [
      { text: 'Finished a Daily Set or Daily Word as a guest? You can choose your leaderboard name right on the result.' },
      { text: 'Changing your name updates current and historical leaderboards to match your current name.' },
    ],
  },
  {
    version: '1.21.1',
    notes: [
      { text: 'A friend’s game history no longer shows a game twice if they finish one while you’re scrolling.' },
      { text: 'A friend’s profile closes when they’re no longer on your friends list.' },
      { text: 'Opening a friend’s profile no longer shows “too many requests” while your own long history is being set up for friends.' },
    ],
  },
  {
    version: '1.21.0',
    notes: [
      { text: 'The Daily card on the title screen shows your place so far in each daily game you’ve played, like “12th of 340 so far”.' },
    ],
  },
  {
    version: '1.20.1',
    notes: [
      { text: 'Rematches use your current difficulty preference instead of defaulting to the previous game’s difficulty.' },
      { text: 'Minor changes to wording of push notifications.' },
    ],
  },
  {
    version: '1.20.0',
    notes: [
      { text: 'In a word set game, tap “Found so far” to see the words you’ve found.' },
    ],
  },
  {
    version: '1.19.2',
    notes: [
      { text: "Five words that don't belong are no longer accepted as guesses" },
      { text: '"Hyper" can now be a secret word' },
    ],
  },
  {
    version: '1.19.1',
    notes: [
      { text: "Modes you've opened no longer show as locked when you come back to the app" },
      { text: 'Finishing the Daily Set or Daily Word shows any badge you earned, as other modes do' },
      { text: 'Your record against a friend fits on a phone screen' },
    ],
  },
  {
    version: '1.19.0',
    notes: [
      { text: 'Enhanced tutorial' },
    ],
  },
  {
    version: '1.18.0',
    notes: [
      { text: 'Adjusted requirements to unlock new modes of play' },
    ],
  },
  {
    version: '1.17.0',
    notes: [
      { text: 'With Alerts on, you now get push notifications for the following:' },
      { text: 'Correspondence game’s time to guess is nearly up' },
      { text: 'Reminder to play the Daily Set and Word if you haven’t by 8pm New York Time' },
      { text: 'To play a game if you haven’t in the last week' },
    ],
  },
  {
    version: '1.16.0',
    notes: [
      { text: 'Two player → A friend now lists your friends under the invite link: tap one to challenge them.' },
      { text: 'Game history’s search now finds games by who you played. Searching by word is gone.' },
      { text: 'Tap the Daily card’s heading to fold it to one line showing what’s left to play.' },
      { text: '“Binky” is now accepted as a guess.' },
    ],
  },
  {
    version: '1.15.4',
    notes: [
      { text: 'A Rush score now reads as a time a word (“2:01 a word”), so it can’t be mistaken for a number of guesses.' },
      { text: 'A Rush score now rounds up to the whole second.' },
    ],
  },
  {
    version: '1.15.3',
    notes: [
      { text: 'Fixed a bug preventing games history from fully loading for some players.' },
    ],
  },
  {
    version: '1.15.2',
    notes: [
      { text: 'Small layout fixes: the Check for mistakes button, a friend’s name beside “You vs.” and the place on a Daily result now line up properly.' },
      { text: 'Sharing a Daily Word result now puts its square, guesses and place on one line.' },
    ],
  },
  {
    version: '1.15.1',
    notes: [
      { text: 'The links at the bottom of the home page are now one row of small print, so the screen is shorter.' },
    ],
  },
  {
    version: '1.15.0',
    notes: [
      { text: 'Find friends by name: search for a player and send them a friend request.' },
      { text: 'Or type a friend’s email to send them a request if they have a wordmastermind.app account.' },
      { text: 'You can now be found by your name. Turn it off on the Friends page.' },
    ],
  },
  {
    version: '1.14.0',
    notes: [
      { text: 'New: Daily Word. One word a day, the same for everyone, with its own leaderboard for each difficulty.' },
      { text: 'Daily Word has its own streak badges and a Share button.' },
    ],
  },
  {
    version: '1.13.4',
    notes: [
      { text: 'Friends’ profiles open much faster, and their game history loads as you scroll.' },
    ],
  },
  {
    version: '1.13.3',
    notes: [
      { text: 'Fixed friends’ profiles not opening.' },
    ],
  },
  {
    version: '1.13.1',
    notes: [
      { text: 'Fixed a bug blocking download of historical games when reinstalling the app.' },
    ],
  },
  {
    version: '1.13.0',
    notes: [
      { text: 'Tap a friend’s name in a game against them, the results screen of a rush or crush with friends, or on a leaderboard’s Friends view to open their profile.' },
      { text: 'Only names of people on your friends list open a profile. Everyone else’s name stays as it is.' },
    ],
  },
  {
    version: '1.12.0',
    notes: [
      { text: 'Tap a friend’s name on your friends list to see their profile: their country, stats, badges and every game they’ve finished, each one open to review.' },
      { text: 'A friend’s stats start with your record against them: wins, draws and losses in two player games and Word Sets you’ve played together.' },
      { text: 'Your friends can see your profile the same way. Your settings and email stay private, and today’s Daily Set stays hidden until the day is over.' },
    ],
  },
  {
    version: '1.11.0',
    notes: [
      { text: 'Word Sets now come in two kinds: Rush ranks by fastest time, and Crush by fewest guesses. Pick one with the new “Ranked by” switch before you start.' },
      { text: 'A Solo Rush scores your average time a word, with its own levels: under 2 minutes a word is Mastermind. Giving up a word in a Rush adds 2 minutes.' },
      { text: 'In Word Sets with friends, the host picks Rush or Crush for the lobby.' },
      { text: 'The Daily Set now has two leaderboards for each difficulty, Rush and Crush. Your result shows your place on both, and a switch on the leaderboard flips between them.' },
      { text: 'New Rush level badges, earned by time. The old Rush level badges are now Crush level badges, and any you’ve earned stay earned.' },
      { text: 'Your past Word Sets were scored by guesses, so they now show as Crush.' },
    ],
  },
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

/**
 * This version: the newest release's. The app reads it from `version.ts`,
 * where the build puts it, so the notes above load only when they're shown.
 */
export const APP_VERSION = RELEASES[0].version;
