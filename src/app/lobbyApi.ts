import {
  isCount, isDifficulty, isLobbyCode, isLobbyMinutes, isObject, isStrength, isTime, type Difficulty, type LobbyError,
  type LobbyKind, type LobbyRunView, type LobbyStanding, type LobbySettings, type LobbyView, type DailyWordView, type Strength,
} from '../game';
import { apiRequester, type ApiIdentity } from './apiIdentity';
import { isRatingLine, ratingLine, type RatingLine } from './friendApi';
import { parseWordView } from './dailyApi';

/*
 * Rush with Friends and Competitive Rush (README "Rush modes"), refereed by
 * the server (`worker/`): a lobby of up to 5 players, found by its join
 * code, solving 4 words on one clock. The words stay on the server until you
 * find them or the game is over.
 */

/**
 * What the server answers: your view of the lobby, its clock (so the app's
 * clock can follow it) and, once a rated Competitive Rush is over, your
 * rating change.
 */
export interface LobbyAnswer {
  lobby: LobbyView;
  now: number;
  rating: RatingLine | null;
}

/** The server's reasons for refusing a request. */
export type LobbyErrorCode =
  | Exclude<LobbyError, 'paused' | 'not-paused' | 'not-pausable' | 'no-words'>
  | 'bad-request' | 'bad-guest-id' | 'signed-out' | 'sign-in-needed' | 'not-found' | 'code-taken' | 'offensive-name'
  | 'not-a-friend' | 'account-needed'
  | 'unreachable';

const timeOrNull = (value: unknown): value is number | null => value === null || isTime(value);
const OUTCOMES = [null, 'solved', 'gave-up', 'unsolved'];
const isStrengthOrNull = (value: unknown): value is Strength | null => value === null || isStrength(value);
const isNames = (value: unknown): value is string[] => Array.isArray(value) && value.every((n) => typeof n === 'string');

function parseRun(value: unknown): LobbyRunView | null {
  if (!isObject(value) || (value.status !== 'playing' && value.status !== 'over') || !isCount(value.current)) return null;
  if (!Array.isArray(value.words)) return null;
  const words = value.words.map(parseWordView);
  if (words.some((w) => w === null)) return null;
  // Missing from a server older than Competitive Rush.
  const setBy = value.setBy ?? null;
  if (!(setBy === null || isNames(setBy))) return null;
  return { current: value.current, status: value.status, words: words as DailyWordView[], setBy };
}

const isScored = (value: unknown) => isObject(value) && isCount(value.guesses) && typeof value.seconds === 'number';
const numberOrNull = (value: unknown): value is number | null => value === null || typeof value === 'number';

function parseStanding(value: unknown): LobbyStanding | null {
  if (!isObject(value) || typeof value.name !== 'string' || typeof value.you !== 'boolean') return null;
  if (!isStrengthOrNull(value.strength) || typeof value.finished !== 'boolean' || !Array.isArray(value.words)) return null;
  if (!(value.rank === null || isCount(value.rank)) || !numberOrNull(value.score) || !numberOrNull(value.seconds)) return null;
  const words: LobbyStanding['words'][number][] = [];
  for (const w of value.words) {
    if (!isObject(w) || !OUTCOMES.includes(w.outcome as string) || !isCount(w.guesses)) return null;
    if (!(w.counted === null || isScored(w.counted))) return null;
    const counted = w.counted as { guesses: number; seconds: number } | null;
    words.push({
      outcome: w.outcome as LobbyStanding['words'][number]['outcome'], guesses: w.guesses,
      counted: counted && { guesses: counted.guesses, seconds: counted.seconds },
    });
  }
  return {
    name: value.name, strength: value.strength, you: value.you, rank: value.rank as number | null,
    finished: value.finished, words, score: value.score, seconds: value.seconds,
  };
}

export function parseLobbyView(value: unknown): LobbyView | null {
  if (!isObject(value)) return null;
  const v = value;
  if (!isLobbyCode(v.code) || !['open', 'closed', 'playing', 'over'].includes(v.state as string)) return null;
  const kind: LobbyKind = v.kind === 'competitive' ? 'competitive' : 'friends';
  const yourWord = v.yourWord ?? null;
  if (!(yourWord === null || typeof yourWord === 'string')) return null;
  if (typeof v.hostName !== 'string' || typeof v.host !== 'boolean' || typeof v.joined !== 'boolean') return null;
  const isPlayer = (p: unknown) =>
    isObject(p) && typeof p.name === 'string' && isStrengthOrNull(p.strength) && typeof p.you === 'boolean';
  if (!Array.isArray(v.players) || !v.players.every(isPlayer)) return null;
  const settings = v.settings;
  if (!isObject(settings) || !isDifficulty(settings.difficulty) || !isLobbyMinutes(settings.minutes)) return null;
  if (!isCount(settings.computers) || !isStrength(settings.strength)) return null;
  if (![v.closesAt, v.startedAt, v.endsAt, v.endedAt].every(timeOrNull)) return null;
  const run = v.run === null ? null : parseRun(v.run);
  if (v.run !== null && !run) return null;
  let standings: LobbyStanding[] | null = null;
  if (v.standings !== null) {
    if (!Array.isArray(v.standings)) return null;
    standings = v.standings.map(parseStanding) as LobbyStanding[];
    if (standings.some((p) => p === null)) return null;
  }
  if (!(v.words === null || (Array.isArray(v.words) && v.words.every((w) => typeof w === 'string')))) return null;
  return {
    code: v.code, kind, state: v.state as LobbyView['state'], yourWord, hostName: v.hostName, host: v.host, joined: v.joined,
    players: (v.players as LobbyView['players'][number][]).map((p) => ({ name: p.name, strength: p.strength, you: p.you })),
    settings: { difficulty: settings.difficulty, minutes: settings.minutes, computers: settings.computers, strength: settings.strength },
    closesAt: v.closesAt as number | null, startedAt: v.startedAt as number | null, endsAt: v.endsAt as number | null,
    endedAt: v.endedAt as number | null, run, standings, words: v.words as string[] | null,
  };
}

export function parseLobbyAnswer(value: unknown): LobbyAnswer | null {
  if (!isObject(value) || !isTime(value.now)) return null;
  const rating = value.rating ?? null;
  if (!(rating === null || isRatingLine(rating))) return null;
  const lobby = parseLobbyView(value.lobby);
  return lobby && { lobby, now: value.now, rating: rating && ratingLine(rating) };
}

/** A request the server refused, with its reason. */
export class LobbyApiError extends Error {
  constructor(readonly code: LobbyErrorCode, readonly status: number) {
    super(`The server answered ${status}: ${code}`);
  }
}

export interface LobbyApi {
  /** Opens a lobby with you as host, at `difficulty`: Competitive Rush with your `word`. */
  create(name: string, difficulty: Difficulty, word?: string): Promise<LobbyAnswer>;
  get(code: string): Promise<LobbyAnswer>;
  /** Takes a seat: in Competitive Rush, with your `word`. */
  join(code: string, name: string, word?: string): Promise<LobbyAnswer>;
  /** Changes your Competitive Rush word before the game starts. */
  setWord(code: string, word: string): Promise<LobbyAnswer>;
  leave(code: string): Promise<LobbyAnswer>;
  /** The host closes the lobby before starting it. */
  close(code: string): Promise<LobbyAnswer>;
  settings(code: string, settings: LobbySettings): Promise<LobbyAnswer>;
  start(code: string): Promise<LobbyAnswer>;
  guess(code: string, word: string): Promise<LobbyAnswer>;
  giveUpWord(code: string): Promise<LobbyAnswer>;
  /** Records that Easy's Suggest offered `word` at the word being played (README "Easy"). */
  suggest(code: string, word: string): Promise<LobbyAnswer>;
  /** Gives up every word not yet found. */
  giveUp(code: string): Promise<LobbyAnswer>;
  /** The host invites a friend (by their friend code) to the open lobby: signed in only. */
  invite(code: string, friend: string): Promise<LobbyAnswer>;
}

/**
 * Talks to the worker at `apiUrl`, as this device's guest or, signed in, its
 * account (`identity`). Every call rejects with a `LobbyApiError`.
 */
export function lobbyApi(apiUrl: string, identity: ApiIdentity, fetchFn: typeof fetch = fetch): LobbyApi {
  const send = apiRequester(apiUrl, identity, fetchFn, (code, status) => new LobbyApiError(code as LobbyErrorCode, status));
  const request = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<LobbyAnswer> => {
    const answer = parseLobbyAnswer(await send(method, path, method === 'POST' ? body ?? {} : undefined));
    if (!answer) throw new LobbyApiError('bad-request', 200);
    return answer;
  };
  const post = (code: string, action: string, body?: unknown) => request('POST', `/api/lobbies/${code}/${action}`, body);
  return {
    create: (name, difficulty, word) =>
      request('POST', '/api/lobbies', word === undefined ? { name, difficulty } : { name, difficulty, kind: 'competitive', word }),
    get: (code) => request('GET', `/api/lobbies/${code}`),
    join: (code, name, word) => post(code, 'join', word === undefined ? { name } : { name, word }),
    setWord: (code, word) => post(code, 'word', { word }),
    leave: (code) => post(code, 'leave'),
    close: (code) => post(code, 'close'),
    settings: (code, settings) => post(code, 'settings', settings),
    start: (code) => post(code, 'start'),
    guess: (code, word) => post(code, 'guess', { word }),
    giveUpWord: (code) => post(code, 'give-up-word'),
    suggest: (code, word) => post(code, 'suggest', { word }),
    giveUp: (code) => post(code, 'give-up'),
    invite: (code, friend) => post(code, 'invite', { friend }),
  };
}
