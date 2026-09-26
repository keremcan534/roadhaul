import type { MissionDefinition } from '../../data/definitions/MissionDefinition';
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
 * - v8: the contract under way keeps its own definition when it was
 *   generated (a contract of the day).
 * - v9: adds the fleet (the hired drivers, the trucks they drive and their
 *   contracts under way).
 * - v10: adds the rivals (the rival companies and their trucks, everyone's
 *   standing in the cities, campaigns, and tenders).
 */
export const CURRENT_SAVE_VERSION = 10;

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
  readonly fleet: FleetSaveData;
  readonly rivals: RivalsSaveData;
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
  /**
   * A generated contract (a contract of the day) itself: the generator moves
   * on to new batches, so the save keeps it. Null for the game's own
   * contracts, found by `missionId` in the content.
   */
  readonly contract: MissionDefinition | null;
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

/** The company's fleet (spec §27): its hired drivers and what they are doing. */
export interface FleetSaveData {
  /** In the order they were hired. */
  readonly drivers: readonly HiredDriverSaveData[];
  /** Fleet contracts planned so far: the next one's number seeds it (fleetJobSeed). */
  readonly jobsPlanned: number;
}

/** A driver the company employs. */
export interface HiredDriverSaveData {
  /** DriverDefinition id. */
  readonly driverId: string;
  /** The garage truck (instanceId) they drive, or null while they wait at the HQ for one. */
  readonly truckInstanceId: string | null;
  /** CityDefinition id of the city they are in, or left last. */
  readonly cityId: string;
  /** The contract under way, or null. */
  readonly job: FleetJobSaveData | null;
  /** Seconds their truck has left in the workshop; 0 when it is not there. */
  readonly repairSecondsLeft: number;
  readonly jobsCompleted: number;
  /** What their contracts brought the company after their share and the fuel (below 0 if they lost money). */
  readonly creditsEarned: Credits;
}

/** A fleet contract under way (src/domain/fleet/fleetJobs.ts FleetJob) and how far along it is. */
export interface FleetJobSaveData {
  readonly originCityId: string;
  readonly destinationCityId: string;
  readonly cargoId: string;
  readonly cargoTons: number;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly pay: Credits;
  readonly driverShare: Credits;
  readonly fuelCost: Credits;
  readonly incident: boolean;
  /** Seconds of it done. */
  readonly elapsedSeconds: number;
}

/** The rival companies, and how everyone stands in the cities (RivalService). */
export interface RivalsSaveData {
  /** The rival companies, in content order. One missing starts out afresh (a new game, or a new rival). */
  readonly companies: readonly RivalCompanySaveData[];
  /** Each company's standing in each city; what is not listed is none. */
  readonly standing: readonly StandingSaveData[];
  /** Seconds before the player's company can run its next campaign in a city; a city not listed, now. */
  readonly campaignCooldowns: readonly CampaignCooldownSaveData[];
  /** The tender on the job board, or null. */
  readonly tender: TenderSaveData | null;
  /** The tender the company took, raced by its rival (the contract under way is its contract), or null. */
  readonly race: TenderSaveData | null;
  /** Seconds until the next tender comes to the board; null before the first is due (a new game). */
  readonly nextTenderSeconds: number | null;
  /** Tenders so far: the next one's number. */
  readonly tendersPosted: number;
  /** Rival contracts planned so far: the next one's number seeds it. */
  readonly jobsPlanned: number;
}

/** A rival company. */
export interface RivalCompanySaveData {
  /** RivalCompanyDefinition id. */
  readonly rivalId: string;
  readonly credits: Credits;
  /** Bought out by the player's company: out of business for good. */
  readonly acquired: boolean;
  /** Its trucks on the road; none once it is bought out. */
  readonly trucks: readonly RivalTruckSaveData[];
  /** Seconds before it can run its next campaign. */
  readonly campaignCooldownSeconds: number;
  /** Seconds before it next thinks over buying a truck or running a campaign. */
  readonly decisionSeconds: number;
}

/** One of a rival's trucks. */
export interface RivalTruckSaveData {
  /** CityDefinition id of the city it is in, or left last. */
  readonly cityId: string;
  /** The contract under way, or null between two. */
  readonly job: FleetJobSaveData | null;
}

/** A company's standing in a city. */
export interface StandingSaveData {
  /** CityDefinition id. */
  readonly cityId: string;
  /** RivalCompanyDefinition id, or "player" for the player's company. */
  readonly companyId: string;
  /** More than 0. */
  readonly points: number;
}

export interface CampaignCooldownSaveData {
  /** CityDefinition id. */
  readonly cityId: string;
  /** More than 0. */
  readonly seconds: number;
}

/** A tender (src/domain/rivals/tenders.ts Tender). */
export interface TenderSaveData {
  /** The generated contract; its id starts with "daily_tender_". */
  readonly contract: MissionDefinition;
  /** RivalCompanyDefinition id of the rival racing it. */
  readonly rivalId: string;
  readonly prize: Credits;
  /** From loading until the rival has unloaded, seconds. */
  readonly rivalSeconds: number;
}

export interface StatsSaveData {
  readonly deliveriesCompleted: number;
  readonly deliveriesFailed: number;
  /** Credits earned from deliveries, before costs. */
  readonly creditsEarned: Credits;
  readonly distanceDrivenMeters: number;
}
