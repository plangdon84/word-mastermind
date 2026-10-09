/**
 * The admin wipe (README "Dev Plan" item 4): empties game history and
 * leaderboards from D1, keeping players. Run through `npm run wipe`, never
 * from the game. Every PR that adds a table adds it to one of the lists
 * below; a test fails until it does.
 */

/** Tables the wipe empties, children before parents so foreign keys hold. */
export const WIPE_TABLES = [
  'game_players', 'games', 'friend_game_players', 'daily_results', 'daily_word_results', 'history_entries', 'rated_games', 'ratings',
  'profile_games', 'shared_profiles', 'email_requests',
] as const;

/**
 * Tables the wipe leaves alone: who the players are, their accounts,
 * sign-ins, synced profiles and friends, and which devices get their turn alerts,
 * not what they did; the issue reports, whose screenshots GitHub issues
 * link to; and the Daily Rush's themes and the Daily Word's words.
 */
export const KEEP_TABLES = [
  'guests', 'push_subscriptions', 'accounts', 'sessions', 'login_links', 'oauth_states', 'reports', 'profiles',
  'friends', 'lobby_invites', 'daily_themes', 'daily_words',
] as const;

/** The environments in wrangler.toml; `local` is the top-level one (worker/.wrangler/). */
export const ENVIRONMENTS = ['local', 'staging', 'production'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const isEnvironment = (value: unknown): value is Environment =>
  (ENVIRONMENTS as readonly unknown[]).includes(value);

export function wipeSql(): string {
  return WIPE_TABLES.map((table) => `DELETE FROM ${table};`).join(' ');
}

/** The wipe goes ahead only if you typed the environment's name exactly. */
export const confirmed = (environment: Environment, typed: string) => typed.trim() === environment;

/** Arguments for `wrangler` that run the wipe against `environment`. */
export function wranglerArgs(environment: Environment, config: string): string[] {
  const target = environment === 'local' ? ['--local', '--env='] : ['--remote', `--env=${environment}`];
  return ['d1', 'execute', 'DB', '--config', config, ...target, '--command', wipeSql()];
}
