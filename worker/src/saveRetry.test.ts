// A finished game whose save to D1 fails is never left over in its room but
// missing from the history (Dev Plan item 19m): the move isn't kept, so
// making it again (or the alarm, retried) saves it.
import { describe, expect, it } from 'vitest';
import { dailyDay } from '../../src/game';
import { handleDaily, type DailyDeps } from './dailyRoom';
import { memoryStorage } from './fakeRooms';
import { handleRoom, type RoomDeps } from './room';
import { fakeD1 } from './fakeD1';
import { rateFinishedGame } from './ratings';

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
  it('keeps nothing when saving the finished game fails, and saves it when tried again', async () => {
    const storage = memoryStorage();
    const { saves, save } = flakySave(1);
    const deps: RoomDeps = {
      saveFinished: save, namesOf: async () => ({}), friendCodes: async () => ({}),
      ratingsOf: async () => { throw new Error('unrated'); }, random: () => 0, notify: () => {}, played: async () => {},
    };
    const host = { guestId: 'host-id' };
    const guest = { guestId: 'guest-id' };
    await handleRoom(storage, deps, {
      action: 'create', id: 'room', ...host, name: 'Host', secret: 'brick', difficulty: 'medium', timeControl: '1d',
    }, NOW);
    await handleRoom(storage, deps, { action: 'join', ...guest, name: 'Guest', secret: 'night', difficulty: 'medium' }, NOW);
    await expect(handleRoom(storage, deps, { action: 'concede', ...host }, NOW + 1000)).rejects.toThrow('D1 is down');
    const stillOn = await handleRoom(storage, deps, { action: 'get', ...host }, NOW + 2000);
    expect(stillOn.body).toMatchObject({ state: 'playing' });
    expect(storage.alarm).not.toBeNull();

    const conceded = await handleRoom(storage, deps, { action: 'concede', ...host }, NOW + 3000);
    expect(conceded.body).toMatchObject({ state: 'over' });
    expect(saves.done).toBe(1);
    expect(storage.alarm).toBeNull();
  });
});

describe('a daily game', () => {
  it('keeps nothing when saving the finished run fails, and saves it when tried again', async () => {
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
    await expect(handleDaily(storage, deps, { ...asker, action: 'guess', word: 'brick' }, NOW + 1000)).rejects.toThrow('D1 is down');
    const stillOn = await handleDaily(storage, deps, { ...asker, action: 'get' }, NOW + 2000);
    expect(stillOn.body).toMatchObject({ run: { status: 'playing' } });

    const found = await handleDaily(storage, deps, { ...asker, action: 'guess', word: 'brick' }, NOW + 3000);
    expect(found.body).toMatchObject({ run: { status: 'finished' } });
    expect(saves.done).toBe(1);
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
});
