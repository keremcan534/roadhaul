import type { TrafficVehicleDefinition, TrafficVehicleKind } from '../../data/definitions/TrafficVehicleDefinition';
import type { DebrisShape } from './DebrisSimulation';

/**
 * The traffic the truck can wreck: a car or a minibus it drives into hard
 * enough is thrown off the road, a battered wreck, instead of stopping it.
 * Lorries and buses are too heavy: they stop the truck as before. Company
 * trucks on the road (guests) are never wrecked.
 */
export interface Wreckable {
  /** Driven into at least this fast (m/s, the closing speed), it is wrecked. */
  readonly wreckSpeed: number;
  readonly massKg: number;
  /** How bouncy and how rough it is as a wreck. */
  readonly restitution: number;
  readonly friction: number;
  /** The truck takes this share of the speed it drove in as a crash (damage to it and its cargo). */
  readonly damageShare: number;
}

export const WRECKABLES: Readonly<Partial<Record<TrafficVehicleKind, Wreckable>>> = {
  car: { wreckSpeed: 8, massKg: 1250, restitution: 0.2, friction: 0.6, damageShare: 0.45 },
  minibus: { wreckSpeed: 9, massKg: 2600, restitution: 0.2, friction: 0.6, damageShare: 0.55 },
};

/** A wrecked vehicle's kind among debris: past every knockable's code (knockableCode). */
export const WRECK_DEBRIS_KIND = 32;

/** What `type` is as a wreck, or null when it cannot be wrecked. */
export function wreckableOf(type: TrafficVehicleDefinition): Wreckable | null {
  return WRECKABLES[type.kind] ?? null;
}

/** A wreck's shape as debris: the vehicle's box, its length along z. */
export function wreckShape(type: TrafficVehicleDefinition, wreckable: Wreckable): DebrisShape {
  return {
    halfX: type.widthMeters / 2,
    halfY: type.heightMeters / 2,
    halfZ: type.lengthMeters / 2,
    massKg: wreckable.massKg,
    restitution: wreckable.restitution,
    friction: wreckable.friction,
  };
}
