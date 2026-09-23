/** Guidance aims this far ahead along the road, and straight at the target once it is this close by road. */
export const ROUTE_LOOK_AHEAD_METERS = 40;

/**
 * Where to steer and how far is left (RoadNetwork.guide). Reused every call:
 * create it once with createRouteGuidance().
 */
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
