import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ApiIdentity } from './apiIdentity';
import { countryName } from './countries';
import { forgetFriendProfiles } from './FriendProfileScreen';
import { isPhone, ShareIcon } from './friendParts';
import { smsLink } from './friendGames';
import {
  formatFriendCode, friendMessage, friendsApi, FriendsApiError, friendsErrorMessage, inviteLink, normalizeFriendCode,
  normalizeSearch, SEARCH_MIN, type FoundPlayer, type Friend, type FriendsApi, type FriendsList,
} from './friendsApi';
import { shareLink } from './share';

type Notice = { text: string; error: boolean };

/**
 * Your friends list from the server, loaded once `identity` is signed in,
 * and again whenever you come back to the page. Null until it arrives, or
 * without a session.
 */
export function useFriendsList(apiUrl: string | null, identity: ApiIdentity): [FriendsList | null, (list: FriendsList) => void] {
  const [list, setListState] = useState<FriendsList | null>(null);
  /** Bumped by each change's answer, so a look that set out before it can't put back the older list. */
  const changes = useRef(0);
  const setList = (next: FriendsList) => {
    changes.current++;
    setListState(next);
  };
  useEffect(() => {
    if (!apiUrl || !identity.token) {
      setListState(null);
      return;
    }
    let live = true;
    const api = friendsApi(apiUrl, identity);
    const look = () => {
      const before = changes.current;
      void api.list().then((l) => live && changes.current === before && setListState(l), () => {});
    };
    look();
    const onVisible = () => {
      if (document.visibilityState === 'visible') look();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [apiUrl, identity]);
  return [list, setList];
}

/**
 * Your private invite link, with Copy and Share (whoever opens it becomes
 * your friend at once) and Reset, then your public friend code, which sends
 * a request instead.
 */
function YourCode({ code, invite, name, busy, onReset }: {
  code: string;
  /** Null from a server older than invite links: only the code is shown. */
  invite: string | null;
  name: string;
  busy: boolean;
  onReset: () => void;
}) {
  const link = invite ? inviteLink(location.origin, invite) : '';
  const message = friendMessage(name);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => setCopied(false), [invite]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      field.current?.select();
    }
  };
  return (
    <div class="friend-code">
      {invite && (
        <>
          <span class="info-label">Your invite link</span>
          <label class="visually-hidden" for="friend-link">Your invite link</label>
          <input id="friend-link" class="invite-link" ref={field} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <span class="field-note">Whoever opens it becomes your friend straight away, so share it only with friends.</span>
          <div class="row-btns start">
            <button class="btn small" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
            {'share' in navigator ? (
              <button class="btn small share" type="button"
                onClick={() => shareLink({ title: 'Word Mastermind', text: message, url: link })}>
                <ShareIcon />Share
              </button>
            ) : isPhone() && <a class="btn small share" href={smsLink(message, link)}><ShareIcon />Text it</a>}
            {!resetting && <button class="btn small" type="button" onClick={() => setResetting(true)}>Reset link</button>}
          </div>
          {resetting && (
            <div class="panel inline">
              <p>Make a new link? Links you've already shared stop working. Friends you've made stay friends.</p>
              <div class="row-btns">
                <button type="button" class="btn small primary" disabled={busy} onClick={() => {
                  setResetting(false);
                  onReset();
                }}>New link</button>
                <button type="button" class="btn small" onClick={() => setResetting(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
      <span class="info-label">Your friend code</span>
      <p class="lobby-code">{formatFriendCode(code)}</p>
      <span class="field-note">Someone who types it in sends you a friend request to accept.</span>
    </div>
  );
}

/** Typed into Find a friend: an email (it has an @ and a dot after it), else a name. */
const looksLikeEmail = (typed: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed.trim());

/**
 * The profile's Friends section (README "Friends"): finding a friend by
 * name or email (Dev Plan item 18d), your friend code, adding
 * a friend by theirs, requests to answer, and your friends, each with
 * Challenge. Friends are accounts, so it asks you to sign in first.
 */
export function FriendsSection({
  apiUrl, identity, name, addCode, invite, findByName, onFindByName, onInviteDone, onSignIn, onChallenge, onOpenFriend,
}: {
  apiUrl: string;
  identity: ApiIdentity;
  /** Your display name, for the message sent with your link. */
  name: string;
  /** A friend code from a link (`?friend=…`), ready to add. */
  addCode: string | null;
  /** A friend's private invite (`?invite=…`), accepted once you're signed in. */
  invite: string | null;
  /** The synced setting Let players find me by name. */
  findByName: boolean;
  onFindByName: (findable: boolean) => void;
  /** The invite was accepted, or can't be: it's forgotten. */
  onInviteDone: () => void;
  /** Opens the profile's Account page. */
  onSignIn: () => void;
  onChallenge: (friend: Friend) => void;
  /** Opens a friend's profile (Dev Plan item 18c): tapping their name. */
  onOpenFriend: (friend: Friend) => void;
}) {
  const signedIn = identity.token !== null;
  // A friend removed here, or elsewhere, mustn't still show from a profile kept a few minutes.
  useEffect(forgetFriendProfiles, []);
  const api: FriendsApi = useMemo(() => friendsApi(apiUrl, identity), [apiUrl, identity]);
  const [list, setList] = useFriendsList(apiUrl, identity);
  const [typed, setTyped] = useState(addCode ? formatFriendCode(addCode) : '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [findTyped, setFindTyped] = useState('');
  /** The last search's players, or null before one. */
  const [found, setFound] = useState<FoundPlayer[] | null>(null);
  /** What Find a friend last said: a search's or a request's outcome. */
  const [findNotice, setFindNotice] = useState<Notice | null>(null);

  const change = async (call: () => Promise<FriendsList>, done: (list: FriendsList) => string | null) => {
    setBusy(true);
    setNotice(null);
    try {
      const next = await call();
      setList(next);
      const text = done(next);
      if (text) setNotice({ text, error: false });
    } catch (e) {
      setNotice({ text: friendsErrorMessage(e instanceof FriendsApiError ? e.code : 'unreachable'), error: true });
    } finally {
      setBusy(false);
    }
  };

  /**
   * A friend's invite link: once you're signed in, it asks "Add Ann as a
   * friend?" (so a link passed off as something else, or left on a shared
   * computer, can't add anyone unasked), and Add makes you friends at once.
   */
  const [offer, setOffer] = useState<{ name: string } | null>(null);
  const inviteFailed = (e: unknown) => {
    const error = e instanceof FriendsApiError ? e : new FriendsApiError('unreachable', 0);
    const code = error.code;
    setNotice({
      text: friendsErrorMessage(code === 'not-found' ? 'invite-gone' : code === 'own-code' ? 'own-invite' : code), error: true,
    });
    // Kept to try again after a lost connection, a busy server or being signed out; anything else won't change.
    const passing = code === 'unreachable' || code === 'signed-out' || code === 'sign-in-needed' || error.status === 429
      || error.status >= 500;
    if (!passing) onInviteDone();
  };
  const looking = useRef(false);
  useEffect(() => {
    if (!signedIn || !invite || looking.current) return;
    looking.current = true;
    api.peekInvite(invite).then(setOffer, inviteFailed).finally(() => {
      looking.current = false;
    });
  }, [signedIn, invite, api]);
  const acceptOffer = () => {
    if (!invite) return;
    setBusy(true);
    setNotice(null);
    api.acceptInvite(invite).then(({ list: next, friend }) => {
      setList(next);
      setOffer(null);
      setNotice({ text: friend ? `You and ${friend.name} are friends.` : 'You are friends now.', error: false });
      onInviteDone();
    }, (e) => {
      setOffer(null);
      inviteFailed(e);
    }).finally(() => setBusy(false));
  };
  const declineOffer = () => {
    setOffer(null);
    onInviteDone();
  };

  const find = (e: Event) => {
    e.preventDefault();
    const typed = findTyped.trim();
    setFound(null);
    setFindNotice(null);
    const failed = (error: unknown) => setFindNotice({
      text: friendsErrorMessage(error instanceof FriendsApiError ? error.code : 'unreachable'), error: true,
    });
    if (looksLikeEmail(typed)) {
      setBusy(true);
      api.requestByEmail(typed).then(() => {
        setFindTyped('');
        // The same words whether or not anyone has that email: the server never says.
        setFindNotice({
          text: "If they have a wordmastermind.app account, they'll get your request. They'll be on your list once they accept.",
          error: false,
        });
      }, failed).finally(() => setBusy(false));
      return;
    }
    const search = normalizeSearch(typed);
    if (!search) {
      setFindNotice({ text: `Type at least ${SEARCH_MIN} letters of their name, or their email.`, error: true });
      return;
    }
    setBusy(true);
    api.search(search).then((players) => {
      setFound(players);
      if (players.length === 0) {
        setFindNotice({ text: `Nobody called “${search}” found. Try their email or friend code instead.`, error: false });
      }
    }, failed).finally(() => setBusy(false));
  };

  /** A found player's request sent (or theirs accepted): their row shows where you stand now. */
  const addFound = (player: FoundPlayer) => void change(() => api.add(player.code), (next) => {
    const state = next.friends.some((f) => f.code === player.code) ? 'friends' : 'sent';
    setFound((players) => players?.map((p) => (p.code === player.code ? { ...p, state } : p)) ?? null);
    return state === 'friends' ? `You and ${player.name} are friends.`
      : `Friend request sent to ${player.name}. They'll be on your list once they accept.`;
  });

  const add = (e: Event) => {
    e.preventDefault();
    const code = normalizeFriendCode(typed);
    if (!code) {
      setNotice({ text: 'A friend code is 8 letters and digits, like ABCD-2345.', error: true });
      return;
    }
    void change(() => api.add(code), (next) => {
      setTyped('');
      const friend = next.friends.find((f) => f.code === code);
      if (friend) return `You and ${friend.name} are friends.`;
      const sent = next.sent.find((f) => f.code === code);
      return sent ? `Friend request sent to ${sent.name}. They'll be on your list once they accept.` : null;
    });
  };

  if (!signedIn) {
    return (
      <section class="profile-section" aria-label="Friends">
        <p class="field-note">
          {invite ? "Sign in to answer your friend's invite"
            : addCode ? `Sign in to add ${formatFriendCode(addCode)} as a friend` : 'Sign in to add friends'}, then
          challenge them to a game or invite them to a Word Set with friends from here.
        </p>
        <div class="row-btns start"><button type="button" class="btn primary" onClick={onSignIn}>Sign in</button></div>
      </section>
    );
  }

  const row = (friend: Friend, buttons: ComponentChildren, open = false) => (
    <li key={friend.code}>
      {open ? (
        <button type="button" class="link-btn lobby-name friend-name" aria-label={`${friend.name}'s profile`}
          onClick={() => onOpenFriend(friend)}>{friend.name}</button>
      ) : <span class="lobby-name">{friend.name}</span>}
      <span class="friend-btns">{buttons}</span>
    </li>
  );

  return (
    <section class="profile-section" aria-label="Friends">
      {!list ? <p class="field-note">Loading…</p> : (
        <>
          {offer && invite && (
            <div class="panel inline" role="status">
              <h2>Add {offer.name} as a friend?</h2>
              <p>They sent you their invite link. Friends can challenge each other and invite each other to a Word Set.</p>
              <div class="row-btns">
                <button type="button" class="btn primary" disabled={busy} onClick={acceptOffer}>Add</button>
                <button type="button" class="btn" disabled={busy} onClick={declineOffer}>No thanks</button>
              </div>
            </div>
          )}
          {list.received.length > 0 && (
            <>
              <span class="info-label">Friend requests</span>
              <ul class="friend-list">
                {list.received.map((f) => row(f, (
                  <>
                    <button type="button" class="btn small primary" disabled={busy}
                      onClick={() => void change(() => api.add(f.code), () => `You and ${f.name} are friends.`)}>Accept</button>
                    <button type="button" class="btn small" disabled={busy}
                      onClick={() => void change(() => api.remove(f.code), () => null)}>Decline</button>
                  </>
                )))}
              </ul>
            </>
          )}
          <form class="account-form" onSubmit={find}>
            <label class="info-label" for="friend-find">Find a friend</label>
            <input id="friend-find" class="text-input" type="text" value={findTyped} maxLength={254}
              placeholder="Their name or email" autoComplete="off" spellcheck={false}
              onInput={(e) => setFindTyped(e.currentTarget.value)} />
            <button type="submit" class="btn" disabled={busy}>Find</button>
          </form>
          {found && found.length > 0 && (
            <ul class="friend-list" aria-label="Players found">
              {found.map((p) => (
                <li key={p.code}>
                  <span class="lobby-name">
                    {p.name}
                    {p.country && <span class="field-note found-country">{countryName(p.country)}</span>}
                  </span>
                  <span class="friend-btns">
                    {p.state === 'friends' ? <span class="field-note">Friends</span>
                      : p.state === 'sent' ? <span class="field-note">Request sent</span>
                      : (
                        <button type="button" class="btn small primary" disabled={busy} aria-label={`Add ${p.name}`}
                          onClick={() => addFound(p)}>{p.state === 'received' ? 'Accept' : 'Add'}</button>
                      )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {findNotice && <p class={findNotice.error ? 'field-note error' : 'field-note'} role="status">{findNotice.text}</p>}
          <form class="account-form" onSubmit={add}>
            <label class="info-label" for="friend-code">Add a friend by their code</label>
            <input id="friend-code" class="text-input" type="text" value={typed} maxLength={12} placeholder="ABCD-2345"
              autoComplete="off" autoCapitalize="characters" spellcheck={false}
              onInput={(e) => setTyped(e.currentTarget.value)} />
            <button type="submit" class="btn" disabled={busy}>Add friend</button>
          </form>
          {notice && <p class={notice.error ? 'field-note error' : 'field-note'} role="status">{notice.text}</p>}
          <YourCode code={list.code} invite={list.invite} name={name} busy={busy}
            onReset={() => void change(() => api.resetInvite(), () => 'Your invite link is new. Links you shared before no longer work.')} />
          <div class="menu-group">
            <label class="toggle">
              <input type="checkbox" checked={findByName} onChange={(e) => onFindByName(e.currentTarget.checked)} />
              Let players find me by name
            </label>
            <span class="field-note">
              Players who search for your name see it and your country, and can send you a friend request.
            </span>
          </div>
          {list.friends.length === 0 ? (
            <p class="field-note">No friends yet. Find them above by name or email, or send them your invite link.</p>
          ) : (
            <ul class="friend-list">
              {list.friends.map((f) => row(f, removing === f.code ? (
                <>
                  <button type="button" class="btn small danger" disabled={busy} onClick={() => {
                    setRemoving(null);
                    void change(() => api.remove(f.code),
                      () => `${f.name} is no longer on your friends list. Your invite link is new too: share the new one.`);
                  }}>Remove</button>
                  <button type="button" class="btn small" onClick={() => setRemoving(null)}>Keep</button>
                </>
              ) : (
                <>
                  <button type="button" class="btn small primary" onClick={() => onChallenge(f)}>Challenge</button>
                  <button type="button" class="btn small" aria-label={`Remove ${f.name}`}
                    onClick={() => setRemoving(f.code)}>✕</button>
                </>
              ), true))}
            </ul>
          )}
          {removing && list.friends.some((f) => f.code === removing) && (
            <p class="field-note" role="status">
              Removing them also changes your invite link, so links you've already shared stop working.
            </p>
          )}
          {list.sent.length > 0 && (
            <>
              <span class="info-label">Waiting for them to accept</span>
              <ul class="friend-list">
                {list.sent.map((f) => row(f, (
                  <button type="button" class="btn small" disabled={busy}
                    onClick={() => void change(() => api.remove(f.code), () => null)}>Cancel</button>
                )))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
