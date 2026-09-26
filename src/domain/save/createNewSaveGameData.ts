import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { Credits } from '../../data/units';
import { validateCompanyName } from '../company/companyName';
import { CURRENT_SAVE_VERSION, type RivalsSaveData, type SaveGameData } from './SaveGameData';

export interface NewGameParams {
  /** Raw player input. It is normalised and validated here. */
  readonly companyName: string;
  readonly startingCredits: Credits;
  readonly startingVehicle: VehicleDefinition;
  /** MapDefinition id the company starts on; the truck waits at its spawn. */
  readonly startingMapId: string;
  /** Unix epoch milliseconds, from the injected Clock. */
  readonly nowMs: number;
}

/**
 * Builds the save for a brand-new company: level 1, starting credits and one
 * full-tank, undamaged starter truck at the map's spawn, and the tutorial
 * from its first step (spec §41).
 *
 * Throws RangeError for an invalid company name. The onboarding UI must check
 * the name with validateCompanyName() first and show the error to the player.
 */
export function createNewSaveGameData(params: NewGameParams): SaveGameData {
  const companyName = validateCompanyName(params.companyName);
  if (!companyName.ok) {
    throw new RangeError(`Invalid company name (${companyName.error}).`);
  }
  if (!Number.isInteger(params.startingCredits) || params.startingCredits < 0) {
    throw new RangeError(`startingCredits must be a non-negative integer, got ${params.startingCredits}.`);
  }

  const starterTruckId = formatVehicleInstanceId(1);
  return {
    version: CURRENT_SAVE_VERSION,
    createdAtMs: params.nowMs,
    updatedAtMs: params.nowMs,
    profile: { companyName: companyName.value },
    company: { level: 1, xp: 0, reputation: 0 },
    economy: { credits: params.startingCredits },
    garage: {
      activeVehicleInstanceId: starterTruckId,
      vehicles: [
        {
          instanceId: starterTruckId,
          definitionId: params.startingVehicle.id,
          fuelLiters: params.startingVehicle.fuelCapacityLiters,
          damage: 0,
          upgrades: {},
          paintId: null,
        },
      ],
    },
    world: { mapId: params.startingMapId, truck: null },
    missions: { active: null },
    stats: { deliveriesCompleted: 0, deliveriesFailed: 0, creditsEarned: 0, distanceDrivenMeters: 0 },
    events: { runs: [] },
    tutorial: { step: 'takeContract' },
    fleet: { drivers: [], jobsPlanned: 0 },
    rivals: newRivalsSaveData(),
  };
}

/** The rivals before anything has happened: each starts out afresh when the game is loaded (RivalService.restore). */
export function newRivalsSaveData(): RivalsSaveData {
  return {
    companies: [],
    standing: [],
    campaignCooldowns: [],
    tender: null,
    race: null,
    nextTenderSeconds: null,
    tendersPosted: 0,
    jobsPlanned: 0,
  };
}

/** Instance id for the `sequence`-th truck a company acquires: 1 → "truck_001". */
export function formatVehicleInstanceId(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`sequence must be a positive integer, got ${sequence}.`);
  }
  return `truck_${String(sequence).padStart(3, '0')}`;
}
