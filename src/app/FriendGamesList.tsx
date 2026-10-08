import { useEffect, useMemo, useState } from 'preact/hooks';
import { friendApi, FriendApiError, opponentName, type FriendGame } from './friendApi';
import { loadFriendGames, updateFriendGame } from './friendGames';
import { durationText, timeLeftText } from './messages';
import type { ApiIdentity } from './apiIdentity';
import { useFriendsList } from './FriendsSection';

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

/**
 * The title screen's list of your games against a friend that you haven't
 * finished looking at, each loaded from the server.
 */
export function FriendGamesList({ apiUrl, identity, onOpen }: {
  apiUrl: string;
  identity: ApiIdentity;
  onOpen: (id: string) => void;
}) {
  const api = useMemo(() => friendApi(apiUrl, identity), [apiUrl, identity]);
  const [rows, setRows] = useState<Row[]>(() =>
    loadFriendGames().filter((e) => !e.done).map((e) => ({ id: e.id, game: null, failed: false })));

  useEffect(() => {
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

  if (rows.length === 0) return null;
  // Games waiting on you first.
  const yours = (g: FriendGame | null) => g?.view?.turn === 'you' || (g?.state === 'waiting' && !g.seat);
  const sorted = [...rows].sort((a, b) => Number(yours(b.game)) - Number(yours(a.game)));
  return (
    <section class="friend-games" aria-label="Your online games">
      <h2 class="info-label">Online games</h2>
      {sorted.map(({ id, game, failed }) => (
        <button type="button" class="choice" key={id} onClick={() => onOpen(id)}>
          <span class="choice-label">
            <span class="choice-name">
              {!game ? (failed ? 'A game with a friend' : 'Loading…')
                : game.state === 'waiting' ? (!game.seat ? `${game.hostName} ${game.rematchOf ? 'wants a rematch' : 'challenges you'}`
                  : game.inviteeName ? `${game.rematchOf ? 'Rematch' : 'Challenge'} sent to ${game.inviteeName}` : 'Invite sent')
                  : `vs. ${opponentName(game) ?? 'a friend'}`}
            </span>
            {((game?.view?.turn === 'you' && game.state === 'playing') || (game?.state === 'waiting' && !game.seat))
              && <span class="tag yours">Your turn</span>}
          </span>
          <span class="choice-detail">{game ? describe(game, Date.now()) : failed ? "Couldn't reach the server. Tap to try again." : ''}</span>
        </button>
      ))}
    </section>
  );
}

/** Friends' invites to their Rush with Friends or Competitive Rush lobbies (signed in), each opening the lobby to join. */
export function LobbyInvitesList({ apiUrl, identity, onOpen }: {
  apiUrl: string;
  identity: ApiIdentity;
  onOpen: (code: string) => void;
}) {
  const [list] = useFriendsList(apiUrl, identity);
  if (!list || list.lobbyInvites.length === 0) return null;
  return (
    <section class="friend-games" aria-label="Rush invites from friends">
      <h2 class="info-label">Rush invites</h2>
      {list.lobbyInvites.map((invite) => (
        <button type="button" class="choice" key={invite.code} onClick={() => onOpen(invite.code)}>
          <span class="choice-label">
            <span class="choice-name">{invite.fromName}'s Rush lobby</span>
            <span class="tag yours">Join</span>
          </span>
          <span class="choice-detail">You're invited. Tap to see the lobby and join.</span>
        </button>
      ))}
    </section>
  );
}
