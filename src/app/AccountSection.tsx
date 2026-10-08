import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  authApi, AuthError, authErrorMessage, checkSession, type AccountInfo, type Session, type SignInMethods,
} from './account';

/** `quiet`: it doesn't replace an error already shown (such as "You were signed out"). */
export type AccountNotice = { text: string; error: boolean; quiet?: boolean };
/** An emailed sign-in link's address, while asking "Sign in as …?" and then while signing in with it. */
export type LoginAsk = { email: string; signingIn: boolean };

/**
 * The profile's Account section (README "Accounts"): sign in with an email
 * link or Google, or, signed in, who you are, signing out and deleting the
 * account.
 */
export function AccountSection({ apiUrl, guestId, session, onAccount, onSignedOut, notice, loginAsk = null, onLoginAsk }: {
  apiUrl: string;
  /** This device's guest ID (the profile's `deviceId`). */
  guestId: string;
  session: Session | null;
  /** The server has newer details of the signed-in account. */
  onAccount: (account: AccountInfo) => void;
  /**
   * The session ended: signed out, deleted, or ended elsewhere. With
   * `newGuest`, this device's guest ID is the account's, so it needs a new one.
   */
  /** `deliberate`: Sign out or Delete account, rather than a session found to have ended. */
  onSignedOut: (newGuest: boolean, deliberate: boolean) => void;
  /** How signing in from a link went, when the app just opened one. */
  notice: AccountNotice | null;
  /** The address an emailed sign-in link just opened is for, to ask "Sign in as …?" before using it. */
  loginAsk?: LoginAsk | null;
  /** The answer: true signs in with the link, false leaves this device as it was. */
  onLoginAsk?: (yes: boolean) => void;
}) {
  const api = useMemo(() => authApi(apiUrl, guestId), [apiUrl, guestId]);
  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<AccountNotice | null>(notice);

  // A notice from the app while this page is open.
  useEffect(() => setMessage((shown) => (notice?.quiet && shown?.error ? shown : notice)), [notice]);

  // The ways to sign in, and whether this session still stands. Not while a link signs in: switching
  // accounts leaves this device briefly signed out, and the guest ID the link then claims would read as
  // signed out of an account, ending the new session. It checks again once signing in is done.
  const signingIn = loginAsk?.signingIn === true;
  useEffect(() => {
    if (signingIn) return;
    let live = true;
    checkSession(api, session?.token ?? null).then((check) => {
      if (!live) return;
      if (check.methods) setMethods(check.methods);
      if (check.ended || check.newGuest) {
        if (check.ended) setMessage({ text: authErrorMessage('signed-out'), error: true });
        onSignedOut(check.newGuest, false);
      } else if (session && check.account && JSON.stringify(check.account) !== JSON.stringify(session.account)) {
        onAccount(check.account);
      }
    }, () => {
      // Without an answer there's no way to sign in to offer, so say why rather than show nothing.
      if (live) setMessage({ text: authErrorMessage('unreachable'), error: true });
    });
    return () => {
      live = false;
    };
  }, [api, session?.token, signingIn]);

  const fail = (e: unknown) =>
    setMessage({ text: authErrorMessage(e instanceof AuthError ? e.code : 'unreachable'), error: true });

  const sendLink = (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const to = email.trim();
    api.sendLink(to, location.origin).then(() => setSentTo(to), fail).finally(() => setBusy(false));
  };

  const google = () => {
    setBusy(true);
    setMessage(null);
    // Off to Google's page; it comes back to the app with `?login=`.
    api.googleUrl(location.origin).then((url) => location.assign(url), (e: unknown) => {
      fail(e);
      setBusy(false);
    });
  };

  const signOut = () => {
    if (!session) return;
    setBusy(true);
    // This device signs out whatever the server says; the session would lapse there anyway.
    api.signOut(session.token).catch(() => {}).finally(() => {
      setBusy(false);
      setMessage({
        text: 'You signed out. Your games here stay; sign in again to get your games against friends back.', error: false,
      });
      onSignedOut(true, true);
    });
  };

  const deleteAccount = () => {
    if (!session) return;
    setBusy(true);
    api.deleteAccount(session.token).then(() => {
      setConfirmDelete(false);
      setMessage({ text: 'Your account is deleted, and every device is signed out.', error: false });
      onSignedOut(false, true);
    }, fail).finally(() => setBusy(false));
  };

  const legal = (
    <p class="field-note legal">
      <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>
      {' · '}
      <a href="/terms" target="_blank" rel="noopener">Terms of service</a>
    </p>
  );

  const status = message && (
    <p class={message.error ? 'field-note error' : 'field-note'} role="status">{message.text}</p>
  );

  // A link someone made for their own account and sent you would sign this device in to theirs.
  const askTitle = useRef<HTMLHeadingElement>(null);
  const asking = loginAsk !== null && !loginAsk.signingIn;
  // The question takes focus, so keyboard and screen reader users know a choice is waiting.
  useEffect(() => {
    if (asking) askTitle.current?.focus();
  }, [asking]);
  const ask = loginAsk && (loginAsk.signingIn ? (
    <p class="field-note" role="status">Signing in…</p>
  ) : (
    <div class="panel inline warning account-ask" role="alertdialog" aria-labelledby="login-ask-title">
      <h2 id="login-ask-title" ref={askTitle} tabIndex={-1}>Sign in as {loginAsk.email}?</h2>
      <p>
        This link signs this device in to that account. If it isn't your address, or you didn't ask for a link,
        choose <b>Not me</b>.
      </p>
      {session && <p>You'll be signed out of <b>{session.account.email}</b> on this device.</p>}
      <div class="row-btns">
        <button type="button" class="btn primary" onClick={() => onLoginAsk?.(true)}>Sign in</button>
        <button type="button" class="btn" onClick={() => onLoginAsk?.(false)}>Not me</button>
      </div>
    </div>
  ));

  if (session) {
    return (
      <section class="profile-section" aria-label="Account">
        <p class="account-who">
          Signed in as <b>{session.account.email}</b>{session.account.google && ' with Google'}
        </p>
        {ask}
        <p class="field-note">
          Your profile, settings, game history and games against friends follow you to any device you sign in on.
        </p>
        {status}
        <div class="row-btns start">
          <button type="button" class="btn" disabled={busy} onClick={signOut}>Sign out</button>
        </div>
        {confirmDelete ? (
          <div class="panel inline warning">
            <h2>Delete your account?</h2>
            <p>
              <b>This signs out every device and forgets your email, and the profile and game history kept with
              the account.</b> Games you've played stay in your friends' history, and your games and settings in
              this browser stay here. It can't be undone.
            </p>
            <div class="row-btns">
              <button type="button" class="btn danger" disabled={busy} onClick={deleteAccount}>Delete account</button>
              <button type="button" class="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" class="btn danger-outline" onClick={() => setConfirmDelete(true)}>Delete account</button>
        )}
        {legal}
      </section>
    );
  }

  return (
    <section class="profile-section" aria-label="Account">
      <p class="field-note">
        Sign in to keep your profile, settings and game history with an account, and to play your games against
        friends on any device. Your games here go to the account, and games from your other devices come here.
      </p>
      {ask}
      {status}
      {methods && !methods.email && !methods.google && (
        <p class="field-note">This server isn't set up for signing in yet.</p>
      )}
      {methods?.email && !loginAsk && (sentTo ? (
        <div class="account-sent">
          <p class="field-note" role="status">
            Check your inbox: we've sent a sign-in link to <b>{sentTo}</b>. It works once, for 15 minutes.
          </p>
          <button type="button" class="btn small" onClick={() => setSentTo(null)}>Use another address</button>
        </div>
      ) : (
        <form class="account-form" onSubmit={sendLink}>
          <label class="visually-hidden" for="account-email">Email address</label>
          <input id="account-email" class="text-input" type="email" value={email} required maxLength={254}
            placeholder="you@example.com" autoComplete="email" inputMode="email"
            onInput={(e) => setEmail(e.currentTarget.value)} />
          <button type="submit" class="btn primary" disabled={busy}>Email me a link</button>
        </form>
      ))}
      {methods?.google && !loginAsk && (
        <button type="button" class="btn google" disabled={busy} onClick={google}>Continue with Google</button>
      )}
      {legal}
    </section>
  );
}
