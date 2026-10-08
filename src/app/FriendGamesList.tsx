import { useEffect, useMemo, useState } from 'preact/hooks';
import { friendApi, FriendApiError, opponentName, type FriendGame } from './friendApi';
import { loadFriendGames, updateFriendGame } from './friendGames';
import { durationText, timeLeftText } from './messages';
import type { ApiIdentity } from './apiIdentity';
import { useFriendsList } from './FriendsSection';
import type { LobbyInvite } from './friendsApi';

type Row = { id: string; game: FriendGame | null; failed: boolean };

/** What a row says about a game: whose turn, or what it's waiting for. */
function describe(game: FriendGame, now: number): string {
  const opponent = opponentName(game) ?? 'a friend';
  if (game.state === 'waiting') {
    const left = game.expiresAt === null ? '' : durationText(game.expiresAt - now);
    // A friend's challenge to you, waiting for your word.
    if (!game.seat) return `Tap to choose your word${left && ` · expires in ${left}`}`;
    if (game.inviteeName) return `Waiting for ${game.inviteeName} to accept${left && ` · expires in ${left}`}`;
    return `Waiting for a friend to accept${left && ` · link expires in ${left}`}`;
  }
  const kind = game.rematchOf ? 'Rematch' : game.inviteeName ? 'Challenge' : 'Invite';
  if (game.state === 'cancelled') return `${kind} cancelled.`;
  if (game.state === 'expired') {
    return `${kind} expired: ${!game.seat ? "you didn't accept it" : game.inviteeName ? `${game.inviteeName} didn't accept it` : 'nobody accepted it'} in time.`;
  }
  if (game.state === 'declined') return game.seat ? `${game.inviteeName ?? 'Your friend'} declined.` : 'You declined.';
  const view = game.view;
  if (!view) return '';
  if (game.state === 'over') {
    const result = view.outcome?.result;
    return result === 'won' ? `You beat ${opponent}.` : result === 'draw' ? `Draw with ${opponent}.` : `${opponent} won.`;
  }
  const left = view.deadline === null ? '' : timeLeftText(view.deadline - now);
  // Your turn is the tag beside the name.
  return view.turn === 'you' ? left : `${opponent}'s turn · ${left}`;
}

/** One of your games against a friend, as the title screen lists it: loaded from the server, or still loading. */
export type FriendGameRow = Row;

/** Whether a game against a friend waits on you: your turn, or a challenge to you. */
export const friendGameWaits = (game: FriendGame | null): boolean =>
  (game?.state === 'playing' && game.view?.turn === 'you') || (game?.state === 'waiting' && !game.seat);

/**
 * Your games against a friend that you haven't finished looking at, each
 * loaded from the server, those waiting on you first.
 */
export function useFriendGames(apiUrl: string | null, identity: ApiIdentity): FriendGameRow[] {
  const api = useMemo(() => (apiUrl ? friendApi(apiUrl, identity) : null), [apiUrl, identity]);
  const [rows, setRows] = useState<Row[]>(() =>
    (apiUrl ? loadFriendGames().filter((e) => !e.done) : []).map((e) => ({ id: e.id, game: null, failed: false })));

  useEffect(() => {
    if (!api) return;
    let live = true;
    for (const { id } of rows) {
      api.get(id).then(
        (game) => {
          // A challenge to you that closed without your joining (you declined it, or it expired) leaves the list.
          if (!game.seat && game.state !== 'waiting') {
            updateFriendGame(id, { done: true });
            if (live) setRows((all) => all.filter((r) => r.id !== id));
          } else if (live) setRows((all) => all.map((r) => (r.id === id ? { ...r, game } : r)));
        },
        (e: unknown) => {
          // A game the server no longer has, or that's no longer yours (a deleted account's), leaves the list.
          if (e instanceof FriendApiError && (e.code === 'not-found' || e.code === 'not-a-player')) {
            updateFriendGame(id, { done: true });
            if (live) setRows((all) => all.filter((r) => r.id !== id));
          } else if (live) {
            setRows((all) => all.map((r) => (r.id === id ? { ...r, failed: true } : r)));
          }
        },
      );
    }
    return () => {
      live = false;
    };
  }, [api]);

  return [...rows].sort((a, b) => Number(friendGameWaits(b.game)) - Number(friendGameWaits(a.game)));
}

/** A row for one of your games against a friend. */
export function FriendGameButton({ row: { id, game, failed }, onOpen }: { row: FriendGameRow; onOpen: (id: string) => void }) {
  return (
    <button type="button" class="choice" onClick={() => onOpen(id)}>
      <span class="choice-label">
        <span class="choice-name">
          {!game ? (failed ? 'A game with a friend' : 'Loading…')
            : game.state === 'waiting' ? (!game.seat ? `${game.hostName} ${game.rematchOf ? 'wants a rematch' : 'challenges you'}`
              : game.inviteeName ? `${game.rematchOf ? 'Rematch' : 'Challenge'} sent to ${game.inviteeName}` : 'Invite sent')
              : `vs. ${opponentName(game) ?? 'a friend'}`}
        </span>
        {friendGameWaits(game) && <span class="tag yours">Your turn</span>}
      </span>
      <span class="choice-detail">{game ? describe(game, Date.now()) : failed ? "Couldn't reach the server. Tap to try again." : ''}</span>
    </button>
  );
}

/** Friends' invites to their Rush with Friends or Competitive Rush lobbies (signed in), each opening the lobby to join. */
export function useLobbyInvites(apiUrl: string | null, identity: ApiIdentity): LobbyInvite[] {
  const [list] = useFriendsList(apiUrl, identity);
  return list?.lobbyInvites ?? [];
}

/** A row for a friend's invite to their lobby. */
export function LobbyInviteButton({ invite, onOpen }: { invite: LobbyInvite; onOpen: (code: string) => void }) {
  return (
    <button type="button" class="choice" onClick={() => onOpen(invite.code)}>
      <span class="choice-label">
        <span class="choice-name">{invite.fromName}'s Rush lobby</span>
        <span class="tag yours">Join</span>
      </span>
      <span class="choice-detail">You're invited. Tap to see the lobby and join.</span>
    </button>
  );
}
