import { describe, expect, it } from 'vitest';
import { fakeD1, migrationSql } from './fakeD1';
import { registerGuest } from './guests';
import { confirmed, isEnvironment, KEEP_TABLES, WIPE_TABLES, wipeSql, wranglerArgs } from './wipe';

const count = (sqlite: ReturnType<typeof fakeD1>['sqlite'], table: string) =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('the admin wipe', () => {
  it('lists every table the migrations create, as wiped or kept', () => {
    const created = migrationSql().flatMap((sql) => [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/gi)].map((m) => m[1]));
    expect([...WIPE_TABLES, ...KEEP_TABLES].sort()).toEqual([...new Set(created)].sort());
  });

  it('empties game history and keeps players', async () => {
    const { db, sqlite } = fakeD1();
    const guest = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
    await registerGuest(db, guest, 1);
    sqlite.exec(`INSERT INTO games (id, mode, version, record, started_at) VALUES ('g1', 'pvp', 1, '{}', 1)`);
    sqlite.exec(`INSERT INTO game_players (game_id, guest_id) VALUES ('g1', '${guest}')`);
    sqlite.exec(wipeSql());
    expect(count(sqlite, 'games')).toBe(0);
    expect(count(sqlite, 'game_players')).toBe(0);
    expect(count(sqlite, 'guests')).toBe(1);
  });

  it("goes ahead only when you type the environment's name", () => {
    expect(confirmed('production', 'production')).toBe(true);
    expect(confirmed('production', ' production\n')).toBe(true);
    expect(confirmed('production', 'Production')).toBe(false);
    expect(confirmed('production', 'y')).toBe(false);
    expect(confirmed('staging', 'production')).toBe(false);
  });

  it('targets the local database or a remote environment', () => {
    expect(wranglerArgs('local', 'w.toml')).toEqual(
      ['d1', 'execute', 'DB', '--config', 'w.toml', '--local', '--env=', '--command', wipeSql()]);
    expect(wranglerArgs('production', 'w.toml')).toEqual(
      ['d1', 'execute', 'DB', '--config', 'w.toml', '--remote', '--env=production', '--command', wipeSql()]);
    expect(isEnvironment('prod')).toBe(false);
  });
});
