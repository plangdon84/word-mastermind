/**
 * Guest identity: a guest is known only by the ID their device created (the
 * profile's `deviceId`, a version 4 UUID from `src/app/ids.ts`). On its own
 * an ID identifies a player but doesn't prove who they are; once it belongs
 * to an account, only that account's session can use it (`identify` in
 * `accounts.ts`).
 */

const GUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Is this a guest ID a device could have created? Lowercase, as `newId` makes them. */
export function isGuestId(value: unknown): value is string {
  return typeof value === 'string' && GUEST_ID.test(value);
}

export interface Guest {
  id: string;
  /** Milliseconds since the epoch, by the server's clock. */
  createdAt: number;
  lastSeenAt: number;
}

/** Records a guest the first time they're seen, and when they were last seen after that. */
export async function registerGuest(db: D1Database, id: string, now: number): Promise<Guest> {
  const row = await db.prepare(
    `INSERT INTO guests (id, created_at, last_seen_at) VALUES (?1, ?2, ?2)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = excluded.last_seen_at
     RETURNING created_at, last_seen_at`,
  ).bind(id, now).first<{ created_at: number; last_seen_at: number }>();
  if (!row) throw new Error('Registering a guest returned no row');
  return { id, createdAt: row.created_at, lastSeenAt: row.last_seen_at };
}
