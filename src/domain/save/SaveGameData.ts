import type { Credits, Fraction } from '../../data/units';
import type { MissionFailureReason, MissionState } from '../missions/MissionInstance';
import type { TutorialStep } from '../tutorial/tutorialSteps';

/**
 * Version of the save schema written by this build (spec §32).
 *
 * Any change to the shape of SaveGameData must bump this number and add a
 * migration from the previous version to `SAVE_MIGRATIONS`, with a test.
 *
 * - v1: profile, company, economy, garage.
 * - v2: adds world (where the truck is parked), missions (the contract under
 *   way) and stats.
 * - v3: adds the upgrades fitted to each truck.
 * - v4: same shape; the test track is retired, and saves on it move to the
 *   start of the 3-city region.
 * - v5: adds events (the progress in each event's latest run).
 * - v6: adds the tutorial's step.
 * - v7: adds each truck's paint.
 */
export const CURRENT_SAVE_VERSION = 7;

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
  readonly world: WorldSaveData;
  readonly missions: MissionsSaveData;
  readonly stats: StatsSaveData;
  readonly events: EventsSaveData;
  readonly tutorial: TutorialSaveData;
}

export interface ProfileSaveData {
  readonly companyName: string;
}

export interface CompanySaveData {
  /** Company level, starting at 1 (spec §14). */
  readonly level: number;
  readonly xp: number;
  /** Never below 0. */
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
  /** UpgradeDefinition id → fitted level (1 is the first). Upgrades not listed are not fitted. */
  readonly upgrades: Readonly<Record<string, number>>;
  /** PaintDefinition id; null for the model's factory colour. */
  readonly paintId: string | null;
}

export interface WorldSaveData {
  /** MapDefinition id the active truck is on. */
  readonly mapId: string;
  /** Where the active truck is parked; null puts it at the map's spawn. */
  readonly truck: TruckPlacementSaveData | null;
}

export interface TruckPlacementSaveData {
  /** Rear-axle position, meters. */
  readonly x: number;
  readonly z: number;
  /** 0 faces +Z, π/2 faces +X. */
  readonly headingRadians: number;
}

export interface MissionsSaveData {
  /** The contract under way, or null. */
  readonly active: ActiveMissionSaveData | null;
}

/** A saved MissionInstance (see src/domain/missions/MissionInstance.ts). */
export interface ActiveMissionSaveData {
  /** MissionDefinition id. */
  readonly missionId: string;
  readonly state: MissionState;
  readonly handlingSeconds: number;
  readonly deliverySeconds: number;
  readonly cargoDamage: Fraction;
  readonly failureReason: MissionFailureReason | null;
}

export interface TutorialSaveData {
  /** The step the company is on; `done` once finished or skipped (spec §41). */
  readonly step: TutorialStep;
}

export interface EventsSaveData {
  /** At most one per event: its latest run the company took part in. */
  readonly runs: readonly EventRunSaveData[];
}

/** The company's progress in one run of an event (spec §32 EventState). */
export interface EventRunSaveData {
  /** EventDefinition id. */
  readonly eventId: string;
  /** Which run: 0 for the first. A later run starts from nothing. */
  readonly edition: number;
  /** Toward the objective: deliveries, or credits. */
  readonly progress: number;
  /** The objective was met and the reward paid. */
  readonly rewarded: boolean;
}

export interface StatsSaveData {
  readonly deliveriesCompleted: number;
  readonly deliveriesFailed: number;
  /** Credits earned from deliveries, before costs. */
  readonly creditsEarned: Credits;
  readonly distanceDrivenMeters: number;
}
