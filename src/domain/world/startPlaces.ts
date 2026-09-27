import type { DepotDefinition, RestAreaDefinition } from '../../data/definitions/MapDefinition';
import type { VehicleBody } from '../../data/definitions/VehicleDefinition';
import { bayParkingPose, type TruckPose } from '../missions/loadingBay';

/**
 * Where a drive can start, picked on the main menu: where the truck was
 * left (continuing a company), the map's own start (a new company), a
 * city's depot, or a rest area.
 */
export const START_PLACE_KINDS = ['left', 'home', 'depot', 'restArea'] as const;
export type StartPlaceKind = (typeof START_PLACE_KINDS)[number];

/** The id of the place where the truck was left, and of the map's own start. */
export const LEFT_START_ID = 'left';
export const HOME_START_ID = 'home';

export interface StartPlace {
  /** `left`, `home`, or the depot's or the rest area's id. */
  readonly id: string;
  readonly kind: StartPlaceKind;
  /** The depot's city; for the other places, the city of the depot nearest them (null on a map without depots). */
  readonly cityId: string | null;
  /** Where the truck stands there, at rest: its rear axle, and its heading (radians, never wrapped). */
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

/** What of the world the start places come from (DrivingWorld has it). */
export interface StartPlaceWorld {
  readonly spawn: TruckPose;
  readonly depots: readonly DepotDefinition[];
  readonly restAreas: readonly RestAreaDefinition[];
}

/**
 * The places a drive can start at, the one it starts at unless another is
 * picked first: where the truck was `left` (continuing a company), or the
 * map's own start when `left` is null (a new company); then each depot, the
 * truck parked squarely in its bay, and each rest area, in the middle of
 * its lot, in the map's order.
 */
export function startPlaces(world: StartPlaceWorld, body: VehicleBody, left: TruckPose | null): StartPlace[] {
  const first = left ?? world.spawn;
  const places: StartPlace[] = [
    {
      id: left === null ? HOME_START_ID : LEFT_START_ID,
      kind: left === null ? 'home' : 'left',
      cityId: nearestDepotCity(world.depots, first.x, first.z),
      x: first.x,
      z: first.z,
      heading: first.heading,
    },
  ];
  for (const depot of world.depots) {
    places.push({ id: depot.id, kind: 'depot', cityId: depot.cityId, ...bayParkingPose(depot.bay, body) });
  }
  for (const restArea of world.restAreas) {
    const parked = bayParkingPose(restArea.lot, body);
    places.push({ id: restArea.id, kind: 'restArea', cityId: nearestDepotCity(world.depots, parked.x, parked.z), ...parked });
  }
  return places;
}

/** The city whose depot is nearest (x, z): what a place is near. Null without depots. */
export function nearestDepotCity(depots: readonly DepotDefinition[], x: number, z: number): string | null {
  let nearest: string | null = null;
  let nearestDistance = Infinity;
  for (const depot of depots) {
    const distance = Math.hypot(depot.yard.x - x, depot.yard.z - z);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = depot.cityId;
    }
  }
  return nearest;
}
