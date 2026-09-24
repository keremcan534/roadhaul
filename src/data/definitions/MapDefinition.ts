import type { Validator } from '../../core/validation/Validator';

/** A point on the ground plane: [x, z] in meters. */
export type Point2 = readonly [x: number, z: number];

/** Spec §20's road types: city streets, a ring road, the highway and country roads. */
export const ROAD_KINDS = ['street', 'ringRoad', 'highway', 'rural'] as const;
export type RoadKind = (typeof ROAD_KINDS)[number];

/**
 * A road: a smooth curve through its control points. Roads meet where they
 * share a control point (a junction); a road ending on another road's control
 * point joins it there.
 */
export interface RoadDefinition {
  readonly id: string;
  readonly kind: RoadKind;
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
 * A rest area beside a road (spec §25): a paved lot where a truck that stops
 * can refuel and be repaired before it continues.
 */
export interface RestAreaDefinition {
  /** Stable snake_case id. */
  readonly id: string;
  /** The paved lot: drives like asphalt. One long side should open onto a road. */
  readonly lot: RectangleDefinition;
}

/** Which way along a road: toward its last control point, or back toward its first. */
export const ROAD_DIRECTIONS = ['forward', 'backward'] as const;
export type RoadDirection = (typeof ROAD_DIRECTIONS)[number];

/**
 * A city's name board where a road enters it. It stands `distanceMeters`
 * along road `roadId` (from its first control point), beside the road on
 * the right of traffic driving `direction`, and faces that traffic.
 */
export interface CitySignDefinition {
  /** CityDefinition id: the name on the board. */
  readonly cityId: string;
  readonly roadId: string;
  readonly distanceMeters: number;
  readonly direction: RoadDirection;
}

/**
 * What grows on a farm field: standing wheat, stubble with hay bales after
 * the harvest, a young green crop, or ploughed earth.
 */
export const FIELD_CROPS = ['wheat', 'stubble', 'green', 'ploughed'] as const;
export type FieldCrop = (typeof FIELD_CROPS)[number];

/** A side of a road, seen looking toward its last control point. */
export const ROAD_SIDES = ['left', 'right'] as const;
export type RoadSide = (typeof ROAD_SIDES)[number];

/**
 * A farm field (scenery) beside a road: a rectangle along the road from
 * `fromMeters` to `fromMeters + lengthMeters`, on `side`, starting
 * `setbackMeters` past the road's edge (past its outermost bulge, where it
 * bends) and reaching `depthMeters` back from it. Rows of `crop` run along
 * the road. It drives like grass.
 */
export interface FieldDefinition {
  readonly roadId: string;
  readonly fromMeters: number;
  readonly lengthMeters: number;
  readonly side: RoadSide;
  readonly setbackMeters: number;
  readonly depthMeters: number;
  readonly crop: FieldCrop;
}

/** A wind turbine (scenery): a tall tower whose rotor turns in the wind. The tower is solid. */
export interface WindTurbineDefinition {
  readonly x: number;
  readonly z: number;
}

/**
 * A drivable area (spec §20, one region of the world): roads, buildings,
 * depots, rest areas, city name boards, the truck's start and scenery.
 */
export interface MapDefinition {
  /** Stable snake_case id. */
  readonly id: string;
  /** The playable area is the square from -halfSizeMeters to +halfSizeMeters on both axes. */
  readonly halfSizeMeters: number;
  readonly roads: readonly RoadDefinition[];
  readonly buildings: readonly BuildingDefinition[];
  readonly depots: readonly DepotDefinition[];
  readonly restAreas: readonly RestAreaDefinition[];
  /** Name boards where roads enter the cities. */
  readonly citySigns: readonly CitySignDefinition[];
  readonly fields: readonly FieldDefinition[];
  readonly windTurbines: readonly WindTurbineDefinition[];
  /** Where the truck starts: its rear axle position and heading (0° faces +Z, 90° faces +X). */
  readonly spawn: { readonly x: number; readonly z: number; readonly headingDegrees: number };
  /** Generated decoration: the same seed always produces the same scenery. */
  readonly scenery: {
    readonly seed: number;
    readonly treesPerKilometer: number;
    /**
     * Street lamps line the city roads (streets and ring roads) this far
     * apart, on alternate sides. Absent: the roads are unlit.
     */
    readonly streetLampSpacingMeters?: number;
  };
}

/** Street lamps stand at least this far apart along a road, meters. */
export const MIN_STREET_LAMP_SPACING_METERS = 10;

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
  if (validator.check(Array.isArray(map.restAreas), `${path}.restAreas`, 'must be a list')) {
    const seen = new Set<string>();
    map.restAreas.forEach((restArea, index) => {
      const restAreaPath = `${path}.restAreas[${index}]`;
      if (!validator.check(typeof restArea === 'object' && restArea !== null, restAreaPath, 'must be an object')) {
        return;
      }
      if (validator.id(restArea.id, `${restAreaPath}.id`)) {
        validator.check(!seen.has(restArea.id), `${restAreaPath}.id`, `duplicate rest area id "${restArea.id}"`);
        seen.add(restArea.id);
      }
      validateRectangle(restArea.lot, `${restAreaPath}.lot`, validator, inside);
    });
  }
  const roadIds = new Set(
    Array.isArray(map.roads) ? map.roads.filter((road) => typeof road === 'object' && road !== null).map((road) => road.id) : [],
  );
  if (validator.check(Array.isArray(map.citySigns), `${path}.citySigns`, 'must be a list')) {
    map.citySigns.forEach((sign, index) => {
      const signPath = `${path}.citySigns[${index}]`;
      if (!validator.check(typeof sign === 'object' && sign !== null, signPath, 'must be an object')) {
        return;
      }
      validator.id(sign.cityId, `${signPath}.cityId`);
      validator.check(roadIds.has(sign.roadId), `${signPath}.roadId`, `unknown road "${String(sign.roadId)}"`);
      validator.check(
        Number.isFinite(sign.distanceMeters) && sign.distanceMeters >= 0,
        `${signPath}.distanceMeters`,
        'must be zero or more',
      );
      validator.oneOf(sign.direction, ROAD_DIRECTIONS, `${signPath}.direction`);
    });
  }
  if (validator.check(Array.isArray(map.fields), `${path}.fields`, 'must be a list')) {
    map.fields.forEach((field, index) => {
      const fieldPath = `${path}.fields[${index}]`;
      if (validator.check(typeof field === 'object' && field !== null, fieldPath, 'must be an object')) {
        validator.check(roadIds.has(field.roadId), `${fieldPath}.roadId`, `unknown road "${String(field.roadId)}"`);
        validator.check(
          Number.isFinite(field.fromMeters) && field.fromMeters >= 0,
          `${fieldPath}.fromMeters`,
          'must be zero or more',
        );
        validator.positiveNumber(field.lengthMeters, `${fieldPath}.lengthMeters`);
        validator.oneOf(field.side, ROAD_SIDES, `${fieldPath}.side`);
        validator.check(
          Number.isFinite(field.setbackMeters) && field.setbackMeters >= 0,
          `${fieldPath}.setbackMeters`,
          'must be zero or more',
        );
        validator.positiveNumber(field.depthMeters, `${fieldPath}.depthMeters`);
        validator.oneOf(field.crop, FIELD_CROPS, `${fieldPath}.crop`);
      }
    });
  }
  if (validator.check(Array.isArray(map.windTurbines), `${path}.windTurbines`, 'must be a list')) {
    map.windTurbines.forEach((turbine, index) => {
      const turbinePath = `${path}.windTurbines[${index}]`;
      validator.check(
        typeof turbine === 'object' && turbine !== null && inside(turbine.x, turbine.z),
        turbinePath,
        'must be a point inside the map',
      );
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
    const lampSpacing = scenery.streetLampSpacingMeters;
    if (lampSpacing !== undefined) {
      validator.check(
        Number.isFinite(lampSpacing) && lampSpacing >= MIN_STREET_LAMP_SPACING_METERS,
        `${path}.scenery.streetLampSpacingMeters`,
        `must be at least ${MIN_STREET_LAMP_SPACING_METERS} m`,
      );
    }
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
  validator.oneOf(road.kind, ROAD_KINDS, `${path}.kind`);
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
