import type { RectangleDefinition } from '../../data/definitions/MapDefinition';
import type { TrailerBody, VehicleBody } from '../../data/definitions/VehicleDefinition';
import { tractorForTrailerAt, trailerCentreAhead } from '../vehicles/semiTrailer';

/** Below this speed the truck counts as stopped (about 1 km/h). */
export const STOPPED_SPEED_METERS_PER_SECOND = 0.3;
/**
 * How far past the bay's lines a truck may stand and still count as parked
 * in it (the owner's request: a larger parking square), meters: across the
 * bay on either side, and past either end. A truck parked a little askew
 * fits too, as long as its corners stay within that.
 */
export const BAY_SLACK_ACROSS_METERS = 0.8;
export const BAY_SLACK_ALONG_METERS = 1.5;
/**
 * A perfect park (its bonus at the drop-off): the whole body within the
 * lines, straight along the bay to this many degrees either way, its middle
 * this near the bay's across it.
 */
export const PERFECT_PARKING_DEGREES = 4;
export const PERFECT_PARKING_ACROSS_METERS = 0.5;

/** Rear-axle position and heading (radians, 0 faces +Z) of a truck. */
export interface TruckPose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

/**
 * Whether the truck's whole body lies within the bay's lines (spec §12
 * "stop to load"). It may face either way along the bay. The body is a
 * `length` × `width` rectangle centred `wheelbase / 2` ahead of the rear
 * axle, like the collision footprint. Allocation-free: it runs every fixed
 * step.
 */
export function isInsideBay(bay: RectangleDefinition, pose: TruckPose, body: VehicleBody): boolean {
  return isBoxInside(bay, pose, body.wheelbaseMeters / 2, body.lengthMeters / 2, body.widthMeters / 2, 0, 0);
}

/**
 * Whether a semi-trailer's whole body lies within the bay's lines, its
 * axles' middle and heading at `pose` (semiTrailer.ts): a tractor unit's
 * load is in it, and the tractor may stand out of the bay ahead of it.
 * Allocation-free.
 */
export function isTrailerInsideBay(bay: RectangleDefinition, pose: TruckPose, trailer: TrailerBody, widthMeters: number): boolean {
  return isBoxInside(bay, pose, trailerCentreAhead(trailer), trailer.lengthMeters / 2, widthMeters / 2, 0, 0);
}

/**
 * Stopped with the truck in the bay, its corners no further past the lines
 * than the slack (BAY_SLACK_ALONG_METERS, BAY_SLACK_ACROSS_METERS): loading
 * or unloading can run. Allocation-free.
 */
export function isParkedInBay(
  bay: RectangleDefinition,
  truck: TruckPose & { readonly speed: number },
  body: VehicleBody,
): boolean {
  return (
    Math.abs(truck.speed) < STOPPED_SPEED_METERS_PER_SECOND &&
    isBoxInside(bay, truck, body.wheelbaseMeters / 2, body.lengthMeters / 2, body.widthMeters / 2, BAY_SLACK_ALONG_METERS, BAY_SLACK_ACROSS_METERS)
  );
}

/** A semi-trailer in the bay as isParkedInBay has a truck: within the slack (the tractor's speed is the caller's to check). */
export function isTrailerParkedInBay(bay: RectangleDefinition, pose: TruckPose, trailer: TrailerBody, widthMeters: number): boolean {
  return isBoxInside(
    bay,
    pose,
    trailerCentreAhead(trailer),
    trailer.lengthMeters / 2,
    widthMeters / 2,
    BAY_SLACK_ALONG_METERS,
    BAY_SLACK_ACROSS_METERS,
  );
}

/** A perfect park: the body within the lines, square to the bay and in its middle (PERFECT_PARKING_DEGREES). */
export function isParkedPerfectly(bay: RectangleDefinition, pose: TruckPose, body: VehicleBody): boolean {
  return isInsideBay(bay, pose, body) && isSquareAndCentred(bay, pose, body.wheelbaseMeters / 2);
}

/** A semi-trailer parked perfectly, as isParkedPerfectly has a truck. */
export function isTrailerParkedPerfectly(bay: RectangleDefinition, pose: TruckPose, trailer: TrailerBody, widthMeters: number): boolean {
  return isTrailerInsideBay(bay, pose, trailer, widthMeters) && isSquareAndCentred(bay, pose, trailerCentreAhead(trailer));
}

/**
 * Whether a box `ahead` meters in front of `pose`, along it, `halfLength` by
 * `halfWidth`, lies inside the bay grown by `slackAlong` past either end
 * and `slackAcross` past either side.
 */
function isBoxInside(
  bay: RectangleDefinition,
  pose: TruckPose,
  ahead: number,
  halfLength: number,
  halfWidth: number,
  slackAlong: number,
  slackAcross: number,
): boolean {
  const alongX = Math.sin(pose.heading);
  const alongZ = Math.cos(pose.heading);
  const centreX = pose.x + alongX * ahead;
  const centreZ = pose.z + alongZ * ahead;
  const bayHeading = (bay.headingDegrees * Math.PI) / 180;
  const bayAlongX = Math.sin(bayHeading);
  const bayAlongZ = Math.cos(bayHeading);
  const reachAlong = bay.lengthMeters / 2 + slackAlong;
  const reachAcross = bay.widthMeters / 2 + slackAcross;
  for (let l = -1; l <= 1; l += 2) {
    for (let w = -1; w <= 1; w += 2) {
      const dx = centreX + alongX * halfLength * l + alongZ * halfWidth * w - bay.x;
      const dz = centreZ + alongZ * halfLength * l - alongX * halfWidth * w - bay.z;
      if (Math.abs(dx * bayAlongX + dz * bayAlongZ) > reachAlong || Math.abs(dx * bayAlongZ - dz * bayAlongX) > reachAcross) {
        return false;
      }
    }
  }
  return true;
}

/** Whether a body centred `ahead` of `pose` stands square to the bay (either way along it) and near its middle across. */
function isSquareAndCentred(bay: RectangleDefinition, pose: TruckPose, ahead: number): boolean {
  const bayHeading = (bay.headingDegrees * Math.PI) / 180;
  // The angle between the truck and the bay's lines, either way along them: 0 to π/2.
  const turn = Math.abs(pose.heading - bayHeading) % Math.PI;
  const askew = Math.min(turn, Math.PI - turn);
  if (askew > (PERFECT_PARKING_DEGREES * Math.PI) / 180) {
    return false;
  }
  const dx = pose.x + Math.sin(pose.heading) * ahead - bay.x;
  const dz = pose.z + Math.cos(pose.heading) * ahead - bay.z;
  return Math.abs(dx * Math.cos(bayHeading) - dz * Math.sin(bayHeading)) <= PERFECT_PARKING_ACROSS_METERS;
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
