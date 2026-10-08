import type { Difficulty, EarlierGuess, GuessResult, RunError, SoloGameError, TwoPlayerError, WordError } from '../game';
import type { DailyError } from './dailyApi';
import type { FriendError } from './friendApi';
import type { LobbyErrorCode } from './lobbyApi';

/** "1 game", "3 games". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "1 guess", "3 guesses". */
export const guessCount = (n: number) => `${n} ${n === 1 ? 'guess' : 'guesses'}`;

/** The result of ☰ Check marks (Medium): whether the marks fit the scores, never which one doesn't. */
export function marksCheckMessage(fit: boolean): { text: string; error: boolean } {
  return fit
    ? { text: 'No mistakes: your highlights fit every score.', error: false }
    : { text: "Something in your highlights doesn't fit the scores.", error: true };
}

/** In a Rush, Suggest's limit is per word. */
export const RUSH_NO_SUGGESTIONS = 'No suggestions left for this word.';

/** What to tell the player when a guess is rejected. */
export function errorMessage(error: SoloGameError | TwoPlayerError | RunError, word: string): string {
  switch (error) {
    case 'wrong-length':
      return 'Enter 5 letters.';
    case 'not-letters':
      return 'Use only the letters A to Z.';
    case 'repeated-letters':
      return "A secret word can't repeat a letter.";
    case 'not-in-word-list':
      return `${word.toUpperCase()} isn't in the word list.`;
    case 'game-over':
      return 'This game is over. Start a new game to keep playing.';
    case 'not-your-turn':
      return "Wait for the computer's guess.";
    case 'time-up':
      return 'Time is up.';
    case 'no-words':
      return 'There are no words to play.';
    case 'paused':
      return 'The clock is paused. Resume to keep playing.';
    case 'not-paused':
    case 'not-pausable':
      return "The clock can't be paused here."
    case 'not-easy':
      return 'Suggest is only on Easy.';
    case 'no-suggestions':
      return 'No suggestions left.';
    case 'difficulty-harder':
      return 'After your first guess you can only switch to an easier level.';
  }
}

/**
 * What to tell the player who types a word they already guessed. Extreme
 * hides your past words, so it reminds you of the score too.
 */
export function repeatMessage(word: string, earlier: EarlierGuess, difficulty: Difficulty): string {
  const text = `You already guessed ${word.trim().toUpperCase()} (guess ${earlier.number}).`;
  return difficulty === 'extreme' ? `${text} It scored ${earlier.result.score}.` : text;
}

/** What to tell the player when their chosen secret word is rejected. */
export function secretErrorMessage(error: WordError, word: string): string {
  // A word can be a fine guess but not a secret: secrets come from a smaller
  // list of common words.
  if (error === 'not-in-word-list') {
    return `${word.toUpperCase()} can't be a secret word. Try a more common word.`;
  }
  return errorMessage(error, word);
}

/** What to tell the player after a scored guess that didn't win. */
export function scoreMessage(result: GuessResult): string {
  if (result.score === 5) return "All 5 letters are in the word. It's an anagram.";
  const letters = result.score === 1 ? 'letter' : 'letters';
  return `${result.guess.toUpperCase()} shares ${result.score} ${letters} with the word.`;
}

/** What to tell the player when the server refuses a request in a game against a friend. */
export function friendErrorMessage(error: FriendError | 'unreachable', word = ''): string {
  switch (error) {
    case 'wrong-length':
    case 'not-letters':
    case 'repeated-letters':
    case 'not-in-word-list':
    case 'not-easy':
    case 'no-suggestions':
      return errorMessage(error, word);
    case 'not-your-turn':
      return "It's your friend's turn. You'll get your turn once they've guessed.";
    case 'game-over':
      return 'This game is over.';
    case 'time-up':
    case 'time-left':
      return 'Your time for this guess ran out.';
    case 'unreachable':
      return "Can't reach the game server. Check your connection and try again.";
    case 'not-found':
      return "This game doesn't exist. Check the link, or ask your friend for a new one.";
    case 'not-a-player':
      return "You're not playing in this game.";
    case 'own-invite':
      return "This is your own invite. Send the link to a friend; they'll choose their word on their device.";
    case 'invite-taken':
      return 'Someone else has already accepted this invite.';
    case 'not-invited':
      return 'This challenge is for someone else.';
    case 'not-a-friend':
      return "You can only challenge your friends. Add them from your profile's friends list first.";
    case 'invite-closed':
      return 'This invite was cancelled or turned down.';
    case 'invite-expired':
      return 'This invite expired.';
    case 'not-over':
      return 'A rematch can be asked for once the game is over.';
    case 'not-started':
      return "The game hasn't started yet. Your friend still needs to accept the invite.";
    case 'signed-out':
    case 'sign-in-needed':
      return 'You were signed out. Sign in again from your profile to play your games.';
    case 'difficulty-fixed':
      return "Difficulty can't change during a rated game.";
    case 'difficulty-harder':
      return 'After your first guess you can only switch to an easier level.';
    case 'easy-unrated':
      return 'A rated game can’t be played at Easy. Pick another difficulty, or play it unrated.';
    case 'bad-request':
    case 'bad-guest-id':
      return 'Something went wrong. Reload the page and try again.';
  }
}

/** The same, as short as it gets, for the status row beside whose turn it is: "2d 5h", "5h", "12m". */
export function shortTimeLeft(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes < 60) return minutes <= 1 ? '<1m' : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const rest = hours % 24;
  return rest === 0 ? `${Math.floor(hours / 24)}d` : `${Math.floor(hours / 24)}d ${rest}h`;
}

/** A live game's clock: "4:05", "0:07"; never below zero. Seconds round up, so 0:00 means out of time. */
export function clockText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A time to come, roughly: "2 days 5 h", "5 h", "12 min", "under a minute". */
export function durationText(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes < 60) return minutes <= 1 ? 'under a minute' : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days} days` : `${days} days ${rest} h`;
}

/** Time left for a guess: "2 days 5 h left", "Under a minute left". */
export function timeLeftText(ms: number): string {
  const text = `${durationText(ms)} left`;
  return text[0].toUpperCase() + text.slice(1);
}

/** The time until the next Daily Rush set, in hours and minutes: "5h 12m", "12m", "under a minute". */
export function countdownText(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes <= 1) return 'under a minute';
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes % 60}m`;
}

/** How close to the day's end the Daily Rush warns (README "Daily Rush"). */
export const DAY_ENDING_MS = 5 * 60_000;

/** "4 minutes", "1 minute", "under a minute": the last minutes of the day. */
function minutesLeft(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  return ms < 60_000 ? 'under a minute' : minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** With 5 minutes or less of the day left, while playing: "4 minutes left to finish for today's board". */
export function dayEndingText(ms: number): string | null {
  if (ms > DAY_ENDING_MS || ms <= 0) return null;
  const left = minutesLeft(ms);
  return `${left[0].toUpperCase()}${left.slice(1)} left to finish for today's board.`;
}

/** The same warning before you start. */
export function dayEndingStartText(ms: number): string | null {
  if (ms > DAY_ENDING_MS || ms <= 0) return null;
  return `Only ${minutesLeft(ms)} of today left: a run not finished by then won't go on the board.`;
}

/** What to tell the player when the server refuses a Daily Rush request. */
export function dailyErrorMessage(error: DailyError | 'unreachable', word = ''): string {
  switch (error) {
    case 'wrong-length':
    case 'not-letters':
    case 'repeated-letters':
    case 'not-in-word-list':
    case 'not-easy':
      return errorMessage(error, word);
    case 'no-suggestions':
      return RUSH_NO_SUGGESTIONS;
    case 'unreachable':
      return "Can't reach the game server. Check your connection and try again.";
    case 'no-theme':
      return "There's no Daily Rush today.";
    case 'already-played':
      return "You've already played today's Daily Rush. A new set is out at midnight New York time.";
    case 'not-started':
      return "You haven't started today's Daily Rush.";
    case 'day-over':
      return "That day's Daily Rush is over: a new set is out.";
    case 'game-over':
      return "Today's Daily Rush is over for you.";
    case 'paused':
      return 'The clock is paused. Resume to keep playing.';
    case 'not-paused':
      return "The clock isn't paused.";
    case 'no-pauses-left':
      return 'You’ve used both pauses for this Daily Rush.';
    case 'not-pausable':
      return "This Daily Rush was started before Pause, so its clock can't pause.";
    case 'offensive-name':
      return "Your name can't go on the leaderboard. Change it on your profile to play.";
    case 'not-found':
      return 'There was no Daily Rush that day.';
    case 'signed-out':
    case 'sign-in-needed':
      return 'You were signed out. Sign in again from your profile to play.';
    case 'bad-request':
    case 'bad-guest-id':
      return 'Something went wrong. Reload the page and try again.';
  }
}

/** What to tell the player when the server refuses a Rush with Friends request. */
/** Why the server refused a lobby request; `secret` when `word` was your Competitive Rush word, not a guess. */
export function lobbyErrorMessage(error: LobbyErrorCode, word = '', secret = false): string {
  switch (error) {
    case 'wrong-length':
    case 'not-letters':
    case 'repeated-letters':
    case 'not-in-word-list':
      return secret ? secretErrorMessage(error, word) : errorMessage(error, word);
    case 'need-word':
      return 'Set your secret word first: the other players solve it.';
    case 'same-words':
      return "Two players set the same word, so the Rush can't start. Ask everyone to check: one of them needs to change it.";
    case 'unreachable':
      return "Can't reach the game server. Check your connection and try again.";
    case 'not-found':
      return 'No lobby has that code. Check it with whoever sent it.';
    case 'lobby-full':
      return 'This lobby is full: 5 players at most.';
    case 'already-started':
      return 'This Rush has already started without you.';
    case 'lobby-closed':
      return 'This lobby is closed.';
    case 'not-host':
      return 'Only the host can do that.';
    case 'not-in-lobby':
      return "You're not in this lobby.";
    case 'not-started':
      return "The host hasn't started the Rush yet.";
    case 'need-players':
      return 'A Rush needs at least one other player.';
    case 'bad-settings':
      return "That setting isn't one of the choices.";
    case 'game-over':
      return 'This Rush is over for you.';
    case 'not-easy':
    case 'difficulty-harder':
      return errorMessage(error, word);
    case 'no-suggestions':
      return RUSH_NO_SUGGESTIONS;
    case 'time-up':
      return "Time's up: this Rush is over.";
    case 'offensive-name':
      return "Your name can't be shown to other players. Change it on your profile to play.";
    case 'not-a-friend':
      return 'You can only invite your friends.';
    case 'account-needed':
      return 'Competitive Rush is rated, so it needs an account. Sign in from your profile to play.';
    case 'signed-out':
    case 'sign-in-needed':
      return 'You were signed out. Sign in again from your profile to play.';
    case 'code-taken':
    case 'bad-request':
    case 'bad-guest-id':
      return 'Something went wrong. Reload the page and try again.';
  }
}
