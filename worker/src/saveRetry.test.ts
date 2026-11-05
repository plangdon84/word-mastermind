// A finished game whose save to D1 fails is never lost from the history
// (Dev Plan item 19m): the room keeps it over, marked unsaved, and its alarm
// (or, for a daily game, the player's next request) saves it later; a game
// is rated once however its saves overlap.
import { describe, expect, it } from 'vitest';
import { dailyDay } from '../../src/game';
import { handleDaily, type DailyDeps } from './dailyRoom';
import { memoryStorage } from './fakeRooms';
import { handleAlarm, handleRoom, SAVE_RETRY_MS, type Room, type RoomDeps } from './room';
import { fakeD1 } from './fakeD1';
import { rateFinishedGame, ratedGameChanges, ratingStatements } from './ratings';

const NOW = Date.parse('2026-11-02T12:00:00Z');

/** A save that fails the first `failures` times it's asked. */
function flakySave(failures: number) {
  const saves = { calls: 0, done: 0 };
  const save = async () => {
    saves.calls += 1;
    if (saves.calls <= failures) throw new Error('D1 is down');
    saves.done += 1;
    return null;
  };
  return { saves, save };
}

describe('a game against a friend', () => {
  it('ends at once when saving the finished game fails, and the alarm saves it later', async () => {
    const storage = memoryStorage();
    const { saves, save } = flakySave(1);
    const deps: RoomDeps = {
      saveFinished: save, ladderEnded: () => {}, namesOf: async () => ({}), friendCodes: async () => ({}), friendStateOf: async () => 'none',
      ratingsOf: async () => { throw new Error('unrated'); }, random: () => 0, notify: () => {}, played: async () => {},
    };
    const host = { guestId: 'host-id' };
    const guest = { guestId: 'guest-id' };
    await handleRoom(storage, deps, {
      action: 'create', id: 'room', ...host, name: 'Host', secret: 'brick', difficulty: 'medium', timeControl: '1d',
    }, NOW);
    await handleRoom(storage, deps, { action: 'join', ...guest, name: 'Guest', secret: 'night', difficulty: 'medium' }, NOW);
    const conceded = await handleRoom(storage, deps, { action: 'concede', ...host }, NOW + 1000);
    expect(conceded.body).toMatchObject({ state: 'over' });
    expect(storage.data.get('room')).toMatchObject({ unsaved: true });
    expect(storage.alarm).toBe(NOW + 1000 + SAVE_RETRY_MS);
    // The other player's move meanwhile finds it over, as before.
    expect((await handleRoom(storage, deps, { action: 'concede', ...guest }, NOW + 2000)).status).toBe(409);

    await handleAlarm(storage, deps, NOW + 1000 + SAVE_RETRY_MS);
    expect(saves.done).toBe(1);
    expect((storage.data.get('room') as Room).unsaved).toBeUndefined();
    expect(storage.alarm).toBeNull();
  });
});

describe('a daily game', () => {
  it('finishes at once when saving the run fails, and the next request saves it', async () => {
    const storage = memoryStorage();
    const { saves, save } = flakySave(1);
    const deps: DailyDeps = {
      saveFinished: async () => {
        await save();
      },
      random: () => 0, themeFor: async () => null, wordFor: async () => 'brick', started: async () => {},
    };
    const day = dailyDay(NOW);
    const asker = { playerId: 'player-id', day, mode: 'dailyWord' as const };
    await handleDaily(storage, deps, { ...asker, action: 'start', name: 'Player', difficulty: 'medium' }, NOW);
    const found = await handleDaily(storage, deps, { ...asker, action: 'guess', word: 'brick' }, NOW + 1000);
    expect(found.body).toMatchObject({ run: { status: 'finished' } });
    expect(saves.done).toBe(0);
    // A second tap finds it over.
    expect((await handleDaily(storage, deps, { ...asker, action: 'guess', word: 'brick' }, NOW + 1500)).status).toBe(409);

    const looked = await handleDaily(storage, deps, { ...asker, action: 'get' }, NOW + 2000);
    expect(looked.body).toMatchObject({ run: { status: 'finished' } });
    expect(saves.done).toBe(1);
    expect(storage.data.get('word:player-id')).not.toHaveProperty('unsaved');
  });
});

describe('rating a game against a friend', () => {
  it('rates it once: asked again (a retry), it gives back the same changes', async () => {
    const { db } = fakeD1();
    const players = { host: 'host-account', guest: 'guest-account' };
    for (const id of Object.values(players)) {
      await db.prepare('INSERT INTO accounts (id, email, created_at) VALUES (?1, ?2, ?3)').bind(id, `${id}@example.com`, NOW).run();
    }
    const first = await rateFinishedGame(db, 'game', 'correspondence', players, 1, NOW);
    const again = await rateFinishedGame(db, 'game', 'correspondence', players, 1, NOW + 1000);
    expect(again.host.after.rating).toBeCloseTo(first.host.after.rating);
    expect(again.guest.after.rating).toBeCloseTo(first.guest.after.rating);
    const row = await db.prepare('SELECT games FROM ratings WHERE account_id = ?1').bind('host-account').first<{ games: number }>();
    expect(row?.games).toBe(1);
  });

  it('rates it once when two saves overlap', async () => {
    const { db } = fakeD1();
    const players = { host: 'host-account', guest: 'guest-account' };
    for (const id of Object.values(players)) {
      await db.prepare('INSERT INTO accounts (id, email, created_at) VALUES (?1, ?2, ?3)').bind(id, `${id}@example.com`, NOW).run();
    }
    // Both read the ratings before either writes, as two saves at once would.
    const [first, second] = await Promise.all([
      ratedGameChanges(db, 'correspondence', players, 1, NOW), ratedGameChanges(db, 'correspondence', players, 0, NOW),
    ]);
    await db.batch(ratingStatements(db, 'game', 'correspondence', first, NOW));
    await db.batch(ratingStatements(db, 'game', 'correspondence', second, NOW));
    const row = await db.prepare('SELECT games, rating FROM ratings WHERE account_id = ?1').bind('host-account')
      .first<{ games: number; rating: number }>();
    expect(row?.games).toBe(1);
    expect(row?.rating).toBeCloseTo(first[0].after.rating);
  });
});
