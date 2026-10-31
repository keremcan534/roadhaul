import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_VERSION } from '../../../../src/domain/save/SaveGameData';
import { migrateSave, SAVE_MIGRATIONS, type SaveMigration } from '../../../../src/domain/save/saveMigrations';

const context = { defaultMapId: 'north_valley' };

/** The fleet of a company from a build before v9: nobody hired yet. */
const NO_FLEET = { drivers: [], jobsPlanned: 0 };
/** The rivals of a company from a build before v10: they start out afresh when it is loaded. */
const NEW_RIVALS = {
  companies: [],
  standing: [],
  campaignCooldowns: [],
  tender: null,
  race: null,
  nextTenderSeconds: null,
  tendersPosted: 0,
  jobsPlanned: 0,
};
/** The facilities of a company from a build before v11: none built. */
const NO_FACILITIES = { levels: {} };
/** The daily reward of a company from a build before v12: never claimed. */
const NO_DAILY = { lastClaimDay: null, streak: 0 };
/** The goals of a company from a build before v13, which recorded nothing of them. */
const NO_GOALS = { counters: {}, claimed: [] };
/** The crates of a company from a build before v14: none, no streak. */
const NO_CRATES = { held: {}, opened: 0, paints: [], liveries: [], perfectStreak: 0, bestPerfectStreak: 0, freeCrateAtMs: 0 };
/** The designs of a company from a build before v16: the classic everywhere. */
const NO_LIVERIES = { bought: [], worn: {}, text: null };
const NO_RESEARCH = { points: 0, researched: [] };
/** What crates gave and the day's quests of a company from a build before v15: none. */
const NO_SUPPLIES = { parts: 0, boosters: {}, payBoostLeft: 0, xpBoostLeft: 0 };
const NO_QUESTS = { day: null, counts: {}, distanceStartMeters: 0, claimed: [], bonusClaimed: false };
/** The level rewards of a company from a build before v14 (level 2, as every save here): its levels count as collected. */
const LEVELS_COLLECTED = { rewardedLevel: 2 };

/** A garage as v7 has it: every truck in its factory colour. */
function inFactoryColours<T extends { vehicles: readonly object[] }>(garage: T): T {
  return { ...garage, vehicles: garage.vehicles.map((vehicle) => ({ ...vehicle, paintId: null })) };
}

/** A save as build v1 wrote it. */
const V1_SAVE = {
  version: 1,
  createdAtMs: 1000,
  updatedAtMs: 2000,
  profile: { companyName: 'Kuzey Lojistik' },
  company: { level: 2, xp: 1500, reputation: 12 },
  economy: { credits: 7300 },
  garage: {
    activeVehicleInstanceId: 'truck_001',
    vehicles: [{ instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 80, damage: 0.1 }],
  },
};

describe('save migrations', () => {
  it('has one migration for every older version, each producing the next', () => {
    const froms = SAVE_MIGRATIONS.map((migration) => migration.from);
    expect(froms).toEqual(Array.from({ length: CURRENT_SAVE_VERSION - 1 }, (_, index) => index + 1));
  });

  it('brings a v1 save to the current version, keeping everything it had', () => {
    const migrated = migrateSave(V1_SAVE, context);

    expect(migrated).toEqual({
      ok: true,
      value: {
        ...V1_SAVE,
        version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH,
        garage: {
          activeVehicleInstanceId: 'truck_001',
          vehicles: [{ instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 80, damage: 0.1, upgrades: {}, paintId: null }],
        },
        world: { mapId: 'north_valley', truck: null },
        missions: { active: null },
        stats: { deliveriesCompleted: 0, deliveriesFailed: 0, creditsEarned: 0, distanceDrivenMeters: 0 },
        events: { runs: [] },
        tutorial: { step: 'done' },
        fleet: NO_FLEET, rivals: NEW_RIVALS, facilities: NO_FACILITIES, daily: NO_DAILY, achievements: NO_GOALS,
      },
    });
  });

  it('gives every truck of a v2 save an empty set of upgrades', () => {
    const v2 = {
      ...V1_SAVE,
      version: 2,
      garage: {
        activeVehicleInstanceId: 'truck_002',
        vehicles: [
          { instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 80, damage: 0.1 },
          { instanceId: 'truck_002', definitionId: 'rh_h2', fuelLiters: 200, damage: 0 },
        ],
      },
      world: { mapId: 'north_valley', truck: { x: 1, z: 2, headingRadians: 3 } },
      missions: { active: null },
      stats: { deliveriesCompleted: 4, deliveriesFailed: 1, creditsEarned: 5200, distanceDrivenMeters: 9000 },
    };

    const migrated = migrateSave(v2, context);

    expect(migrated.ok && migrated.value['garage']).toEqual({
      activeVehicleInstanceId: 'truck_002',
      vehicles: [
        { instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 80, damage: 0.1, upgrades: {}, paintId: null },
        { instanceId: 'truck_002', definitionId: 'rh_h2', fuelLiters: 200, damage: 0, upgrades: {}, paintId: null },
      ],
    });
    expect(migrated.ok && migrated.value['stats']).toEqual(v2.stats);
  });

  it('moves a save from the retired test track to the start of the region, keeping the rest', () => {
    const v3 = {
      ...V1_SAVE,
      version: 3,
      garage: {
        activeVehicleInstanceId: 'truck_001',
        vehicles: [{ instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 80, damage: 0.1, upgrades: { engine: 1 } }],
      },
      world: { mapId: 'test_track', truck: { x: 55, z: -330, headingRadians: 1.8 } },
      missions: {
        active: {
          missionId: 'first_package',
          state: 'delivering',
          handlingSeconds: 0,
          deliverySeconds: 12,
          cargoDamage: 0,
          failureReason: null,
        },
      },
      stats: { deliveriesCompleted: 4, deliveriesFailed: 1, creditsEarned: 5200, distanceDrivenMeters: 9000 },
    };
    const elsewhere = { ...v3, world: { mapId: 'north_valley', truck: { x: 1, z: 2, headingRadians: 3 } } };

    const moved = migrateSave(v3, { defaultMapId: 'north_valley' });
    const kept = migrateSave(elsewhere, { defaultMapId: 'north_valley' });

    const added = {
      events: { runs: [] },
      tutorial: { step: 'done' },
      garage: inFactoryColours(v3.garage),
      // The contract under way is one of the game's own.
      missions: { active: { ...v3.missions.active, contract: null } },
      fleet: NO_FLEET, rivals: NEW_RIVALS, facilities: NO_FACILITIES, daily: NO_DAILY,
      // The upgrade fitted counts toward the goals.
      achievements: { counters: { upgradesFitted: 1 }, claimed: [] },
    };
    expect(moved).toEqual({
      ok: true,
      value: { ...v3, version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH, world: { mapId: 'north_valley', truck: null }, ...added },
    });
    expect(kept).toEqual({ ok: true, value: { ...elsewhere, version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH, ...added } });
  });

  it('starts the events of a v4 save with no progress, keeping the rest', () => {
    const v4 = {
      ...V1_SAVE,
      version: 4,
      garage: {
        activeVehicleInstanceId: 'truck_001',
        vehicles: [{ instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 80, damage: 0.1, upgrades: { engine: 2 } }],
      },
      world: { mapId: 'north_valley', truck: { x: 1, z: 2, headingRadians: 3 } },
      missions: { active: null },
      stats: { deliveriesCompleted: 4, deliveriesFailed: 1, creditsEarned: 5200, distanceDrivenMeters: 9000 },
    };

    expect(migrateSave(v4, context)).toEqual({
      ok: true,
      value: {
        ...v4,
        version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH,
        events: { runs: [] },
        tutorial: { step: 'done' },
        garage: inFactoryColours(v4.garage),
        fleet: NO_FLEET, rivals: NEW_RIVALS, facilities: NO_FACILITIES, daily: NO_DAILY,
        achievements: { counters: { upgradesFitted: 2 }, claimed: [] },
      },
    });
  });

  it('spares companies from older builds the tutorial: they have been played', () => {
    const v5 = {
      ...V1_SAVE,
      version: 5,
      garage: {
        activeVehicleInstanceId: 'truck_001',
        vehicles: [{ instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 80, damage: 0.1, upgrades: {} }],
      },
      world: { mapId: 'north_valley', truck: null },
      missions: { active: null },
      stats: { deliveriesCompleted: 0, deliveriesFailed: 0, creditsEarned: 0, distanceDrivenMeters: 0 },
      events: { runs: [{ eventId: 'safe_driver', edition: 18, progress: 1, rewarded: false }] },
    };

    expect(migrateSave(v5, context)).toEqual({
      ok: true,
      value: { ...v5, version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH, tutorial: { step: 'done' }, garage: inFactoryColours(v5.garage), fleet: NO_FLEET, rivals: NEW_RIVALS, facilities: NO_FACILITIES, daily: NO_DAILY, achievements: NO_GOALS },
    });
  });

  it('keeps the trucks of a v6 save in their factory colours, and the rest as it was', () => {
    const v6 = {
      ...V1_SAVE,
      version: 6,
      garage: {
        activeVehicleInstanceId: 'truck_002',
        vehicles: [
          { instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 80, damage: 0.1, upgrades: { engine: 1 } },
          { instanceId: 'truck_002', definitionId: 'rh_h2', fuelLiters: 200, damage: 0, upgrades: {} },
        ],
      },
      world: { mapId: 'north_valley', truck: { x: 1, z: 2, headingRadians: 3 } },
      missions: { active: null },
      stats: { deliveriesCompleted: 3, deliveriesFailed: 0, creditsEarned: 4000, distanceDrivenMeters: 8000 },
      events: { runs: [] },
      tutorial: { step: 'buyUpgrade' },
    };

    expect(migrateSave(v6, context)).toEqual({
      ok: true,
      value: {
        ...v6,
        version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH,
        garage: inFactoryColours(v6.garage),
        fleet: NO_FLEET, rivals: NEW_RIVALS, facilities: NO_FACILITIES, daily: NO_DAILY,
        achievements: { counters: { upgradesFitted: 1 }, claimed: [] },
      },
    });
  });

  it('keeps the contract under way of a v7 save as one of the game\'s own, and the rest as it was', () => {
    const v7 = {
      ...V1_SAVE,
      version: 7,
      garage: {
        activeVehicleInstanceId: 'truck_001',
        vehicles: [{ instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 80, damage: 0.1, upgrades: {}, paintId: 'ocean_blue' }],
      },
      world: { mapId: 'north_valley', truck: { x: 1, z: 2, headingRadians: 3 } },
      missions: {
        active: {
          missionId: 'first_package',
          state: 'delivering',
          handlingSeconds: 0,
          deliverySeconds: 12,
          cargoDamage: 0,
          failureReason: null,
        },
      },
      stats: { deliveriesCompleted: 3, deliveriesFailed: 0, creditsEarned: 4000, distanceDrivenMeters: 8000 },
      events: { runs: [] },
      tutorial: { step: 'done' },
    };
    const idle = { ...v7, missions: { active: null } };

    expect(migrateSave(v7, context)).toEqual({
      ok: true,
      value: { ...v7, version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH, missions: { active: { ...v7.missions.active, contract: null } }, fleet: NO_FLEET, rivals: NEW_RIVALS, facilities: NO_FACILITIES, daily: NO_DAILY, achievements: NO_GOALS },
    });
    expect(migrateSave(idle, context)).toEqual({ ok: true, value: { ...idle, version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH, fleet: NO_FLEET, rivals: NEW_RIVALS, facilities: NO_FACILITIES, daily: NO_DAILY, achievements: NO_GOALS } });
  });

  it('gives a v8 company a fleet with nobody hired yet, and keeps the rest as it was', () => {
    const v8 = {
      ...V1_SAVE,
      version: 8,
      garage: {
        activeVehicleInstanceId: 'truck_001',
        vehicles: [
          { instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 80, damage: 0.1, upgrades: {}, paintId: null },
          { instanceId: 'truck_002', definitionId: 'rh_h2', fuelLiters: 250, damage: 0, upgrades: {}, paintId: 'amber' },
        ],
      },
      world: { mapId: 'north_valley', truck: { x: 1, z: 2, headingRadians: 3 } },
      missions: { active: null },
      stats: { deliveriesCompleted: 3, deliveriesFailed: 0, creditsEarned: 4000, distanceDrivenMeters: 8000 },
      events: { runs: [] },
      tutorial: { step: 'done' },
    };

    expect(migrateSave(v8, context)).toEqual({ ok: true, value: { ...v8, version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH, fleet: NO_FLEET, rivals: NEW_RIVALS, facilities: NO_FACILITIES, daily: NO_DAILY, achievements: NO_GOALS } });
  });

  it('gives a v9 company rivals that start out afresh, and keeps the rest, its fleet too, as it was', () => {
    const v9 = {
      ...V1_SAVE,
      version: 9,
      garage: {
        activeVehicleInstanceId: 'truck_001',
        vehicles: [
          { instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 80, damage: 0.1, upgrades: {}, paintId: null },
          { instanceId: 'truck_002', definitionId: 'rh_h1', fuelLiters: 120, damage: 0, upgrades: {}, paintId: null },
        ],
      },
      world: { mapId: 'north_valley', truck: null },
      missions: { active: null },
      stats: { deliveriesCompleted: 3, deliveriesFailed: 0, creditsEarned: 4000, distanceDrivenMeters: 8000 },
      events: { runs: [] },
      tutorial: { step: 'done' },
      fleet: {
        drivers: [
          {
            driverId: 'driver_kemal',
            truckInstanceId: 'truck_002',
            cityId: 'city_a',
            job: null,
            repairSecondsLeft: 0,
            jobsCompleted: 4,
            creditsEarned: 3200,
          },
        ],
        jobsPlanned: 5,
      },
    };

    expect(migrateSave(v9, context)).toEqual({ ok: true, value: { ...v9, version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH, rivals: NEW_RIVALS, facilities: NO_FACILITIES, daily: NO_DAILY, achievements: NO_GOALS } });
  });

  it('gives a v10 company no facilities yet, and keeps the rest, its fleet and rivals too, as it was', () => {
    const v10 = {
      ...V1_SAVE,
      version: 10,
      fleet: { drivers: [], jobsPlanned: 3 },
      rivals: { ...NEW_RIVALS, tendersPosted: 2, jobsPlanned: 7 },
    };

    expect(migrateSave(v10, context)).toEqual({ ok: true, value: { ...v10, version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH, facilities: NO_FACILITIES, daily: NO_DAILY, achievements: NO_GOALS } });
  });

  it('gives a v12 company goals counted from what its save shows, none collected, and keeps the rest as it was', () => {
    const v12 = {
      ...V1_SAVE,
      version: 12,
      garage: {
        activeVehicleInstanceId: 'truck_001',
        vehicles: [
          { instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 100, damage: 0, upgrades: { engine: 2, brakes: 1 }, paintId: null },
          { instanceId: 'truck_002', definitionId: 'rh_h2', fuelLiters: 100, damage: 0, upgrades: { tyres: 3 }, paintId: null },
        ],
      },
      fleet: NO_FLEET,
      rivals: { ...NEW_RIVALS, companies: [{ rivalId: 'a', acquired: true }, { rivalId: 'b', acquired: false }] },
      facilities: NO_FACILITIES,
      daily: { lastClaimDay: 20_000, streak: 4 },
    };

    expect(migrateSave(v12, context)).toEqual({
      ok: true,
      value: { ...v12, version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH, achievements: { counters: { dailyStreak: 4, upgradesFitted: 6, rivalsBoughtOut: 1 }, claimed: [] } },
    });
  });

  it('gives a v11 company a daily reward never claimed, and keeps the rest, its facilities too, as it was', () => {
    const v11 = {
      ...V1_SAVE,
      version: 11,
      fleet: NO_FLEET,
      rivals: NEW_RIVALS,
      facilities: { levels: { workshop: 2 } },
    };

    expect(migrateSave(v11, context)).toEqual({ ok: true, value: { ...v11, version: 17, crates: NO_CRATES, levelRewards: LEVELS_COLLECTED, supplies: NO_SUPPLIES, quests: NO_QUESTS, liveries: NO_LIVERIES, research: NO_RESEARCH, daily: NO_DAILY, achievements: NO_GOALS } });
  });

  it('gives a v13 company no crates yet, counts the levels it has as collected, and keeps the rest as it was', () => {
    const v13 = { ...V1_SAVE, version: 13, company: { level: 5, xp: 41_000, reputation: 80 }, achievements: NO_GOALS };

    // Its XP reaches level 8 now; the levels above the fifth wait to be collected.
    expect(migrateSave(v13, context)).toEqual({
      ok: true,
      value: {
        ...v13,
        version: 17,
        crates: NO_CRATES,
        levelRewards: { rewardedLevel: 5 },
        supplies: NO_SUPPLIES,
        quests: NO_QUESTS,
        liveries: NO_LIVERIES, research: NO_RESEARCH,
      },
    });
    expect(migrateSave({ ...v13, company: 'odd' }, context)).toMatchObject({ ok: true, value: { levelRewards: { rewardedLevel: 1 } } });
  });

  it('gives a v14 company its free crate now, no supplies and no quests yet, and keeps its crates as they were', () => {
    const crates = { held: { gold: 2 }, opened: 4, paints: ['aurora_green'], perfectStreak: 3, bestPerfectStreak: 7 };
    const v14 = { ...V1_SAVE, version: 14, crates, levelRewards: { rewardedLevel: 2 } };

    expect(migrateSave(v14, context)).toEqual({
      ok: true,
      value: {
        ...v14,
        version: 17,
        crates: { ...crates, freeCrateAtMs: 0, liveries: [] },
        supplies: NO_SUPPLIES,
        quests: NO_QUESTS,
        liveries: NO_LIVERIES, research: NO_RESEARCH,
      },
    });
  });

  it('gives a v15 company the classic on every truck, and its crates no designs yet', () => {
    const crates = { held: {}, opened: 0, paints: [], perfectStreak: 0, bestPerfectStreak: 0, freeCrateAtMs: 5 };
    const v15 = { ...V1_SAVE, version: 15, crates };

    expect(migrateSave(v15, context)).toEqual({ ok: true, value: { ...v15, version: 17, crates: { ...crates, liveries: [] }, liveries: NO_LIVERIES, research: NO_RESEARCH } });
  });

  it('gives a v16 company the research tree, nothing researched and no points yet', () => {
    const v16 = { ...V1_SAVE, version: 16, liveries: { bought: ['speed'], worn: {}, text: 'KUZEY' } };

    expect(migrateSave(v16, context)).toEqual({ ok: true, value: { ...v16, version: 17, research: NO_RESEARCH } });
  });

  it('migrates odd data without throwing, leaving it to validation', () => {
    for (const garage of [undefined, null, 'garage', { vehicles: 'none' }, { vehicles: [null, 7] }]) {
      const migrated = migrateSave({ ...V1_SAVE, version: 2, garage }, context);
      expect(migrated.ok && migrated.value['version'], JSON.stringify(garage)).toBe(CURRENT_SAVE_VERSION);
    }
  });

  it('leaves a current save alone', () => {
    const current = { ...V1_SAVE, version: CURRENT_SAVE_VERSION };

    expect(migrateSave(current, context)).toEqual({ ok: true, value: current });
  });

  it('refuses saves from a newer build instead of guessing', () => {
    expect(migrateSave({ ...V1_SAVE, version: CURRENT_SAVE_VERSION + 1 }, context)).toEqual({
      ok: false,
      error: 'tooNew',
    });
  });

  it('recognises data that is not a save', () => {
    for (const raw of [null, 42, 'save', [V1_SAVE], {}, { version: 0 }, { version: 1.5 }, { version: '1' }]) {
      expect(migrateSave(raw, context), JSON.stringify(raw)).toEqual({ ok: false, error: 'notASave' });
    }
  });

  it('reports a gap in the migration chain, and a migration that skips a version as a bug', () => {
    const skipping: SaveMigration = { from: 1, migrate: (save) => ({ ...save, version: 3 }) };

    expect(migrateSave(V1_SAVE, context, [], 2)).toEqual({ ok: false, error: 'noMigration' });
    expect(() => migrateSave(V1_SAVE, context, [skipping], 3)).toThrow('must produce v2');
  });
});
