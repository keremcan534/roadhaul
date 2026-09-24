import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_VERSION } from '../../../../src/domain/save/SaveGameData';
import { migrateSave, SAVE_MIGRATIONS, type SaveMigration } from '../../../../src/domain/save/saveMigrations';

const context = { defaultMapId: 'north_valley' };

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
        version: 7,
        garage: {
          activeVehicleInstanceId: 'truck_001',
          vehicles: [{ instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 80, damage: 0.1, upgrades: {}, paintId: null }],
        },
        world: { mapId: 'north_valley', truck: null },
        missions: { active: null },
        stats: { deliveriesCompleted: 0, deliveriesFailed: 0, creditsEarned: 0, distanceDrivenMeters: 0 },
        events: { runs: [] },
        tutorial: { step: 'done' },
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

    const added = { events: { runs: [] }, tutorial: { step: 'done' }, garage: inFactoryColours(v3.garage) };
    expect(moved).toEqual({
      ok: true,
      value: { ...v3, version: 7, world: { mapId: 'north_valley', truck: null }, ...added },
    });
    expect(kept).toEqual({ ok: true, value: { ...elsewhere, version: 7, ...added } });
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
      value: { ...v4, version: 7, events: { runs: [] }, tutorial: { step: 'done' }, garage: inFactoryColours(v4.garage) },
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
      value: { ...v5, version: 7, tutorial: { step: 'done' }, garage: inFactoryColours(v5.garage) },
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
      value: { ...v6, version: 7, garage: inFactoryColours(v6.garage) },
    });
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
