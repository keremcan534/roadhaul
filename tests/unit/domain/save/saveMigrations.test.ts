import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_VERSION } from '../../../../src/domain/save/SaveGameData';
import { migrateSave, SAVE_MIGRATIONS, type SaveMigration } from '../../../../src/domain/save/saveMigrations';

const context = { defaultMapId: 'test_track' };

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
        version: 2,
        world: { mapId: 'test_track', truck: null },
        missions: { active: null },
        stats: { deliveriesCompleted: 0, deliveriesFailed: 0, creditsEarned: 0, distanceDrivenMeters: 0 },
      },
    });
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
