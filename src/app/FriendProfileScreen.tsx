import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  BADGES, computeAchievements, computeStats, HEAD_TO_HEAD_MODES, headToHead, initials, type HeadToHead, type HeadToHeadMode,
  type DailyPlacement, type HistoryFilter,
} from '../game';
import { Analytics } from './Analytics';
import type { ApiIdentity } from './apiIdentity';
import { Achievements } from './Badge';
import { localDay } from './badges';
import { countryName } from './countries';
import {
  friendsApi, FriendsApiError, friendsErrorMessage, loadFriendProfile, type Friend, type FriendProfile,
} from './friendsApi';
import { GameHistory, listPage } from './GameHistory';
import { toHistoryGame, type HistoryGame } from './historyDb';
import { plural } from './messages';
import { BackIcon } from './panels';

/*
 * A friend's profile (Dev Plan item 18c, README "Friends' profiles"): their
 * name and country, and their stats, achievements and game history as they
 * see them, from the server (`GET /api/friends/profile`). Their stats also
 * show your record against them, from your own games. Read-only: nothing
 * here changes their profile or yours.
 */

/** A friend's profile's subpages; with none, its hub. */
export type FriendPage = 'stats' | 'achievements' | 'history';

const FRIEND_PAGES: readonly FriendPage[] = ['stats', 'achievements', 'history'];

const PAGE_TITLE: Record<FriendPage, string> = { stats: 'Stats', achievements: 'Achievements', history: 'Game history' };

export interface LoadedFriend {
  profile: FriendProfile;
  games: HistoryGame[];
}

type Loading = { status: 'loading' } | { status: 'error'; text: string } | ({ status: 'ready' } & LoadedFriend);

/** How long a friend's loaded profile is reused, so going back from one of their games doesn't load it all again. */
const FRESH_MS = 5 * 60 * 1000;
const loaded = new Map<string, { at: number; friend: LoadedFriend }>();

/** A friend's profile and games, loaded once and kept for a few minutes. */
function useFriendProfile(apiUrl: string, identity: ApiIdentity, code: string): Loading {
  const [state, setState] = useState<Loading>(() => {
    const kept = loaded.get(code);
    return kept && Date.now() - kept.at < FRESH_MS ? { status: 'ready', ...kept.friend } : { status: 'loading' };
  });
  useEffect(() => {
    if (state.status === 'ready') return;
    let live = true;
    loadFriendProfile(friendsApi(apiUrl, identity), code).then(({ profile, games }) => {
      const friend = { profile, games: games.map(toHistoryGame).filter((g): g is HistoryGame => g !== null) };
      loaded.set(code, { at: Date.now(), friend });
      if (live) setState({ status: 'ready', ...friend });
    }, (e: unknown) => {
      const error = e instanceof FriendsApiError ? e.code : 'unreachable';
      if (!live) return;
      setState({
        status: 'error',
        text: error === 'not-found' ? "They're no longer on your friends list." : friendsErrorMessage(error),
      });
    });
    return () => {
      live = false;
    };
  }, [apiUrl, identity, code]);
  return state;
}

const HEAD_TO_HEAD_LABEL: Record<HeadToHeadMode, string> = { friend: 'Two player', lobby: 'Word Sets with friends' };

/** Your record against a friend: won–drawn–lost in each mode you've played them in. */
function YouVersus({ name, record }: { name: string; record: HeadToHead | null }) {
  const played = HEAD_TO_HEAD_MODES.filter((m) => record && record[m].wins + record[m].draws + record[m].losses > 0);
  return (
    <div class="stat-block head-to-head">
      <h4>You vs. {name}</h4>
      {!record ? <p class="field-note">Loading…</p> : played.length === 0 ? (
        <p class="field-note">You haven't played {name} yet. Your games against them appear here.</p>
      ) : (
        <dl class="stat-list">
          {played.map((m) => (
            <div class="stat-row" key={m}>
              <dt>{HEAD_TO_HEAD_LABEL[m]}</dt>
              <dd>
                {record![m].wins}–{record![m].draws}–{record![m].losses}
                <span class="stat-aside"> won–drawn–lost</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * A friend's profile, opened from your friends list: a hub with their name
 * and country and a row per section, each a subpage. `yourGames` are this
 * browser's, for your record against them.
 */
export function FriendProfileScreen({
  apiUrl, identity, friend, page, onPage, onBack, yourGames, onOpen, filter, onFilter,
}: {
  apiUrl: string;
  identity: ApiIdentity;
  friend: Friend;
  page: FriendPage | null;
  onPage: (page: FriendPage | null) => void;
  /** Leaves their profile, from the hub. */
  onBack: () => void;
  /** Every game in your history, or null while they load. */
  yourGames: HistoryGame[] | null;
  /** Opens one of their games to review, with their Daily Rush places for it. */
  onOpen: (game: HistoryGame, placements: readonly DailyPlacement[]) => void;
  /** Their history's filters, kept while you review one of their games. */
  filter: HistoryFilter;
  onFilter: (filter: HistoryFilter) => void;
}) {
  const state = useFriendProfile(apiUrl, identity, friend.code);
  const ready = state.status === 'ready' ? state : null;
  // Their current name, once loaded: the list's may be older.
  const name = ready?.profile.name ?? friend.name;
  const theirs = useMemo(() => ready?.games.map((g) => ({ id: g.entry.id, replayed: g.replayed })) ?? null, [ready]);
  const stats = useMemo(() => theirs && computeStats(theirs, Date.now()), [theirs]);
  const earned = useMemo(() => theirs && computeAchievements(theirs, localDay, ready!.profile.placements), [theirs]);
  const record = useMemo(
    () => theirs && yourGames && headToHead(yourGames.map((g) => ({ id: g.entry.id, replayed: g.replayed })), theirs),
    [theirs, yourGames]);
  const load = useMemo(() => listPage(ready?.games ?? []), [ready]);

  const open = (game: HistoryGame) => ready && onOpen(game, ready.profile.placements);

  const body = () => {
    if (state.status === 'loading') return <p class="field-note" role="status">Loading {name}'s profile…</p>;
    if (state.status === 'error') return <p class="field-note error" role="alert">{state.text}</p>;
    if (page === 'stats') {
      return (
        <Analytics stats={stats} games={state.games} onOpen={open} friend={name}>
          <YouVersus name={name} record={record} />
        </Analytics>
      );
    }
    if (page === 'achievements') return <Achievements earned={earned} fresh={new Set()} />;
    if (page === 'history') {
      return <GameHistory filter={filter} onFilter={onFilter} onOpen={open} load={load} friend={name} placements={state.profile.placements} />;
    }
    const { profile } = state;
    const summaries: Record<FriendPage, string> = {
      stats: `Their results, and yours against them`,
      achievements: `${earned?.length ?? 0} of ${BADGES.length} badges`,
      history: plural(state.games.length, 'game'),
    };
    return (
      <>
        <section class="profile-card" aria-label={name}>
          <span class="profile-badge big" aria-hidden="true">{initials(name)}</span>
          <div class="profile-who">
            <span class="profile-name-text">{name}</span>
            {profile.country && <span class="field-note">{countryName(profile.country)}</span>}
            {profile.memberSince !== null && <span class="field-note">Member since {formatDate(profile.memberSince)}</span>}
          </div>
        </section>
        <nav class="choices profile-rows" aria-label={`${name}'s profile`}>
          {FRIEND_PAGES.map((p) => (
            <button type="button" class="choice profile-row" key={p} onClick={() => onPage(p)}>
              <span class="choice-label">{PAGE_TITLE[p]}</span>
              <span class="choice-detail">{summaries[p]}</span>
            </button>
          ))}
        </nav>
      </>
    );
  };

  return (
    <div class="app profile-screen friend-profile">
      <header class="step-head">
        {page === null ? (
          <button type="button" class="icon-btn" aria-label="Back to friends" onClick={onBack}><BackIcon /></button>
        ) : (
          <button type="button" class="icon-btn" aria-label={`Back to ${name}'s profile`} onClick={() => onPage(null)}><BackIcon /></button>
        )}
        <h2>{page === null ? name : `${name} · ${PAGE_TITLE[page]}`}</h2>
      </header>
      {body()}
    </div>
  );
}
