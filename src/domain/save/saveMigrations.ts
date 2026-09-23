import { err, ok, type Result } from '../../core/Result';
import { CURRENT_SAVE_VERSION } from './SaveGameData';

/** Facts a migration may need that old saves did not record. */
export interface SaveMigrationContext {
  /** The map saves were played on before they recorded one (v1 knew a single map). */
  readonly defaultMapId: string;
}

/** Plain parsed JSON of some save version. */
export type SaveJson = Readonly<Record<string, unknown>>;

/**
 * Turns a save of version `from` into version `from + 1` (spec §32; the spec's
 * ISaveMigration). Migrations never throw on odd data: validation afterwards
 * decides whether the result is usable.
 */
export interface SaveMigration {
  readonly from: number;
  migrate(save: SaveJson, context: SaveMigrationContext): SaveJson;
}

/** One migration per older version, applied in order up to CURRENT_SAVE_VERSION. */
export const SAVE_MIGRATIONS: readonly SaveMigration[] = [
  {
    // v2 records where the truck is parked, the contract under way and statistics.
    from: 1,
    migrate: (save, context) => ({
      ...save,
      version: 2,
      world: { mapId: context.defaultMapId, truck: null },
      missions: { active: null },
      stats: { deliveriesCompleted: 0, deliveriesFailed: 0, creditsEarned: 0, distanceDrivenMeters: 0 },
    }),
  },
  {
    // v3 records the upgrades fitted to each truck: the trucks of older saves have none.
    from: 2,
    migrate: (save) => {
      const garage = save['garage'];
      if (!isJsonObject(garage) || !Array.isArray(garage['vehicles'])) {
        return { ...save, version: 3 };
      }
      const vehicles = (garage['vehicles'] as unknown[]).map((vehicle) =>
        isJsonObject(vehicle) ? { ...vehicle, upgrades: {} } : vehicle,
      );
      return { ...save, version: 3, garage: { ...garage, vehicles } };
    },
  },
];

function isJsonObject(value: unknown): value is SaveJson {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** notASave: not an object with a version; tooNew: written by a newer build (never overwrite it); noMigration: a gap in the chain. */
export type MigrationError = 'notASave' | 'tooNew' | 'noMigration';

/**
 * Brings parsed save JSON up to CURRENT_SAVE_VERSION by running each
 * migration from its version on. It does not check the result: run
 * validateSaveGameData() on it.
 */
export function migrateSave(
  raw: unknown,
  context: SaveMigrationContext,
  migrations: readonly SaveMigration[] = SAVE_MIGRATIONS,
  targetVersion: number = CURRENT_SAVE_VERSION,
): Result<SaveJson, MigrationError> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err('notASave');
  }
  let save = raw as SaveJson;
  const version = save['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return err('notASave');
  }
  if (version > targetVersion) {
    return err('tooNew');
  }
  for (let current = version; current < targetVersion; current++) {
    const migration = migrations.find((candidate) => candidate.from === current);
    if (migration === undefined) {
      return err('noMigration');
    }
    save = migration.migrate(save, context);
    if (save['version'] !== current + 1) {
      throw new Error(`The save migration from v${current} must produce v${current + 1}.`);
    }
  }
  return ok(save);
}
