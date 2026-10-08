// A stand-in for D1 in tests, on Node's built-in SQLite (D1 is SQLite too),
// with the real migrations applied. It covers only what the worker uses.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { themeDaysSql } from './themeDays';
import { testThemeDays } from './testThemes';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

/** The migration files, in the order D1 applies them. */
export function migrationSql(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'));
}

/** Most parameters one D1 statement can bind. */
const MAX_BOUND = 100;

class FakeStatement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string, private readonly args: SQLInputValue[] = []) {}

  bind(...args: SQLInputValue[]) {
    // D1's own limit, which SQLite's is far above.
    if (args.length > MAX_BOUND) throw new Error(`D1 allows at most ${MAX_BOUND} bound parameters`);
    return new FakeStatement(this.db, this.sql, args);
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.args) as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    return (column === undefined ? row : row[column]) as T;
  }

  async all<T>() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.args) as T[], meta: {} };
  }

  async run() {
    const { changes } = this.db.prepare(this.sql).run(...this.args);
    return { success: true, results: [], meta: { changes: Number(changes) } };
  }
}

/**
 * A fresh, migrated, in-memory database typed as D1. With `dailyThemes`,
 * every day of 2026 and 2027 has a made-up Daily Rush set (`testThemes.ts`).
 */
export function fakeD1({ dailyThemes = false } = {}): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const sql of migrationSql()) sqlite.exec(sql);
  if (dailyThemes) sqlite.exec(themeDaysSql(testThemeDays('2026-01-01', 730), '0000-00-00'));
  const db = {
    prepare: (sql: string) => new FakeStatement(sqlite, sql),
    // Like D1's, a batch is one transaction: if a statement fails, none of them count.
    batch: async (statements: FakeStatement[]) => {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}
