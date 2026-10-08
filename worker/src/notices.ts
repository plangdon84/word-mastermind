import {
  isLive, lobbyKind, lobbyStandings, ordinal, otherSeat, pvpView, timeControlOf, timeControlText, type LobbyKind,
  type LobbyRecord, type LobbyStanding, type PvpGame, type Seat, type TimeControl,
} from '../../src/game';
import type { PushMessage } from './push';
import type { Room } from './room';

/*
 * The turn notifications a change to a game sends (README "Two player vs. a
 * friend", "Rush modes"): who is told, and what the notification says.
 * Nobody is told about their own move.
 */

export interface Notice {
  guestId: string;
  message: PushMessage;
}

const upper = (word: string) => word.toUpperCase();
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const count = (n: number) => `${n} ${n === 1 ? 'guess' : 'guesses'}`;

function names(room: Room): Record<Seat, string> {
  return { host: room.host.name, guest: room.guest?.name ?? 'Your friend' };
}

function guestIds(room: Room): Record<Seat, string> {
  return { host: room.host.guestId, guest: room.guest?.guestId ?? '' };
}

/** The friend accepted the host's invite. */
export function joinedNotice(room: Room, game: PvpGame): Notice[] {
  const guest = names(room).guest;
  const control = timeControlOf(game);
  const body = game.first === 'host'
    ? isLive(control) ? 'You go first, and your clock is running.' : `You go first. You have ${days(game.turnDays ?? 1)} to guess.`
    : `${guest} goes first.`;
  const title = room.matched ? `Matched with ${guest}` : `${guest} accepted your invite`;
  return [{ guestId: room.host.guestId, message: { title, body, gameId: room.id } }];
}

/** "1 hour" or "24 hours": how long the room's invite was open. */
const inviteTime = (room: Room) => (isLive(room.timeControl ?? '1d') ? '1 hour' : '24 hours');

/** What the host sent: a rematch, a challenge to one friend, or an invite link. */
const inviteKind = (room: Room) => (room.rematchOf ? 'rematch' : room.invitee ? 'challenge' : 'invite');

/** Nobody accepted the host's invite in time. */
export function expiredNotice(room: Room): Notice[] {
  const who = room.invitee ? `${room.invitee.name} didn't accept` : 'Nobody accepted';
  return [{
    guestId: room.host.guestId,
    message: {
      title: `Your ${inviteKind(room)} expired`,
      body: `${who} it within ${inviteTime(room)}. Send a new one to play.`,
      gameId: room.id,
    },
  }];
}

/** The friend a challenge or rematch was for turned it down. */
export function declinedNotice(room: Room): Notice[] {
  const who = room.invitee?.name ?? 'Your friend';
  return [{
    guestId: room.host.guestId,
    message: { title: `${who} declined your ${inviteKind(room)}`, body: 'Maybe another time.', gameId: room.id },
  }];
}

/**
 * Whatever the game's last move means for each player who didn't make it. In
 * a live game both players are watching, so only the end is told, not each
 * guess.
 */
export function moveNotices(room: Room, game: PvpGame): Notice[] {
  const move = game.moves[game.moves.length - 1];
  if (!move || move.kind === 'difficulty' || move.kind === 'suggest') return [];
  if (move.kind === 'guess' && isLive(timeControlOf(game))) return [];
  const name = names(room);
  const ids = guestIds(room);
  const notice = (seat: Seat, title: string, body: string): Notice =>
    ({ guestId: ids[seat], message: { title, body, gameId: room.id } });
  const mover = move.seat;
  const other = otherSeat(mover);

  if (move.kind === 'concede') return [notice(other, `${name[mover]} gave up`, 'You win!')];
  if (move.kind === 'timeout') {
    return [
      notice(other, `${name[mover]} ran out of time`, 'You win!'),
      notice(mover, `You ran out of time against ${name[other]}`, `${name[other]} wins.`),
    ];
  }

  // A guess: tell the other player what it means for them.
  const view = pvpView(game, other);
  const guess = game.guesses[mover][game.guesses[mover].length - 1];
  const yourWord = upper(game.secrets[other]);
  if (view.outcome) {
    if (view.outcome.result === 'draw') {
      return [notice(other, `${name[mover]} tied it`, `${name[mover]} found ${yourWord} with their last guess. It's a draw.`)];
    }
    if (view.outcome.result === 'won') {
      return [notice(other, `You beat ${name[mover]}`, `Their last guess, ${upper(guess.guess)}, missed. You win!`)];
    }
    return [notice(other, `${name[mover]} found your word`,
      `${name[mover]} found ${yourWord} in ${count(game.guesses[mover].length)}. You lose.`)];
  }
  if (view.status === 'final-guess') {
    return [notice(other, `Last chance against ${name[mover]}`,
      `${name[mover]} found ${yourWord}. One guess to tie the game.`)];
  }
  return [notice(other, `Your turn against ${name[mover]}`,
    `${name[mover]} guessed ${upper(guess.guess)} – ${guess.score}. You have ${days(game.turnDays ?? 1)} to reply.`)];
}

/** The mode's name, for a lobby's notifications. */
const MODE_NAME: Record<LobbyKind, string> = { friends: 'Rush with Friends', competitive: 'Competitive Rush' };

/** A Rush with Friends or Competitive Rush notification: tapping it opens the lobby, and a newer one replaces it. */
const lobbyMessage = (lobby: LobbyRecord, title: string, body: string) =>
  ({ title, body, gameId: `lobby-${lobby.code}`, url: `/?lobby=${lobby.code}` });

const score = (s: LobbyStanding) => (s.score ?? 0).toFixed(1);

/** The people in the lobby, by seat: computers get no notifications. */
const people = (lobby: LobbyRecord) => lobby.game?.seats.filter((s) => s.strength === null) ?? [];

/** A player finished (found or gave up every word) while others are still playing. */
export function lobbyFinishedNotice(lobby: LobbyRecord, seatId: string, now: number): Notice[] {
  const { game } = lobby;
  if (!game) return [];
  const finisher = game.seats.find((s) => s.id === seatId);
  if (!finisher) return [];
  const theirs = lobbyStandings(game, now, [seatId]).find((s) => s.you)!;
  return people(lobby).filter((p) => p.id !== seatId).map((p) => {
    const yours = lobbyStandings(game, now, [p.id]).find((s) => s.you)!;
    const found = theirs.words.filter((w) => w.outcome === 'solved').length;
    const you = yours.rank === null ? ' Keep going!' : ` You're ${ordinal(yours.rank)} so far.`;
    return {
      guestId: p.id,
      message: lobbyMessage(lobby, `${finisher.name} finished the Rush`,
        `Score ${score(theirs)}, with ${found} of ${theirs.words.length} words found.${you}`),
    };
  });
}

/** The game is over: everyone's final place. */
export function lobbyOverNotice(lobby: LobbyRecord, now: number): Notice[] {
  const { game } = lobby;
  if (!game) return [];
  return people(lobby).map((p) => {
    const standings = lobbyStandings(game, now, [p.id]);
    const yours = standings.find((s) => s.you)!;
    const winners = standings.filter((s) => s.rank === 1);
    const tied = standings.filter((s) => s.rank === yours.rank).length > 1;
    if (yours.rank === 1) {
      const next = standings.find((s) => s.rank !== 1);
      return {
        guestId: p.id,
        message: lobbyMessage(lobby, tied ? 'You tied for first in the Rush!' : `You won the ${MODE_NAME[lobbyKind(lobby)]}!`,
          `Your score: ${score(yours)}.${next ? ` ${next.name} came ${ordinal(next.rank!)} with ${score(next)}.` : ''}`),
      };
    }
    const place = `${tied ? 'tied ' : ''}${ordinal(yours.rank!)} of ${standings.length}`;
    return {
      guestId: p.id,
      message: lobbyMessage(lobby, `The Rush is over: you came ${place}`,
        `${winners.map((w) => w.name).join(' and ')} won with ${score(winners[0])}. Your score: ${score(yours)}.`),
    };
  });
}

/** Friend notices open the profile's friends list, and a newer one replaces an older one. */
const friendsMessage = (title: string, body: string) => ({ title, body, gameId: 'friends', url: '/?friends' });

/** Someone sent you a friend request. */
export const friendRequestNotice = (to: string, from: string): Notice =>
  ({ guestId: to, message: friendsMessage(`${from} wants to be friends`, 'Open your friends list to accept.') });

/** Someone accepted your friend request. */
export const friendAcceptedNotice = (to: string, from: string): Notice =>
  ({ guestId: to, message: friendsMessage(`${from} accepted your friend request`, 'Challenge them from your friends list.') });

/** A friend challenged you to a game: tapping it opens the challenge. */
export const challengeNotice = (to: string, hostName: string, control: TimeControl, gameId: string, rated = false): Notice => ({
  guestId: to,
  message: {
    title: `${hostName} challenges you${rated ? ' to a rated game' : ''}`,
    body: `${isLive(control) ? `Live, ${timeControlText(control)}` : timeControlText(control)}. Tap to choose your word.`,
    gameId,
  },
});

/** Your last opponent asked for a rematch: tapping it opens it. */
export const rematchNotice = (to: string, hostName: string, control: TimeControl, gameId: string, rated = false): Notice => ({
  guestId: to,
  message: {
    title: `${hostName} wants a rematch${rated ? ' (rated)' : ''}`,
    body: `${isLive(control) ? `Live, ${timeControlText(control)}` : timeControlText(control)}. Tap to choose your word.`,
    gameId,
  },
});

/** A friend invited you to their Rush with Friends or Competitive Rush lobby: tapping it opens the lobby. */
export const lobbyInviteNotice = (to: string, hostName: string, code: string, kind: LobbyKind = 'friends'): Notice => ({
  guestId: to,
  message: {
    title: `${hostName} invited you to a ${MODE_NAME[kind]}`, body: 'Tap to join the lobby.',
    gameId: `lobby-${code}`, url: `/?lobby=${code}`,
  },
});
