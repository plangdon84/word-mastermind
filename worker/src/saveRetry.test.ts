// A finished game whose save to D1 fails is never lost from the history
// (Dev Plan items 19m and 19zo): the room keeps it over, marked unsaved, and
// its alarm (or, for a daily game, the player's next request) saves it later;
// a lobby does the same, telling everyone once it's saved; a game is rated
// once however its saves overlap.
import { describe, expect, it } from 'vitest';
import { dailyDay, NEW_RATING } from '../../src/game';
import { handleDaily, type DailyDeps } from './dailyRoom';
import { handleLobby, handleLobbyAlarm, type LobbyDeps, type LobbyRoom } from './lobbyRoom';
import type { Notice } from './notices';
import { memoryStorage } from './fakeRooms';
import { SAVE_RETRY_MS } from './finishSave';
import { handleAlarm, handleRoom, type Room, type RoomDeps } from './room';
import { fakeD1 } from './fakeD1';
import { batchRated, rateFinishedGame, ratedGameChanges, rateGroupGame, ratingStatements, type PlayerChange } from './ratings';

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

describe("a daily game's save after its turn (2.7.2 review)", () => {
  const setup = () => {
    const storage = memoryStorage();
    const { saves, save } = flakySave(0);
    const later: (() => Promise<void>)[] = [];
    const deps: DailyDeps = {
      saveFinished: async () => {
        await save();
      },
      random: () => 0, themeFor: async () => null, wordFor: async () => 'brick', started: async () => {},
      afterTurn: (work) => later.push(work),
    };
    const day = dailyDay(NOW);
    const asker = { playerId: 'player-id', day, mode: 'dailyWord' as const };
    return { storage, saves, later, deps, asker };
  };

  it('answers the finishing guess with the run stored and marked, then saves it once the turn is over', async () => {
    const { storage, saves, later, deps, asker } = setup();
    await handleDaily(storage, deps, { ...asker, action: 'start', name: 'Player', difficulty: 'medium' }, NOW);
    expect(later).toHaveLength(0);
    const found = await handleDaily(storage, deps, { ...asker, action: 'guess', word: 'brick' }, NOW + 1000);
    expect(found.body).toMatchObject({ run: { status: 'finished' } });
    expect(saves.calls).toBe(0);
    expect(storage.data.get('word:player-id')).toMatchObject({ unsaved: true });
    // Another request during that time finds it over.
    expect((await handleDaily(storage, deps, { ...asker, action: 'guess', word: 'brick' }, NOW + 1100)).status).toBe(409);
    expect(later).toHaveLength(1);
    await later[0]();
    expect(saves.done).toBeGreaterThanOrEqual(1);
    expect(storage.data.get('word:player-id')).not.toHaveProperty('unsaved');
  });

  it('is still saved by the next request if the save after the turn fails', async () => {
    const storage = memoryStorage();
    const { saves, save } = flakySave(1);
    const later: (() => Promise<void>)[] = [];
    const deps: DailyDeps = {
      saveFinished: async () => {
        await save();
      },
      random: () => 0, themeFor: async () => null, wordFor: async () => 'brick', started: async () => {},
      afterTurn: (work) => later.push(work),
    };
    const asker = { playerId: 'player-id', day: dailyDay(NOW), mode: 'dailyWord' as const };
    await handleDaily(storage, deps, { ...asker, action: 'start', name: 'Player', difficulty: 'medium' }, NOW);
    await handleDaily(storage, deps, { ...asker, action: 'guess', word: 'brick' }, NOW + 1000);
    await later[0]();
    expect(saves.done).toBe(0);
    expect(storage.data.get('word:player-id')).toMatchObject({ unsaved: true });
    await handleDaily(storage, deps, { ...asker, action: 'get' }, NOW + 2000);
    expect(saves.done).toBe(1);
    expect(storage.data.get('word:player-id')).not.toHaveProperty('unsaved');
  });
});

describe('a Rush with Friends lobby', () => {
  it('ends when saving the finished game fails, then its alarm saves it and tells everyone once (Dev Plan item 19zo)', async () => {
    const storage = memoryStorage();
    const { saves, save } = flakySave(2);
    const told: Notice[][] = [];
    const deps: LobbyDeps = { random: () => 0, saveFinished: save, notify: (n) => { told.push([...n]); }, friendCodes: async () => ({}) };
    const ann = { playerId: 'ann-id' };
    const bob = { playerId: 'bob-id' };
    await handleLobby(storage, deps, { action: 'create', ...ann, code: 'ABCDEF', name: 'Ann', difficulty: 'medium' }, NOW);
    await handleLobby(storage, deps, { action: 'join', ...bob, name: 'Bob' }, NOW);
    await handleLobby(storage, deps, {
      action: 'settings', ...ann, settings: { difficulty: 'medium', minutes: 30, computers: 0, strength: 'skilled' },
    }, NOW);
    await handleLobby(storage, deps, { action: 'start', ...ann }, NOW);
    await handleLobby(storage, deps, { action: 'give-up', ...ann }, NOW + 1000);
    told.length = 0;
    // Bob giving up ends the game: D1 is down, but the move still answers, with the game over.
    const over = await handleLobby(storage, deps, { action: 'give-up', ...bob }, NOW + 2000);
    expect(over.status).toBe(200);
    expect(over.body).toMatchObject({ lobby: { state: 'over' } });
    expect(storage.data.get('lobby')).toMatchObject({ saved: false, alarmAt: NOW + 2000 + SAVE_RETRY_MS });
    expect(storage.alarm).toBe(NOW + 2000 + SAVE_RETRY_MS);
    expect(told).toEqual([]);
    // A look meanwhile tries again, and fails again: still nobody told.
    expect((await handleLobby(storage, deps, { action: 'get', ...ann }, NOW + 3000)).status).toBe(200);
    expect(storage.alarm).toBe(NOW + 3000 + SAVE_RETRY_MS);
    expect(told).toEqual([]);

    await handleLobbyAlarm(storage, deps, NOW + 3000 + SAVE_RETRY_MS);
    expect(saves.done).toBe(1);
    expect(storage.data.get('lobby')).toMatchObject({ saved: true, alarmAt: null });
    expect(storage.alarm).toBeNull();
    expect(told).toHaveLength(1);
    // Looking again saves nothing more and tells nobody again.
    await handleLobby(storage, deps, { action: 'get', ...bob }, NOW + 4000 + SAVE_RETRY_MS);
    expect(saves.calls).toBe(3);
    expect(told).toHaveLength(1);
    expect((storage.data.get('lobby') as LobbyRoom).announced).toEqual(['ann-id', 'bob-id']);
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

  it('counts both of a player\'s games that end together, working the later one out again (Dev Plan item 19zl)', async () => {
    const { db } = fakeD1();
    for (const id of ['ann', 'bob', 'cat']) {
      await db.prepare('INSERT INTO accounts (id, email, created_at) VALUES (?1, ?2, ?3)').bind(id, `${id}@example.com`, NOW).run();
    }
    const withBob = { host: 'ann', guest: 'bob' };
    const withCat = { host: 'ann', guest: 'cat' };
    // Both games read Ann's rating before either writes, as two rooms saving at once would.
    const [first, second] = await Promise.all([
      ratedGameChanges(db, 'correspondence', withBob, 1, NOW), ratedGameChanges(db, 'correspondence', withCat, 1, NOW),
    ]);
    await db.batch(ratingStatements(db, 'game-1', 'correspondence', first, NOW));
    // The later one is kept from a rating that's moved: nothing of it is kept.
    await db.batch(ratingStatements(db, 'game-2', 'correspondence', second, NOW));
    const ann = () => db.prepare('SELECT games, rating FROM ratings WHERE account_id = ?1').bind('ann')
      .first<{ games: number; rating: number }>();
    expect(await ann()).toMatchObject({ games: 1, rating: first[0].after.rating });
    expect(await db.prepare('SELECT 1 FROM rated_games WHERE game_id = ?1').bind('game-2').first()).toBeNull();
    expect(await db.prepare('SELECT 1 FROM ratings WHERE account_id = ?1').bind('cat').first()).toBeNull();
    // Saved again, it's worked out from Ann's rating now, after the first game.
    let tries = 0;
    const { kept } = await batchRated(db, 'game-2',
      async () => (++tries === 1 ? second : ratedGameChanges(db, 'correspondence', withCat, 1, NOW)),
      (changes) => ratingStatements(db, 'game-2', 'correspondence', changes, NOW));
    expect(tries).toBe(2);
    const now = await ann();
    expect(now?.games).toBe(2);
    expect(now!.rating).toBeGreaterThan(first[0].after.rating);
    expect(kept.ann.before.rating).toBeCloseTo(first[0].after.rating);
    expect(kept.ann.after.rating).toBeCloseTo(now!.rating);
    expect(kept.cat).toBeDefined();
  });

  it('gives up, to be saved again later, while the ratings keep changing', async () => {
    const { db } = fakeD1();
    const stale: PlayerChange[] = [{ accountId: 'ann', before: NEW_RATING, after: { ...NEW_RATING, rating: 1600 }, from: { games: 9, ratedAt: 0 } }];
    await expect(batchRated(db, 'game', async () => stale, (changes) => ratingStatements(db, 'game', 'correspondence', changes, NOW)))
      .rejects.toThrow('rating-changed');
    expect(await db.prepare('SELECT 1 FROM rated_games').first()).toBeNull();
  });

  it('works a Competitive Rush out again if a player\'s rating moved meanwhile', async () => {
    const { db } = fakeD1();
    for (const id of ['ann', 'bob', 'cat']) {
      await db.prepare('INSERT INTO accounts (id, email, created_at) VALUES (?1, ?2, ?3)').bind(id, `${id}@example.com`, NOW).run();
    }
    // Another Competitive Rush ends for Ann after the lobby read her rating, before its batch runs.
    const other = await ratedGameChanges(db, 'rush', { host: 'ann', guest: 'cat' }, 1, NOW);
    const batch = db.batch.bind(db);
    let raced = false;
    db.batch = (async (statements: D1PreparedStatement[]) => {
      if (!raced) {
        raced = true;
        await batch(ratingStatements(db, 'other', 'rush', other, NOW));
      }
      return batch(statements);
    }) as typeof db.batch;
    const changes = await rateGroupGame(db, 'lobby', 'rush', [{ accountId: 'ann', place: 1 }, { accountId: 'bob', place: 2 }], NOW);
    const row = await db.prepare('SELECT games, rating FROM ratings WHERE account_id = ?1').bind('ann')
      .first<{ games: number; rating: number }>();
    expect(row?.games).toBe(2);
    expect(changes.ann.before.rating).toBeCloseTo(other[0].after.rating);
    expect(row!.rating).toBeCloseTo(changes.ann.after.rating);
  });
});
