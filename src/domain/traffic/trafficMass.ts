import type { TrafficVehicleKind } from '../../data/definitions/TrafficVehicleDefinition';

/**
 * How heavy each kind of the traffic is, kg: a blow between it and the
 * truck is shared by their masses (DrivingWorld), so the truck feels a car
 * less than a bus. The cars and minibuses weigh what their wrecks do
 * (crash/wrecks.ts).
 */
export const TRAFFIC_MASS_KG: Readonly<Record<TrafficVehicleKind, number>> = Object.freeze({
  car: 1250,
  minibus: 2600,
  truck: 9000,
  bus: 11000,
});
