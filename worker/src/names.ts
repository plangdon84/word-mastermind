import { validateName, type LobbyRecord } from '../../src/game';

/*
 * Names shown to other players (Dev Plan item 19n, README "Leaderboards"):
 * a stored name passed the profanity filter when it was saved, but the
 * filter can grow since, so every name the server writes out to others is
 * checked again here. One rule everywhere: a name it now refuses shows as
 * no name (`NO_NAME`), never as an older name of the player's.
 */

/** Shown for a player with no name to show: none sent yet, or one the profanity filter now refuses. */
export const NO_NAME = 'A player';

/** A stored name as others may see it now: itself if the name rule and profanity filter still take it, else null. */
export function checkedName(name: string | null | undefined): string | null {
  if (name === null || name === undefined) return null;
  const shown = validateName(name);
  return shown.ok ? shown.name : null;
}

/** A stored name as others see it now, `NO_NAME` for none or one the filter now refuses. */
export const shownName = (name: string | null | undefined): string => checkedName(name) ?? NO_NAME;

/**
 * A lobby with every player's name as others see it now (Dev Plan item
 * 19v): the names it keeps are the ones they joined under, checked then,
 * so a name the profanity filter now refuses shows as `NO_NAME` on the
 * lobby's screen, its results, its notifications and the history entries
 * built from it. Computers keep theirs.
 */
export function checkedLobby(lobby: LobbyRecord): LobbyRecord {
  const { game } = lobby;
  return {
    ...lobby,
    players: lobby.players.map((p) => ({ ...p, name: shownName(p.name) })),
    ...(game ? { game: { ...game, seats: game.seats.map((s) => (s.strength === null ? { ...s, name: shownName(s.name) } : s)) } } : {}),
  };
}
