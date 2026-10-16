import { useEffect, useState } from 'preact/hooks';
import { BarChart, type Series } from './BarChart';
import { count, DIFFICULTIES, difficultyName, finishedOn, modeName, periodLabel, topCountries } from './format';
import { isUsage, type DailyCounts, type ModeCount, type PeriodKind, type Periods, type Usage } from './usage';

/*
 * The usage dashboard (Dev Plan item 18m), at wordmastermind.app/admin/
 * behind Cloudflare Access: number tiles, then charts and tables of what
 * the server already keeps. Totals only, from `/admin/figures` (the Pages
 * Function that passes Access's token on to the worker).
 */

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; usage: Usage };

/** What went wrong, in words, from the worker's answer. */
function problem(status: number, error: unknown): string {
  if (status === 404 && error === 'off') return 'The figures are off: the worker needs ACCESS_TEAM_DOMAIN and ACCESS_AUD set.';
  if (status === 403) return 'Cloudflare Access didn’t vouch for this visit. Reload the page to sign in again.';
  if (status === 503) return 'The server couldn’t reach Cloudflare Access to check your sign-in. Try again in a minute.';
  if (status === 429) return 'Too many loads in a minute. Try again shortly.';
  return `The server answered ${status}. Try again in a minute.`;
}

async function loadFigures(): Promise<Usage> {
  let response: Response;
  try {
    response = await fetch('/admin/figures', { cache: 'no-store' });
  } catch {
    throw new Error('Couldn’t reach the server. Check your connection and try again.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(problem(response.status, (body as { error?: unknown } | null)?.error));
  if (!isUsage(body)) throw new Error('The server’s answer wasn’t the figures. Try again in a minute.');
  return body;
}

const SINGLE: Series[] = [{ key: 'count', name: 'Count', color: 'var(--series-1)' }];
const BY_DIFFICULTY: Series[] = DIFFICULTIES.map((d, i) => ({ key: d, name: difficultyName(d), color: `var(--series-${i + 1})` }));
const KINDS: { kind: PeriodKind; name: string }[] = [{ kind: 'day', name: 'Days' }, { kind: 'week', name: 'Weeks' }, { kind: 'month', name: 'Months' }];

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div class="tile">
      <div class="tile-label">{label}</div>
      <div class="tile-value">{count(value)}</div>
      {note && <div class="tile-note">{note}</div>}
    </div>
  );
}

function PeriodChart({ title, periods, kind, unit }: { title: string; periods: Periods; kind: PeriodKind; unit: string }) {
  const bars = periods[kind].map((p) => ({ label: periodLabel(p.period, kind), values: { count: p.count } }));
  return <BarChart title={title} series={SINGLE} bars={bars} unit={unit} />;
}

function DailyChart({ title, days }: { title: string; days: DailyCounts[] }) {
  const bars = days.map((d) => ({ label: periodLabel(d.day, 'day'), values: d.finished, note: `${count(d.started)} started` }));
  return <BarChart title={title} series={BY_DIFFICULTY} bars={bars} unit="finished" />;
}

function ModeTable({ caption, modes }: { caption: string; modes: ModeCount[] }) {
  return (
    <table class="figures">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Mode</th><th scope="col">All time</th><th scope="col">Last 30 days</th></tr></thead>
      <tbody>
        {modes.length === 0 && <tr><td colSpan={3}>None yet</td></tr>}
        {modes.map((m) => (
          <tr key={m.mode}><th scope="row">{modeName(m.mode)}</th><td>{count(m.total)}</td><td>{count(m.recent)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function Figures({ usage }: { usage: Usage }) {
  const [kind, setKind] = useState<PeriodKind>('day');
  const countries = topCountries(usage.countries);
  const today = usage.daily.at(-1);
  const todayWord = usage.dailyWord.at(-1);
  return (
    <>
      <section class="tiles" aria-label="Totals">
        <Tile label="Players" value={usage.players.total} note="accounts, and guests never signed in" />
        <Tile label="Accounts" value={usage.players.accounts} />
        <Tile label="Guests" value={usage.players.guests} />
        <Tile label="Devices" value={usage.players.devices} note="each browser counts once" />
        <Tile label="Active, 24 hours" value={usage.active.day} />
        <Tile label="Active, 7 days" value={usage.active.week} />
        <Tile label="Active, 30 days" value={usage.active.month} />
        {today && <Tile label="Daily Rush today" value={finishedOn(today)} note={`finished, of ${count(today.started)} started`} />}
        {todayWord && <Tile label="Daily Word today" value={finishedOn(todayWord)} note={`finished, of ${count(todayWord.started)} started`} />}
      </section>

      <section>
        <h2>Players over time</h2>
        <div class="period-tabs" role="group" aria-label="Show by">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>{k.name}</button>
          ))}
        </div>
        <PeriodChart title="New players" periods={usage.newPlayers} kind={kind} unit="new" />
        <PeriodChart title="New accounts" periods={usage.newAccounts} kind={kind} unit="new" />
        <PeriodChart title="Players who played (online or synced games)" periods={usage.playing} kind={kind} unit="players" />
      </section>

      <section>
        <h2>Games per mode</h2>
        <div class="tables">
          <ModeTable caption="Online games" modes={usage.games.online} />
          <ModeTable caption="Synced games (signed in)" modes={usage.games.synced} />
        </div>
      </section>

      <section>
        <h2>Daily games, last 30 days</h2>
        <DailyChart title="Daily Rush entries by difficulty" days={usage.daily} />
        <DailyChart title="Daily Word entries by difficulty" days={usage.dailyWord} />
      </section>

      <section>
        <h2>Players by country</h2>
        <table class="figures">
          <caption>Signed-in players, by the country in their profile</caption>
          <thead><tr><th scope="col">Country</th><th scope="col">Players</th></tr></thead>
          <tbody>
            {countries.rows.map((c) => <tr key={c.name}><th scope="row">{c.name}</th><td>{count(c.count)}</td></tr>)}
            {countries.others !== null && <tr><th scope="row">Others</th><td>{count(countries.others)}</td></tr>}
            <tr><th scope="row">No country chosen</th><td>{count(usage.noCountry)}</td></tr>
          </tbody>
        </table>
      </section>

      <footer class="notes">
        <p>
          Counted from what the server already keeps, nothing new. Guests’ offline games (single player, two player
          vs. the computer and Solo Rush without signing in) never reach the server, so they aren’t counted; signed-in
          players’ synced games are. Active means the app was opened online. A player is an account, or a guest who
          never signed in. Days, weeks (from Monday) and months are New York’s, like the daily games’.
        </p>
        <p>Counted {new Date(usage.at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} New York time.</p>
      </footer>
    </>
  );
}

export function Dashboard() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const refresh = () => {
    setLoad({ state: 'loading' });
    loadFigures().then(
      (usage) => setLoad({ state: 'ready', usage }),
      (error: Error) => setLoad({ state: 'error', message: error.message }),
    );
  };
  useEffect(refresh, []);
  return (
    <main class="dashboard">
      <header class="top">
        <h1>Word Mastermind usage</h1>
        <button type="button" onClick={refresh} disabled={load.state === 'loading'}>Refresh</button>
      </header>
      {load.state === 'loading' && <p class="status">Counting…</p>}
      {load.state === 'error' && <p class="status error" role="alert">{load.message}</p>}
      {load.state === 'ready' && <Figures usage={load.usage} />}
    </main>
  );
}
