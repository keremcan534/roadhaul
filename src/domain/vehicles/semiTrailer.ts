import type { TrailerBody } from '../../data/definitions/VehicleDefinition';
import type { VehicleFootprint } from './VehicleFootprint';

/** The trailer turns no further about the coupling than this, radians (75°): there it has jackknifed. */
export const MAX_ARTICULATION_RADIANS = (75 * Math.PI) / 180;

/**
 * Where a semi-trailer stands: the middle of its axles on the ground (its
 * reference point, as the rear axle is the tractor's) and the way it
 * faces, radians, 0 along +z, never wrapped. Mutated in place.
 */
export interface TrailerPose {
  x: number;
  z: number;
  heading: number;
  /** The ground under its axles (its height, meters) and its rise per meter along the trailer: 0 on the flat. */
  y: number;
  grade: number;
}

export function createTrailerPose(): TrailerPose {
  return { x: 0, z: 0, heading: 0, y: 0, grade: 0 };
}

export function copyTrailerPose(into: TrailerPose, from: Readonly<TrailerPose>): void {
  into.x = from.x;
  into.z = from.z;
  into.heading = from.heading;
  into.y = from.y;
  into.grade = from.grade;
}

/** The angle from π to −π equal to `angle`. */
function wrapAngle(angle: number): number {
  return angle - Math.round(angle / (2 * Math.PI)) * 2 * Math.PI;
}

/** How far the trailer is turned from the tractor (heading `tractorHeading`), radians, positive to the left. */
export function articulation(pose: Readonly<TrailerPose>, tractorHeading: number): number {
  return wrapAngle(pose.heading - tractorHeading);
}

/** Puts the trailer straight behind the tractor whose rear axle is at (x, z), facing `heading`. */
export function straightenTrailer(pose: TrailerPose, x: number, z: number, heading: number, trailer: TrailerBody): void {
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const back = trailer.axleBehindKingpinMeters - trailer.couplingAheadMeters;
  pose.x = x - sin * back;
  pose.z = z - cos * back;
  pose.heading = heading;
}

/**
 * Moves the trailer after the tractor's fifth wheel, its rear axle now at
 * (x, z) facing `heading`: the trailer's axles roll only along it, so they
 * follow toward where the coupling has gone, the trailer staying its
 * length from it. Pulled, it falls in behind the tractor, cutting inside a
 * bend; pushed in reverse, it turns away ever more unless the driver steers
 * it back, until it jackknifes at MAX_ARTICULATION_RADIANS, where it is
 * held. Returns whether it is at that limit. Allocation-free.
 */
export function followCoupling(pose: TrailerPose, x: number, z: number, heading: number, trailer: TrailerBody): boolean {
  const couplingX = x + Math.sin(heading) * trailer.couplingAheadMeters;
  const couplingZ = z + Math.cos(heading) * trailer.couplingAheadMeters;
  const dx = couplingX - pose.x;
  const dz = couplingZ - pose.z;
  // Toward the coupling from where the axles were: the way they rolled (unchanged if they are on it).
  const toward = dx * dx + dz * dz > 1e-12 ? Math.atan2(dx, dz) : pose.heading;
  let turned = wrapAngle(toward - heading);
  const jackknifed = Math.abs(turned) >= MAX_ARTICULATION_RADIANS;
  if (jackknifed) {
    turned = Math.sign(turned) * MAX_ARTICULATION_RADIANS;
  }
  // Unwrapped from where it faced: rendering interpolates between steps.
  pose.heading += wrapAngle(heading + turned - pose.heading);
  const length = trailer.axleBehindKingpinMeters;
  pose.x = couplingX - Math.sin(pose.heading) * length;
  pose.z = couplingZ - Math.cos(pose.heading) * length;
  return jackknifed;
}

/** The trailer's front, ahead of its axles' middle, meters. */
export function trailerFrontAhead(trailer: TrailerBody): number {
  return trailer.axleBehindKingpinMeters + trailer.kingpinMeters;
}

/** The middle of the trailer's body, ahead of its axles' middle, meters. */
export function trailerCentreAhead(trailer: TrailerBody): number {
  return trailerFrontAhead(trailer) - trailer.lengthMeters / 2;
}

/**
 * The trailer's collision shape, as the tractor's (VehicleFootprint): a row
 * of circles along it, the offsets ahead of its axles' middle.
 */
export function createTrailerFootprint(trailer: TrailerBody, widthMeters: number): VehicleFootprint {
  const radius = widthMeters / 2;
  const circles = Math.max(2, Math.ceil(trailer.lengthMeters / widthMeters));
  const centre = trailerCentreAhead(trailer);
  const reach = Math.max(0, trailer.lengthMeters / 2 - radius);
  const offsets = Array.from({ length: circles }, (_, index) => centre - reach + (2 * reach * index) / (circles - 1));
  return Object.freeze({ offsets: Object.freeze(offsets), radius });
}

/**
 * Where the tractor's rear axle stands for its trailer, straight behind it,
 * to stand with its middle at (x, z), facing `heading`.
 */
export function tractorForTrailerAt(
  x: number,
  z: number,
  heading: number,
  trailer: TrailerBody,
): { readonly x: number; readonly z: number; readonly heading: number } {
  const ahead = trailerCentreAhead(trailer);
  const fromAxles = trailer.axleBehindKingpinMeters - trailer.couplingAheadMeters;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  return { x: x + sin * (fromAxles - ahead), z: z + cos * (fromAxles - ahead), heading };
}
