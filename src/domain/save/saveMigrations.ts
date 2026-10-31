import { err, ok, type Result } from '../../core/Result';
import { CURRENT_SAVE_VERSION } from './SaveGameData';

/** Facts a migration may need that old saves did not record. */
export interface SaveMigrationContext {
  /** Where saves go that name no map (v1 knew a single one) or a retired map: the game's starting map. */
  readonly defaultMapId: string;
}

/** The miniature test track of roadmap step 08, replaced by the 3-city region in step 21. */
export const RETIRED_TEST_TRACK_ID = 'test_track';

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
  {
    // v4 retires the test track: a truck parked on it starts again at the region's spawn,
    // with its company, garage and any contract under way.
    from: 3,
    migrate: (save, context) => {
      const world = save['world'];
      const onTestTrack = isJsonObject(world) && world['mapId'] === RETIRED_TEST_TRACK_ID;
      return onTestTrack
        ? { ...save, version: 4, world: { mapId: context.defaultMapId, truck: null } }
        : { ...save, version: 4 };
    },
  },
  {
    // v5 records the progress in events, which older builds did not have.
    from: 4,
    migrate: (save) => ({ ...save, version: 5, events: { runs: [] } }),
  },
  {
    // v6 records the tutorial's step. Companies from older builds have been played: no tutorial for them.
    from: 5,
    migrate: (save) => ({ ...save, version: 6, tutorial: { step: 'done' } }),
  },
  {
    // v7 records each truck's paint: older trucks keep their factory colour.
    from: 6,
    migrate: (save) => {
      const garage = save['garage'];
      if (!isJsonObject(garage) || !Array.isArray(garage['vehicles'])) {
        return { ...save, version: 7 };
      }
      const vehicles = (garage['vehicles'] as unknown[]).map((vehicle) =>
        isJsonObject(vehicle) ? { ...vehicle, paintId: null } : vehicle,
      );
      return { ...save, version: 7, garage: { ...garage, vehicles } };
    },
  },
  {
    // v8 keeps a generated contract with the save: every contract before it was one of the game's own.
    from: 7,
    migrate: (save) => {
      const missions = save['missions'];
      if (!isJsonObject(missions) || !isJsonObject(missions['active'])) {
        return { ...save, version: 8 };
      }
      return { ...save, version: 8, missions: { ...missions, active: { ...missions['active'], contract: null } } };
    },
  },
  {
    // v9 adds the fleet: companies from older builds have hired nobody yet.
    from: 8,
    migrate: (save) => ({ ...save, version: 9, fleet: { drivers: [], jobsPlanned: 0 } }),
  },
  {
    // v10 adds the rivals: they start out afresh, and the first tender is due soon.
    from: 9,
    migrate: (save) => ({
      ...save,
      version: 10,
      rivals: {
        companies: [],
        standing: [],
        campaignCooldowns: [],
        tender: null,
        race: null,
        nextTenderSeconds: null,
        tendersPosted: 0,
        jobsPlanned: 0,
      },
    }),
  },
  {
    // v11 adds the facilities: companies from older builds have built none yet.
    from: 10,
    migrate: (save) => ({ ...save, version: 11, facilities: { levels: {} } }),
  },
  {
    // v12 adds the daily reward: no streak yet, the first claim is day 1.
    from: 11,
    migrate: (save) => ({ ...save, version: 12, daily: { lastClaimDay: null, streak: 0 } }),
  },
  {
    // v13 adds the company's goals: their counts start from what the save shows already (the daily streak, the
    // upgrade levels fitted, the rivals bought out); what it never recorded starts from 0. No reward collected yet.
    from: 12,
    migrate: (save) => ({ ...save, version: 13, achievements: { counters: countersFrom(save), claimed: [] } }),
  },
  {
    // v14 adds the crates (none yet, no streak) and the levels' rewards: the levels the company already has were
    // reached before there were any, so they count as collected; the ones its XP reaches above them (the levels
    // beyond the fifth came with v14) wait to be collected.
    from: 13,
    migrate: (save) => ({
      ...save,
      version: 14,
      crates: { held: {}, opened: 0, paints: [], perfectStreak: 0, bestPerfectStreak: 0 },
      levelRewards: { rewardedLevel: savedLevel(save) },
    }),
  },
  {
    // v15 adds the free crate (ready now), the supplies crates give (none yet) and the day's quests (none started).
    from: 14,
    migrate: (save) => ({
      ...save,
      version: 15,
      crates: { ...(isJsonObject(save['crates']) ? save['crates'] : {}), freeCrateAtMs: 0 },
      supplies: { parts: 0, boosters: {}, payBoostLeft: 0, xpBoostLeft: 0 },
      quests: { day: null, counts: {}, distanceStartMeters: 0, claimed: [], bonusClaimed: false },
    }),
  },
  {
    // v16 adds the designs: every truck in the classic, none bought or given by a crate, the RoadHaul lettering.
    from: 15,
    migrate: (save) => ({
      ...save,
      version: 16,
      crates: { ...(isJsonObject(save['crates']) ? save['crates'] : {}), liveries: [] },
      liveries: { bought: [], worn: {}, text: null },
    }),
  },
  {
    // v17 adds the research tree: nothing researched, no points yet.
    from: 16,
    migrate: (save) => ({ ...save, version: 17, research: { points: 0, researched: [] } }),
  },
];

/** The company level a v13 save holds, or 1. */
function savedLevel(save: SaveJson): number {
  const company = save['company'];
  const level = isJsonObject(company) ? company['level'] : null;
  return typeof level === 'number' && Number.isInteger(level) && level >= 1 ? level : 1;
}

/** What a v12 save already shows of what the goals count. */
function countersFrom(save: SaveJson): Record<string, number> {
  const count = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0);
  const daily = save['daily'];
  const garage = save['garage'];
  const rivals = save['rivals'];
  let upgradesFitted = 0;
  if (isJsonObject(garage) && Array.isArray(garage['vehicles'])) {
    for (const vehicle of garage['vehicles'] as unknown[]) {
      const upgrades = isJsonObject(vehicle) ? vehicle['upgrades'] : null;
      if (isJsonObject(upgrades)) {
        for (const level of Object.values(upgrades)) {
          upgradesFitted += count(level);
        }
      }
    }
  }
  let rivalsBoughtOut = 0;
  if (isJsonObject(rivals) && Array.isArray(rivals['companies'])) {
    rivalsBoughtOut = (rivals['companies'] as unknown[]).filter((rival) => isJsonObject(rival) && rival['acquired'] === true).length;
  }
  const counters: Record<string, number> = {};
  const streak = isJsonObject(daily) ? count(daily['streak']) : 0;
  for (const [metric, value] of [
    ['dailyStreak', streak],
    ['upgradesFitted', upgradesFitted],
    ['rivalsBoughtOut', rivalsBoughtOut],
  ] as const) {
    if (value > 0) {
      counters[metric] = value;
    }
  }
  return counters;
}

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
