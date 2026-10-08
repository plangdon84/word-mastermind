import { useRef, useState } from 'preact/hooks';
import { LOBBY_SEATS, validateSecretWord, type LobbyKind, type LobbyView, type Strength } from '../game';
import type { ApiIdentity } from './apiIdentity';
import { Keyboard, STRENGTH_LABEL } from './components';
import { API_URL } from './config';
import { isPhone, SecretStep, ShareIcon } from './friendParts';
import { useFriendsList } from './FriendsSection';
import { useMessage, usePhysicalKeyboard } from './hooks';
import { LobbyApiError, type LobbyApi } from './lobbyApi';
import { lobbyLink, lobbyMessage } from './lobbyStorage';
import { guessCount, lobbyErrorMessage, secretErrorMessage } from './messages';
import { formatClock, RushDots } from './rushParts';
import { smsLink } from './friendGames';
import { addRecentSecret, loadRecentSecrets, saveRecentSecrets } from './recentSecrets';
import { shareLink } from './share';

/** The parts of a lobby around the board: your Competitive Rush word, the seats, the join code and the standings. */

export const MODE_NAME: Record<LobbyKind, string> = { friends: 'Rush with Friends', competitive: 'Competitive Rush' };

/**
 * Choosing your secret word for Competitive Rush: to open a lobby, to join
 * one, or to change it before the game starts. `onWord` sends it, and
 * answers why the server refused it, or null.
 */
export function WordStep({ title, note, onBack, onWord }: {
  title: string;
  note: string;
  onBack: () => void;
  onWord: (word: string) => Promise<string | null>;
}) {
  const [draft, setDraftState] = useState('');
  const draftRef = useRef('');
  const [message, setMessage] = useMessage();
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const setDraft = (d: string) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const enter = async () => {
    if (busyRef.current) return;
    const word = draftRef.current;
    const checked = validateSecretWord(word);
    if (!checked.ok) {
      setMessage({ text: secretErrorMessage(checked.error, word), error: true });
      setShake(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const refused = await onWord(checked.word);
    busyRef.current = false;
    setBusy(false);
    if (refused) {
      setMessage({ text: refused, error: true });
      setShake(true);
    } else {
      saveRecentSecrets(addRecentSecret(loadRecentSecrets(), checked.word));
    }
  };
  const typeLetter = (letter: string) => {
    if (!busyRef.current && draftRef.current.length < 5) setDraft(draftRef.current + letter);
  };
  const backspace = () => {
    if (!busyRef.current) setDraft(draftRef.current.slice(0, -1));
  };
  usePhysicalKeyboard({ onLetter: typeLetter, onEnter: () => void enter(), onBackspace: backspace });
  return (
    <SecretStep title={title} note={note} draft={draft} shake={shake} onShakeEnd={() => setShake(false)}
      message={message} busy={busy} onDraft={setDraft} onBack={onBack}
      keyboard={<Keyboard ready={draft.length === 5} onLetter={typeLetter} onEnter={() => void enter()} onBackspace={backspace} />} />
  );
}

/** "Ann", or "Computer 1 · Skilled". */
const seatName = (p: { name: string; strength: Strength | null }) =>
  p.strength ? `${p.name} · ${STRENGTH_LABEL[p.strength]}` : p.name;

/** A score to one decimal place: 9.5. */
export const scoreText = (score: number) => score.toFixed(1);

/**
 * The standings: finished players ranked by score (time breaks ties), then
 * those still playing, with their words found and guesses so far. Never
 * anyone's guesses.
 */
export function Standings({ lobby }: { lobby: LobbyView }) {
  return (
    <ol class="lobby-standings" aria-label="Standings">
      {(lobby.standings ?? []).map((p, i) => {
        const found = p.words.filter((w) => w.outcome === 'solved').length;
        const guesses = p.words.reduce((sum, w) => sum + w.guesses, 0);
        const counted = p.words.reduce((sum, w) => sum + (w.counted?.guesses ?? 0), 0);
        const current = p.words.findIndex((w) => w.outcome === null);
        return (
          <li key={i} class={p.you ? 'you' : ''}>
            <span class="board-rank">{p.rank ?? ''}</span>
            <span class="lobby-name">{seatName(p)}{p.you && ' (you)'}</span>
            <RushDots words={p.words} current={p.finished ? null : current} label={p.name} />
            <span class="lobby-score">{p.score === null ? '' : scoreText(p.score)}</span>
            <span class="lobby-stat">
              {p.finished
                ? `${found} found · ${guessCount(counted)}${counted > guesses ? ', with penalties' : ''} · ${formatClock(p.seconds ?? 0)}`
                : `${found} found · ${guessCount(guesses)} so far · playing`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The join code, with Copy link and Share, as for an invite to a friend. The
 * link itself only shows if copying fails, to copy by hand: the code is
 * already on screen once.
 */
export function JoinCode({ lobby }: { lobby: LobbyView }) {
  const link = lobbyLink(location.origin, lobby.code);
  const message = lobbyMessage(lobby.hostName, lobby.code);
  const [copied, setCopied] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setShowLink(true);
    }
  };
  const share = () => {
    shareLink({ title: 'Word Mastermind', text: message, url: link });
  };
  return (
    <>
      <p class="lobby-code" aria-label={`Join code ${[...lobby.code].join(' ')}`}>{lobby.code}</p>
      {showLink && (
        <>
          <label class="visually-hidden" for="lobby-link">Join link</label>
          <input id="lobby-link" class="invite-link" readOnly value={link} autoFocus
            onFocus={(e) => e.currentTarget.select()} />
        </>
      )}
      <div class="row-btns">
        <button class="btn primary" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        {'share' in navigator ? (
          <button class="btn share" type="button" onClick={share}><ShareIcon />Share</button>
        ) : isPhone() && (
          <a class="btn share" href={smsLink(message, link)}><ShareIcon />Text it</a>
        )}
      </div>
    </>
  );
}

/**
 * The host's friends (signed in), each with Invite: the invite waits on the
 * friend's title screen, and they're told if they have turn alerts on.
 */
export function InviteFriends({ lobby, api, identity }: { lobby: LobbyView; api: LobbyApi; identity: ApiIdentity }) {
  const [list] = useFriendsList(API_URL, identity);
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  if (!list || list.friends.length === 0) return null;
  const invite = (code: string) => {
    setError(null);
    api.invite(lobby.code, code).then(() => setInvited((s) => new Set([...s, code])),
      (e: unknown) => setError(lobbyErrorMessage(e instanceof LobbyApiError ? e.code : 'unreachable')));
  };
  return (
    <div class="lobby-friends">
      <span class="menu-label">Invite friends</span>
      <ul class="friend-list">
        {list.friends.map((f) => (
          <li key={f.code}>
            <span class="lobby-name">{f.name}</span>
            <span class="friend-btns">
              {invited.has(f.code) ? <span class="tag">Invited</span>
                : <button type="button" class="btn small" onClick={() => invite(f.code)}>Invite</button>}
            </span>
          </li>
        ))}
      </ul>
      {error && <p class="field-note error" role="status">{error}</p>}
    </div>
  );
}

/** The seats before the game: who has joined, the computers, and the empty ones. */
export function Seats({ lobby }: { lobby: LobbyView }) {
  const empty = Math.max(0, LOBBY_SEATS - lobby.players.length);
  return (
    <ol class="lobby-seats">
      {lobby.players.map((p, i) => (
        <li key={i} class={p.you ? 'you' : ''}>
          <span class="lobby-name">{seatName(p)}</span>{i === 0 && <span class="tag">Host</span>}
          {p.you && <span class="visually-hidden"> (you)</span>}
        </li>
      ))}
      {Array.from({ length: empty }, (_, i) => <li key={`e${i}`} class="empty">Empty seat</li>)}
    </ol>
  );
}
