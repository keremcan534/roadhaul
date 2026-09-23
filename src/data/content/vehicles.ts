import type { VehicleDefinition } from '../definitions/VehicleDefinition';

/**
 * Placeholder truck roster. Models are original designs (spec §15): never use
 * real manufacturer names, logos or designs. The MVP adds H2 (medium) and H3 (heavy).
 */
export const VEHICLES: readonly VehicleDefinition[] = [
  {
    id: 'rh_h1',
    vehicleClass: 'light',
    maxPayloadTons: 5,
    fuelCapacityLiters: 150,
    baseFuelLitersPerKm: 0.2,
    maxSpeedKmh: 90,
  },
];
