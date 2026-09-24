import { rectangleContains, type RectangleDefinition } from '../../data/definitions/MapDefinition';
import type { VehicleBody } from '../../data/definitions/VehicleDefinition';

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
  const alongX = Math.sin(pose.heading);
  const alongZ = Math.cos(pose.heading);
  const centreX = pose.x + alongX * (body.wheelbaseMeters / 2);
  const centreZ = pose.z + alongZ * (body.wheelbaseMeters / 2);
  const halfLength = body.lengthMeters / 2;
  const halfWidth = body.widthMeters / 2;
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

/** The rear-axle pose that parks the truck squarely in the middle of the bay, facing along its heading. */
export function bayParkingPose(bay: RectangleDefinition, body: VehicleBody): TruckPose {
  const heading = (bay.headingDegrees * Math.PI) / 180;
  const back = body.wheelbaseMeters / 2;
  return { x: bay.x - Math.sin(heading) * back, z: bay.z - Math.cos(heading) * back, heading };
}
