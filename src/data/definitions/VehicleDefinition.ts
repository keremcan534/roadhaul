import type { Validator } from '../../core/validation/Validator';

export const VEHICLE_CLASSES = ['light', 'medium', 'heavy'] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

/**
 * Static description of a truck model: the spec's VehicleDefinition
 * ScriptableObject. Placeholder: the driving prototype (roadmap step 04) adds
 * physics tuning such as mass, engine, gearbox and steering data.
 *
 * Per-truck runtime state (fuel level, damage, upgrades) lives in the domain
 * layer and refers to a definition by `id`.
 */
export interface VehicleDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  readonly vehicleClass: VehicleClass;
  readonly maxPayloadTons: number;
  readonly fuelCapacityLiters: number;
  /** Consumption of the empty truck on flat road (spec §17 `vehicle.baseFuelPerKm`). */
  readonly baseFuelLitersPerKm: number;
  readonly maxSpeedKmh: number;
}

export function validateVehicleDefinition(vehicle: VehicleDefinition, path: string, validator: Validator): void {
  validator.id(vehicle.id, `${path}.id`);
  validator.oneOf(vehicle.vehicleClass, VEHICLE_CLASSES, `${path}.vehicleClass`);
  validator.positiveNumber(vehicle.maxPayloadTons, `${path}.maxPayloadTons`);
  validator.positiveNumber(vehicle.fuelCapacityLiters, `${path}.fuelCapacityLiters`);
  validator.positiveNumber(vehicle.baseFuelLitersPerKm, `${path}.baseFuelLitersPerKm`);
  validator.positiveNumber(vehicle.maxSpeedKmh, `${path}.maxSpeedKmh`);
}
