import type { Validator } from '../../core/validation/Validator';
import type { Credits, Fraction } from '../units';
import { bodyCanHaul } from './BodyType';
import type { CargoDefinition } from './CargoDefinition';
import { VEHICLE_CLASSES, type VehicleClass, type VehicleDefinition } from './VehicleDefinition';

/** Generated contracts' ids start with this (the contract generator); the game's own must not. */
export const GENERATED_MISSION_ID_PREFIX = 'daily_';

/** Spec §40. */
export const MISSION_DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'] as const;
export type MissionDifficulty = (typeof MISSION_DIFFICULTIES)[number];

/**
 * A hand-authored delivery contract template (spec §10, §50). The mission
 * system (roadmap step 12) turns it into a MissionInstance with its own state.
 * Distance and fuel estimate are derived from the road network, not stored.
 */
export interface MissionDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  /** CityDefinition id where the cargo is picked up. */
  readonly originCityId: string;
  /** CityDefinition id where the cargo is delivered. */
  readonly destinationCityId: string;
  /** CargoDefinition id. */
  readonly cargoId: string;
  readonly cargoWeightTons: number;
  readonly baseReward: Credits;
  readonly timeLimitSeconds: number;
  /** Largest cargo damage (0..1) the client still accepts at delivery. */
  readonly damageTolerance: Fraction;
  readonly difficulty: MissionDifficulty;
  /** Restricts the mission to one vehicle class. Omit to allow any truck that can carry the weight. */
  readonly requiredVehicleClass?: VehicleClass;
  /** The company level that unlocks the contract (spec §14). Omit for level 1. */
  readonly requiredCompanyLevel?: number;
}

/** Checks the mission's own fields. References to other definitions are checked by the content catalog. */
export function validateMissionDefinition(mission: MissionDefinition, path: string, validator: Validator): void {
  validator.id(mission.id, `${path}.id`);
  validator.id(mission.originCityId, `${path}.originCityId`);
  validator.id(mission.destinationCityId, `${path}.destinationCityId`);
  validator.id(mission.cargoId, `${path}.cargoId`);
  validator.positiveNumber(mission.cargoWeightTons, `${path}.cargoWeightTons`);
  validator.nonNegativeInteger(mission.baseReward, `${path}.baseReward`);
  validator.positiveNumber(mission.timeLimitSeconds, `${path}.timeLimitSeconds`);
  validator.fraction(mission.damageTolerance, `${path}.damageTolerance`);
  validator.oneOf(mission.difficulty, MISSION_DIFFICULTIES, `${path}.difficulty`);
  if (mission.requiredVehicleClass !== undefined) {
    validator.oneOf(mission.requiredVehicleClass, VEHICLE_CLASSES, `${path}.requiredVehicleClass`);
  }
  if (mission.requiredCompanyLevel !== undefined) {
    validator.positiveInteger(mission.requiredCompanyLevel, `${path}.requiredCompanyLevel`);
  }
}

/** Whether `vehicle` may take `mission`: payload, body for the cargo and, if required, vehicle class (spec §29 step 4). */
export function vehicleCanHaul(vehicle: VehicleDefinition, mission: MissionDefinition, cargo: CargoDefinition): boolean {
  return (
    vehicle.maxPayloadTons >= mission.cargoWeightTons &&
    bodyCanHaul(vehicle.bodyType, cargo.requiredBody) &&
    (mission.requiredVehicleClass === undefined || vehicle.vehicleClass === mission.requiredVehicleClass)
  );
}
