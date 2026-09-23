import type { Validator } from '../../core/validation/Validator';

/** A point on the ground plane: [x, z] in meters. */
export type Point2 = readonly [x: number, z: number];

/** A road: a smooth curve through its control points (spec §20 road types come later). */
export interface RoadDefinition {
  readonly id: string;
  readonly widthMeters: number;
  /** A closed road loops back from the last point to the first. */
  readonly closed: boolean;
  readonly controlPoints: readonly Point2[];
}

/** A solid, axis-aligned block (depot hall, office, warehouse). */
export interface BuildingDefinition {
  /** Centre of the footprint. */
  readonly x: number;
  readonly z: number;
  /** Size along X. */
  readonly widthMeters: number;
  /** Size along Z. */
  readonly depthMeters: number;
  readonly heightMeters: number;
}

/** A rectangle on the ground, rotated so its length runs along `headingDegrees` (0° = +Z, 90° = +X). */
export interface RectangleDefinition {
  /** Centre. */
  readonly x: number;
  readonly z: number;
  readonly headingDegrees: number;
  readonly lengthMeters: number;
  readonly widthMeters: number;
}

/**
 * A city's depot (spec §12): a paved yard with a loading bay where the truck
 * stops to load or unload. Missions from and to the city use it.
 */
export interface DepotDefinition {
  /** Stable snake_case id. */
  readonly id: string;
  /** CityDefinition id. */
  readonly cityId: string;
  /** Paved area around the bay: drives like asphalt. It should touch a road. */
  readonly yard: RectangleDefinition;
  /** Where the truck parks, facing either way along the bay's length. Must lie inside the yard. */
  readonly bay: RectangleDefinition;
}

/**
 * A drivable area: roads, buildings, depots, the truck's start and scenery.
 * The 3-city map of roadmap step 21 extends it with regions and a road graph.
 */
export interface MapDefinition {
  /** Stable snake_case id. */
  readonly id: string;
  /** The playable area is the square from -halfSizeMeters to +halfSizeMeters on both axes. */
  readonly halfSizeMeters: number;
  readonly roads: readonly RoadDefinition[];
  readonly buildings: readonly BuildingDefinition[];
  readonly depots: readonly DepotDefinition[];
  /** Where the truck starts: its rear axle position and heading (0° faces +Z, 90° faces +X). */
  readonly spawn: { readonly x: number; readonly z: number; readonly headingDegrees: number };
  /** Generated decoration: the same seed always produces the same scenery. */
  readonly scenery: { readonly seed: number; readonly treesPerKilometer: number };
}

export function validateMapDefinition(map: MapDefinition, path: string, validator: Validator): void {
  validator.id(map.id, `${path}.id`);
  const sizeValid = validator.positiveNumber(map.halfSizeMeters, `${path}.halfSizeMeters`);
  const inside = (x: number, z: number): boolean =>
    sizeValid && Math.abs(x) < map.halfSizeMeters && Math.abs(z) < map.halfSizeMeters;

  if (validator.check(Array.isArray(map.roads) && map.roads.length > 0, `${path}.roads`, 'must list at least one road')) {
    map.roads.forEach((road, index) => validateRoad(road, `${path}.roads[${index}]`, validator, inside));
  }
  if (validator.check(Array.isArray(map.buildings), `${path}.buildings`, 'must be a list')) {
    map.buildings.forEach((building, index) => {
      const buildingPath = `${path}.buildings[${index}]`;
      if (!validator.check(typeof building === 'object' && building !== null, buildingPath, 'must be an object')) {
        return;
      }
      validator.positiveNumber(building.widthMeters, `${buildingPath}.widthMeters`);
      validator.positiveNumber(building.depthMeters, `${buildingPath}.depthMeters`);
      validator.positiveNumber(building.heightMeters, `${buildingPath}.heightMeters`);
      validator.check(inside(building.x, building.z), buildingPath, 'must be inside the map');
    });
  }
  if (validator.check(Array.isArray(map.depots), `${path}.depots`, 'must be a list')) {
    map.depots.forEach((depot, index) => validateDepot(depot, `${path}.depots[${index}]`, validator, inside));
  }
  const spawn = map.spawn;
  if (validator.check(typeof spawn === 'object' && spawn !== null, `${path}.spawn`, 'must be an object')) {
    validator.check(inside(spawn.x, spawn.z), `${path}.spawn`, 'must be inside the map');
    validator.check(Number.isFinite(spawn.headingDegrees), `${path}.spawn.headingDegrees`, 'must be a number');
  }
  const scenery = map.scenery;
  if (validator.check(typeof scenery === 'object' && scenery !== null, `${path}.scenery`, 'must be an object')) {
    validator.nonNegativeInteger(scenery.seed, `${path}.scenery.seed`);
    validator.check(
      Number.isFinite(scenery.treesPerKilometer) && scenery.treesPerKilometer >= 0,
      `${path}.scenery.treesPerKilometer`,
      'must be zero or more',
    );
  }
}

function validateRoad(
  road: RoadDefinition,
  path: string,
  validator: Validator,
  inside: (x: number, z: number) => boolean,
): void {
  if (!validator.check(typeof road === 'object' && road !== null, path, 'must be an object')) {
    return;
  }
  validator.id(road.id, `${path}.id`);
  validator.positiveNumber(road.widthMeters, `${path}.widthMeters`);
  validator.boolean(road.closed, `${path}.closed`);
  const points = road.controlPoints;
  const minimum = road.closed ? 3 : 2;
  if (
    validator.check(
      Array.isArray(points) && points.length >= minimum,
      `${path}.controlPoints`,
      `needs at least ${minimum} points`,
    )
  ) {
    points.forEach((point, index) => {
      validator.check(
        Array.isArray(point) && point.length === 2 && inside(point[0], point[1]),
        `${path}.controlPoints[${index}]`,
        'must be an [x, z] pair inside the map',
      );
    });
  }
}

function validateDepot(
  depot: DepotDefinition,
  path: string,
  validator: Validator,
  inside: (x: number, z: number) => boolean,
): void {
  if (!validator.check(typeof depot === 'object' && depot !== null, path, 'must be an object')) {
    return;
  }
  validator.id(depot.id, `${path}.id`);
  validator.id(depot.cityId, `${path}.cityId`);
  const yardValid = validateRectangle(depot.yard, `${path}.yard`, validator, inside);
  const bayValid = validateRectangle(depot.bay, `${path}.bay`, validator, inside);
  if (yardValid && bayValid) {
    validator.check(
      rectangleCorners(depot.bay).every(([x, z]) => rectangleContains(depot.yard, x, z, 1e-6)),
      `${path}.bay`,
      'must lie inside the yard',
    );
  }
}

function validateRectangle(
  rectangle: RectangleDefinition,
  path: string,
  validator: Validator,
  inside: (x: number, z: number) => boolean,
): boolean {
  if (!validator.check(typeof rectangle === 'object' && rectangle !== null, path, 'must be an object')) {
    return false;
  }
  const sized = [
    validator.positiveNumber(rectangle.lengthMeters, `${path}.lengthMeters`),
    validator.positiveNumber(rectangle.widthMeters, `${path}.widthMeters`),
    validator.check(Number.isFinite(rectangle.headingDegrees), `${path}.headingDegrees`, 'must be a number'),
  ].every(Boolean);
  return sized && validator.check(rectangleCorners(rectangle).every(([x, z]) => inside(x, z)), path, 'must be inside the map');
}

/** The four corners of a rectangle, as [x, z] pairs. */
export function rectangleCorners(rectangle: RectangleDefinition): [number, number][] {
  const heading = (rectangle.headingDegrees * Math.PI) / 180;
  const alongX = Math.sin(heading);
  const alongZ = Math.cos(heading);
  const halfLength = rectangle.lengthMeters / 2;
  const halfWidth = rectangle.widthMeters / 2;
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([l, w]) => [
    rectangle.x + alongX * halfLength * l! + alongZ * halfWidth * w!,
    rectangle.z + alongZ * halfLength * l! - alongX * halfWidth * w!,
  ]);
}

/** Whether the point (x, z) lies inside the rectangle, grown by `margin` meters on every side. */
export function rectangleContains(rectangle: RectangleDefinition, x: number, z: number, margin = 0): boolean {
  const heading = (rectangle.headingDegrees * Math.PI) / 180;
  const dx = x - rectangle.x;
  const dz = z - rectangle.z;
  const along = dx * Math.sin(heading) + dz * Math.cos(heading);
  const across = dx * Math.cos(heading) - dz * Math.sin(heading);
  return Math.abs(along) <= rectangle.lengthMeters / 2 + margin && Math.abs(across) <= rectangle.widthMeters / 2 + margin;
}
