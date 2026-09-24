import { degreesToRadians } from '../../core/math/scalar';
import type { RouteTrace } from '../world/RoadNetwork';

/** What the driver has to do next along the route (spec §63's turn arrow). */
export const MANOEUVRE_KINDS = ['left', 'right', 'turnAround', 'arrive'] as const;
export type ManoeuvreKind = (typeof MANOEUVRE_KINDS)[number];

/** The next manoeuvre and how far along the route it is. Reused: create it with createManoeuvre(). */
export interface Manoeuvre {
  kind: ManoeuvreKind;
  /** Meters from the start of the route (the truck) to where it happens. */
  distanceMeters: number;
}

export function createManoeuvre(): Manoeuvre {
  return { kind: 'arrive', distanceMeters: 0 };
}

/** Leaving one road for another by more than this is a turn; less is carrying on. */
const TURN_ANGLE = degreesToRadians(30);
/** The way the route goes into and out of a junction is measured over this distance. */
const HEADING_SPAN_METERS = 12;
/** Facing this far from the way the route starts, on the road, the driver has to turn round. */
const TURN_AROUND_ANGLE = degreesToRadians(120);
/** The way the route starts is measured over this distance. */
const START_SPAN_METERS = 10;

/**
 * The next manoeuvre along `trace` for a truck at (truckX, truckZ) facing
 * `truckHeading` (radians), written into `out`: turning round first when
 * the truck is on the road facing away from the route (`onRoad`), else the
 * first turn onto another road, else arriving. Carrying on where a road
 * bends or meets others is not a manoeuvre. Allocation-free.
 */
export function nextManoeuvre(
  trace: Readonly<RouteTrace>,
  truckHeading: number,
  onRoad: boolean,
  out: Manoeuvre,
): Manoeuvre {
  out.kind = 'arrive';
  out.distanceMeters = trace.distanceMeters;
  const count = trace.count;
  if (!trace.connected || count < 2) {
    return out;
  }
  if (onRoad) {
    const ahead = pointAtLeast(trace, 0, START_SPAN_METERS);
    const dx = trace.x[ahead]! - trace.x[0]!;
    const dz = trace.z[ahead]! - trace.z[0]!;
    if (dx * dx + dz * dz > 1 && Math.abs(wrapAngle(Math.atan2(dx, dz) - truckHeading)) > TURN_AROUND_ANGLE) {
      out.kind = 'turnAround';
      out.distanceMeters = 0;
      return out;
    }
  }
  for (let i = 1; i < count; i++) {
    if (trace.road[i] === trace.road[i - 1]) {
      continue;
    }
    // A junction: compare the way in (up to the last sample on the old road) with the way out.
    let back = i - 1;
    while (back > 0 && trace.along[i - 1]! - trace.along[back]! < HEADING_SPAN_METERS) back--;
    const ahead = pointAtLeast(trace, i, HEADING_SPAN_METERS);
    const inX = trace.x[i - 1]! - trace.x[back]!;
    const inZ = trace.z[i - 1]! - trace.z[back]!;
    const outX = trace.x[ahead]! - trace.x[i]!;
    const outZ = trace.z[ahead]! - trace.z[i]!;
    if (inX * inX + inZ * inZ < 1 || outX * outX + outZ * outZ < 1) {
      continue;
    }
    // Turning left raises the heading, seen from above.
    const turn = wrapAngle(Math.atan2(outX, outZ) - Math.atan2(inX, inZ));
    if (Math.abs(turn) > TURN_ANGLE) {
      out.kind = turn > 0 ? 'left' : 'right';
      out.distanceMeters = trace.along[i]!;
      return out;
    }
  }
  return out;
}

/** The first sample at least `meters` along the route past sample `from`, or the last one. */
function pointAtLeast(trace: Readonly<RouteTrace>, from: number, meters: number): number {
  let k = from;
  while (k < trace.count - 1 && trace.along[k]! - trace.along[from]! < meters) k++;
  return k;
}

function wrapAngle(angle: number): number {
  return angle - Math.round(angle / (2 * Math.PI)) * 2 * Math.PI;
}
