import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  BADGES, HEAD_TO_HEAD_MODES, initials, type HeadToHead, type HeadToHeadMode, type DailyPlacement, type HistoryEntry,
  type HistoryFilter,
} from '../game';
import { Analytics } from './Analytics';
import type { ApiIdentity } from './apiIdentity';
import { Achievements } from './Badge';
import { countryName } from './countries';
import {
  friendsApi, FriendsApiError, friendsErrorMessage, loadFriendProfile, type Friend, type FriendProfile, type FriendSummary,
} from './friendsApi';
import { GameHistory } from './GameHistory';
import { toHistoryGame, type HistoryGame, type HistoryPage } from './historyDb';
import { plural } from './messages';
import { BackIcon } from './panels';

/*
 * A friend's profile (Dev Plan item 18c, README "Friends' profiles"): their
 * name and country, and their stats, achievements and game history as they
 * see them, from the server. The server keeps their stats, badges and your
 * record against them worked out (item 18cb, `GET /api/friends/profile`),
 * and their history loads a page at a time as you scroll
 * (`GET /api/friends/profile/games`). Read-only: nothing here changes their
 * profile or yours.
 */

/** A friend's profile's subpages; with none, its hub. */
export type FriendPage = 'stats' | 'achievements' | 'history';

const FRIEND_PAGES: readonly FriendPage[] = ['stats', 'achievements', 'history'];

const PAGE_TITLE: Record<FriendPage, string> = { stats: 'Stats', achievements: 'Achievements', history: 'Game history' };

export interface LoadedFriend {
  profile: FriendProfile;
  summary: FriendSummary;
  /** The games their stats point at, to open from the stats. */
  featured: HistoryGame[];
}

const toHistoryGames = (entries: readonly HistoryEntry[]) =>
  entries.map(toHistoryGame).filter((g): g is HistoryGame => g !== null);

type Loading = { status: 'loading' } | { status: 'error'; text: string } | ({ status: 'ready' } & LoadedFriend);

/** How long a friend's loaded profile is reused, so going back from one of their games doesn't load it all again. */
const FRESH_MS = 5 * 60 * 1000;
/** Kept by session and friend code: signing out (a new session) or opening the friends list starts afresh. */
const loaded = new Map<string, { at: number; friend: LoadedFriend }>();

/** Forgets every friend's profile: the friends list calls it, as a friend may have been removed. */
export const forgetFriendProfiles = () => loaded.clear();

/** A friend's profile and summary, loaded once and kept for a few minutes. `attempt` changes to try again. */
function useFriendProfile(apiUrl: string, identity: ApiIdentity, code: string, attempt: number): Loading {
  const key = `${identity.token ?? ''}:${code}`;
  const [state, setState] = useState<Loading>(() => {
    const kept = loaded.get(key);
    return kept && Date.now() - kept.at < FRESH_MS ? { status: 'ready', ...kept.friend } : { status: 'loading' };
  });
  useEffect(() => {
    if (state.status === 'ready') return;
    setState({ status: 'loading' });
    let live = true;
    loadFriendProfile(friendsApi(apiUrl, identity), code).then(({ profile, summary }) => {
      const friend = { profile, summary, featured: toHistoryGames(summary.featured) };
      loaded.set(key, { at: Date.now(), friend });
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
  }, [apiUrl, identity, code, attempt]);
  // Their stats show first; your record against them follows once the server has copied your own games.
  const waiting = state.status === 'ready' && state.summary.versus === null;
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    loadFriendProfile(friendsApi(apiUrl, identity), code, true).then(({ profile, summary }) => {
      const friend = { profile, summary, featured: toHistoryGames(summary.featured) };
      loaded.set(key, { at: Date.now(), friend });
      if (live) setState({ status: 'ready', ...friend });
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [waiting, apiUrl, identity, code]);
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
 * A friend's profile, opened from your friends list (or their name in a game,
 * a lobby's results or a board, item 18ca): a hub with their name
 * and country and a row per section, each a subpage.
 */
export function FriendProfileScreen({
  apiUrl, identity, friend, page, onPage, onBack, backTo = 'friends', onOpen, filter, onFilter,
}: {
  apiUrl: string;
  identity: ApiIdentity;
  friend: Friend;
  page: FriendPage | null;
  onPage: (page: FriendPage | null) => void;
  /** Leaves their profile, from the hub. */
  onBack: () => void;
  /** Where the hub's Back goes: your friends list, or the game, lobby or board their name was tapped on (item 18ca). */
  backTo?: 'friends' | 'back';
  /** Opens one of their games to review, with their current name and their Daily Rush places for it. */
  onOpen: (game: HistoryGame, name: string, placements: readonly DailyPlacement[]) => void;
  /** Their history's filters, kept while you review one of their games. */
  filter: HistoryFilter;
  onFilter: (filter: HistoryFilter) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const backButton = useRef<HTMLButtonElement>(null);
  // Opened over a screen, it takes focus from the name tapped, which it hides.
  useEffect(() => {
    if (backTo === 'back') backButton.current?.focus({ preventScroll: true });
  }, []);
  const state = useFriendProfile(apiUrl, identity, friend.code, attempt);
  const ready = state.status === 'ready' ? state : null;
  // Their current name, once loaded: the list's may be older.
  const name = ready?.profile.name ?? friend.name;
  const load = useMemo(() => {
    const api = friendsApi(apiUrl, identity);
    return async (filter: HistoryFilter, offset: number, limit: number): Promise<HistoryPage> => {
      const page = await api.profileGames(friend.code, { filter, offset, limit });
      return { games: toHistoryGames(page.games), next: page.next };
    };
  }, [apiUrl, identity, friend.code]);

  const open = (game: HistoryGame) => ready && onOpen(game, ready.profile.name, ready.profile.placements);

  const body = () => {
    if (state.status === 'loading') return <p class="field-note" role="status">Loading {name}'s profile…</p>;
    if (state.status === 'error') {
      return (
        <>
          <p class="field-note error" role="alert">{state.text}</p>
          <div class="row-btns start"><button type="button" class="btn" onClick={() => setAttempt((a) => a + 1)}>Try again</button></div>
        </>
      );
    }
    if (page === 'stats') {
      return (
        <Analytics stats={state.summary.stats} games={state.featured} onOpen={open} friend={name}>
          <YouVersus name={name} record={state.summary.versus} />
        </Analytics>
      );
    }
    if (page === 'achievements') return <Achievements earned={state.summary.badges} fresh={new Set()} />;
    if (page === 'history') {
      return <GameHistory filter={filter} onFilter={onFilter} onOpen={open} load={load} friend={name} placements={state.profile.placements} />;
    }
    const { profile } = state;
    const summaries: Record<FriendPage, string> = {
      stats: `Their results, and yours against them`,
      achievements: `${state.summary.badges.length} of ${BADGES.length} badges`,
      history: plural(state.summary.games, 'game'),
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
          <button type="button" class="icon-btn" aria-label={backTo === 'friends' ? 'Back to friends' : 'Back'} onClick={onBack}
            ref={backButton}>
            <BackIcon />
          </button>
        ) : (
          <button type="button" class="icon-btn" aria-label={`Back to ${name}'s profile`} onClick={() => onPage(null)}><BackIcon /></button>
        )}
        <h2>{page === null ? name : `${name} · ${PAGE_TITLE[page]}`}</h2>
      </header>
      {body()}
    </div>
  );
}
