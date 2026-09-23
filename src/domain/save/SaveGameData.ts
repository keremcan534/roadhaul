import type { Credits, Fraction } from '../../data/units';

/**
 * Version of the save schema written by this build (spec §32).
 *
 * Any change to the shape of SaveGameData must bump this number and ship a
 * migration from the previous version, with a test. The migration pipeline
 * itself arrives with SaveService (roadmap step 18).
 */
export const CURRENT_SAVE_VERSION = 1;

/**
 * Root of the persisted game state. Plain JSON data only, with no classes,
 * Maps or Dates, so it survives JSON.stringify/parse unchanged. Definitions
 * are referenced by id and never embedded.
 */
export interface SaveGameData {
  readonly version: typeof CURRENT_SAVE_VERSION;
  /** Unix epoch milliseconds (UTC). */
  readonly createdAtMs: number;
  /** Unix epoch milliseconds (UTC). */
  readonly updatedAtMs: number;
  readonly profile: ProfileSaveData;
  readonly company: CompanySaveData;
  readonly economy: EconomySaveData;
  readonly garage: GarageSaveData;
}

export interface ProfileSaveData {
  readonly companyName: string;
}

export interface CompanySaveData {
  /** Company level, starting at 1 (spec §14). */
  readonly level: number;
  readonly xp: number;
  readonly reputation: number;
}

export interface EconomySaveData {
  readonly credits: Credits;
}

export interface GarageSaveData {
  /** instanceId of the truck the player drives. */
  readonly activeVehicleInstanceId: string;
  readonly vehicles: readonly VehicleSaveData[];
}

/** One owned truck. Two trucks of the same model have different instance ids. */
export interface VehicleSaveData {
  /** Unique within the save, e.g. "truck_001". */
  readonly instanceId: string;
  /** VehicleDefinition id. */
  readonly definitionId: string;
  readonly fuelLiters: number;
  readonly damage: Fraction;
}
