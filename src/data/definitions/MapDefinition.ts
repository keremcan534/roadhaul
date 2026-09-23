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

/**
 * A drivable area. The 3-city map of roadmap step 21 extends this with cities
 * and depots; for now it describes the test road (step 08).
 */
export interface MapDefinition {
  /** Stable snake_case id. */
  readonly id: string;
  /** The playable area is the square from -halfSizeMeters to +halfSizeMeters on both axes. */
  readonly halfSizeMeters: number;
  readonly roads: readonly RoadDefinition[];
  readonly buildings: readonly BuildingDefinition[];
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
