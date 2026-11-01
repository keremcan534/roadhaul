import { rectangleContains, type RectangleDefinition } from '../../data/definitions/MapDefinition';
import type { TrailerBody, VehicleBody } from '../../data/definitions/VehicleDefinition';
import { tractorForTrailerAt, trailerCentreAhead } from '../vehicles/semiTrailer';

/** Below this speed the truck counts as stopped (about 1 km/h). */
export const STOPPED_SPEED_METERS_PER_SECOND = 0.3;

/** Rear-axle position and heading (radians, 0 faces +Z) of a truck. */
export interface TruckPose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

/**
 * Whether the truck's whole body lies inside the bay (spec §12 "stop to
 * load"). It may face either way along the bay. The body is a `length` ×
 * `width` rectangle centred `wheelbase / 2` ahead of the rear axle, like the
 * collision footprint. Allocation-free: it runs every fixed step.
 */
export function isInsideBay(bay: RectangleDefinition, pose: TruckPose, body: VehicleBody): boolean {
  return isBoxInside(bay, pose, body.wheelbaseMeters / 2, body.lengthMeters / 2, body.widthMeters / 2);
}

/**
 * Whether a semi-trailer's whole body lies inside the bay, its axles' middle
 * and heading at `pose` (semiTrailer.ts): a tractor unit's load is in it,
 * and the tractor may stand out of the bay ahead of it. Allocation-free.
 */
export function isTrailerInsideBay(bay: RectangleDefinition, pose: TruckPose, trailer: TrailerBody, widthMeters: number): boolean {
  return isBoxInside(bay, pose, trailerCentreAhead(trailer), trailer.lengthMeters / 2, widthMeters / 2);
}

/** Whether a box `ahead` meters in front of `pose`, along it, `halfLength` by `halfWidth`, lies inside the bay. */
function isBoxInside(bay: RectangleDefinition, pose: TruckPose, ahead: number, halfLength: number, halfWidth: number): boolean {
  const alongX = Math.sin(pose.heading);
  const alongZ = Math.cos(pose.heading);
  const centreX = pose.x + alongX * ahead;
  const centreZ = pose.z + alongZ * ahead;
  for (let l = -1; l <= 1; l += 2) {
    for (let w = -1; w <= 1; w += 2) {
      const x = centreX + alongX * halfLength * l + alongZ * halfWidth * w;
      const z = centreZ + alongZ * halfLength * l - alongX * halfWidth * w;
      if (!rectangleContains(bay, x, z)) {
        return false;
      }
    }
  }
  return true;
}

/** Stopped with the whole truck inside the bay: loading or unloading can run. */
export function isParkedInBay(
  bay: RectangleDefinition,
  truck: TruckPose & { readonly speed: number },
  body: VehicleBody,
): boolean {
  return Math.abs(truck.speed) < STOPPED_SPEED_METERS_PER_SECOND && isInsideBay(bay, truck, body);
}

/**
 * The rear-axle pose that parks the truck squarely in the middle of the bay,
 * facing along its heading; with a `trailer`, the tractor's that parks the
 * trailer there, straight behind it (the tractor standing out ahead).
 */
export function bayParkingPose(bay: RectangleDefinition, body: VehicleBody, trailer?: TrailerBody): TruckPose {
  const heading = (bay.headingDegrees * Math.PI) / 180;
  if (trailer !== undefined) {
    return tractorForTrailerAt(bay.x, bay.z, heading, trailer);
  }
  const back = body.wheelbaseMeters / 2;
  return { x: bay.x - Math.sin(heading) * back, z: bay.z - Math.cos(heading) * back, heading };
}
