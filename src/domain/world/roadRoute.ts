import type { RoadPath } from './RoadPath';

/** Guidance aims this far ahead along the road, and straight at the target once it is this close by road. */
export const ROUTE_LOOK_AHEAD_METERS = 40;

/** Where to steer and how far is left. Reused every call: create it once with createRouteGuidance(). */
export interface RouteGuidance {
  /** Remaining distance, meters: by road where a road connects both ends, otherwise in a straight line. */
  distanceMeters: number;
  /** A point to steer toward: ahead along the road, or the target itself when it is near. */
  aimX: number;
  aimZ: number;
}

export function createRouteGuidance(): RouteGuidance {
  return { distanceMeters: 0, aimX: 0, aimZ: 0 };
}

/**
 * Guidance from (fromX, fromZ) to (toX, toZ): a stand-in for the navigation
 * graph of roadmap step 23. Both ends snap to their nearest road. When it is
 * the same road, the route follows it the shorter way (a closed road can go
 * either way round); otherwise it is a straight line. Allocation-free.
 */
export function routeAlongRoads(
  roads: readonly RoadPath[],
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  out: RouteGuidance,
): RouteGuidance {
  out.distanceMeters = Math.hypot(toX - fromX, toZ - fromZ);
  out.aimX = toX;
  out.aimZ = toZ;
  const road = nearestRoad(roads, fromX, fromZ);
  if (road === null || road !== nearestRoad(roads, toX, toZ)) {
    return out;
  }
  const fromIndex = road.nearestSampleIndex(fromX, fromZ);
  const toIndex = road.nearestSampleIndex(toX, toZ);
  const along = road.distanceAlong(fromIndex, toIndex);
  if (Math.abs(along) < ROUTE_LOOK_AHEAD_METERS) {
    return out; // Nearly there: head straight for it.
  }
  const onRoad = Math.hypot(road.x(fromIndex) - fromX, road.z(fromIndex) - fromZ);
  const offRoad = Math.hypot(toX - road.x(toIndex), toZ - road.z(toIndex));
  out.distanceMeters = Math.abs(along) + onRoad + offRoad;

  const direction = along > 0 ? 1 : -1;
  let aim = fromIndex;
  while (aim !== toIndex && Math.abs(road.distanceAlong(fromIndex, aim)) < ROUTE_LOOK_AHEAD_METERS) {
    aim = road.stepIndex(aim, direction);
  }
  out.aimX = road.x(aim);
  out.aimZ = road.z(aim);
  return out;
}

function nearestRoad(roads: readonly RoadPath[], x: number, z: number): RoadPath | null {
  let best: RoadPath | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < roads.length; i++) {
    const distance = roads[i]!.distanceTo(x, z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = roads[i]!;
    }
  }
  return best;
}
