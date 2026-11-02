import type { MapDefinition, Point2, RectangleDefinition, RoadDefinition } from '../definitions/MapDefinition';

/**
 * Metropol: the second region, an original city on a strait (no real-world
 * copy). The map is 8.4 km across. It is laid out below with x east and z
 * north, then turned over (flipNorth) to the game's own maps' way, north
 * toward −z, as the map and the compass show it.
 *
 * - The strait runs north to south through it, 520 m wide.
 * - Halverton, west of it, is a grid of avenues (north–south) and streets
 *   (east–west) lined with glass towers (a `towers` district), a big park in
 *   its middle, the waterfront boulevard along the strait. Its westernmost
 *   avenue goes on north onto the motorway.
 * - Northgate, north of downtown, is blocks of flats.
 * - Ironquay, south-west, is the port: sheds and the container terminal.
 * - The M1 motorway (three lanes each way) crosses the map along z = 1300:
 *   it climbs onto a viaduct over Halverton's avenues and the boulevard and
 *   crosses the strait on a suspension bridge 45 m over the water.
 * - Eastmere, on the east bank, is offices and flats. The south bridge, lower
 *   and narrower, joins it to the port across the strait.
 * - A mountain pass winds north from Eastmere over the ridge to Ridgemont,
 *   through the pines.
 * - The ferry to North Valley leaves from the terminal south of the
 *   boulevard.
 *
 * The grids' roads share their control points where they cross, which is
 * where junctions are; the motorway crosses over the avenues and the
 * boulevard on its deck without meeting them.
 */

/** Halverton's avenues (x) and streets (z). */
const AVENUES = [-1600, -1360, -1120, -880, -640, -400, -160] as const;
const STREETS = [-450, -270, -90, 90, 270, 450, 630, 810, 990] as const;
/** The waterfront boulevard runs north–south here; the west boulevard here. */
const BOULEVARD_X = 60;
const WEST_BOULEVARD_X = -2200;
/** Streets reaching west to the west boulevard. */
const WEST_STREETS = [-90, 450, 990] as const;
/** Northgate's streets (z), from x = -880 to the boulevard. */
const NORTHGATE_STREETS = [1550, 1800, 2050, 2300] as const;
/** The avenues that run on north under the motorway into Northgate. */
const NORTH_AVENUES = [-400, -160] as const;
/** The port road. */
const PORT_ROAD_Z = -1700;
/** The motorway's line, its width, and where it meets the boulevards at grade. */
const MOTORWAY_Z = 1300;
const EAST_BOULEVARD_X = 2000;
/** Eastmere's streets (z) and avenues (x), east of the east boulevard. */
const EASTMERE_STREETS = [-700, -450, -200, 50, 300, 550, 800] as const;
const EASTMERE_AVENUES = [2300, 2600, 2900, 3200] as const;

const north = (x: number, from: number, to: number, zs: readonly number[]): Point2[] =>
  [...new Set([from, ...zs.filter((z) => z > from && z < to), to])].sort((a, b) => a - b).map((z): Point2 => [x, z]);
const east = (z: number, from: number, to: number, xs: readonly number[]): Point2[] =>
  [...new Set([from, ...xs.filter((x) => x > from && x < to), to])].sort((a, b) => a - b).map((x): Point2 => [x, z]);

/**
 * Halverton Park: the blocks between these avenues (x) and streets (z) are
 * one big park, the avenues and streets through it stopping at its edges.
 */
const PARK = { west: -1360, east: -880, south: 270, north: 810 } as const;
/** The avenue that goes on north to the motorway, where it is still on the ground: the city's way onto it. */
const MOTORWAY_AVENUE_X = AVENUES[0];

/** `points`, a straight road along `axis` (0: x, 1: z), less its stretch through the park: the pieces before and after it. */
const aroundPark = (points: readonly Point2[], axis: 0 | 1, from: number, to: number): Point2[][] =>
  [points.filter((point) => point[axis] <= from), points.filter((point) => point[axis] >= to)].filter((piece) => piece.length >= 2);

const halvertonAvenues: RoadDefinition[] = AVENUES.flatMap((x, index) => {
  const to = (NORTH_AVENUES as readonly number[]).includes(x)
    ? NORTHGATE_STREETS[NORTHGATE_STREETS.length - 1]! // On north under the motorway into Northgate.
    : x === MOTORWAY_AVENUE_X
      ? MOTORWAY_Z
      : STREETS[STREETS.length - 1]!;
  const points = north(x, STREETS[0], to, [...STREETS, ...NORTHGATE_STREETS]);
  const pieces = x > PARK.west && x < PARK.east ? aroundPark(points, 1, PARK.south, PARK.north) : [points];
  return pieces.map(
    (controlPoints, piece): RoadDefinition => ({
      id: `halverton_avenue_${index + 1}${pieces.length === 1 ? '' : piece === 0 ? '_south' : '_north'}`,
      kind: 'street',
      widthMeters: 14,
      closed: false,
      controlPoints,
    }),
  );
});

const halvertonStreets: RoadDefinition[] = STREETS.flatMap((z, index) => {
  const points = east(z, (WEST_STREETS as readonly number[]).includes(z) ? WEST_BOULEVARD_X : AVENUES[0], BOULEVARD_X, AVENUES);
  const pieces = z > PARK.south && z < PARK.north ? aroundPark(points, 0, PARK.west, PARK.east) : [points];
  return pieces.map(
    (controlPoints, piece): RoadDefinition => ({
      id: `halverton_street_${index + 1}${pieces.length === 1 ? '' : piece === 0 ? '_west' : '_east'}`,
      kind: 'street',
      widthMeters: 12,
      closed: false,
      controlPoints,
    }),
  );
});

const northgateStreets: RoadDefinition[] = NORTHGATE_STREETS.map((z, index) => ({
  id: `northgate_street_${index + 1}`,
  kind: 'street',
  widthMeters: 11,
  closed: false,
  controlPoints: east(z, -880, BOULEVARD_X, [...NORTH_AVENUES]),
}));

const eastmereStreets: RoadDefinition[] = EASTMERE_STREETS.map((z, index) => ({
  id: `eastmere_street_${index + 1}`,
  kind: 'street',
  widthMeters: 12,
  closed: false,
  controlPoints: east(z, EAST_BOULEVARD_X, EASTMERE_AVENUES[EASTMERE_AVENUES.length - 1]!, EASTMERE_AVENUES),
}));

const eastmereAvenues: RoadDefinition[] = EASTMERE_AVENUES.map((x, index) => ({
  id: `eastmere_avenue_${index + 1}`,
  kind: 'street',
  widthMeters: 12,
  closed: false,
  controlPoints: north(x, EASTMERE_STREETS[0], EASTMERE_STREETS[EASTMERE_STREETS.length - 1]!, EASTMERE_STREETS),
}));

/**
 * The motorway: straight along z = MOTORWAY_Z from the west edge to the
 * east, so a point's distance along it is its x plus 4190. It climbs at 5%
 * onto its viaduct from x = -1250, crosses the strait at 45 m on the
 * suspension bridge (towers at x = 200 and 720, on the shores), and comes
 * down again by x = 1950, before the east boulevard.
 */
const MOTORWAY_START_X = -4190;
const along = (x: number): number => x - MOTORWAY_START_X;
const motorway: RoadDefinition = {
  id: 'm1_motorway',
  kind: 'highway',
  widthMeters: 26,
  closed: false,
  controlPoints: [MOTORWAY_START_X, -3600, -3000, WEST_BOULEVARD_X, -1600, -1000, -400, 200, 720, 1300, EAST_BOULEVARD_X, 2600, 3300, 4190].map(
    (x): Point2 => [x, MOTORWAY_Z],
  ),
  profile: [
    { atMeters: along(-1250), heightMeters: 0 },
    { atMeters: along(-350), heightMeters: 45 },
    { atMeters: along(1080), heightMeters: 45 },
    { atMeters: along(1950), heightMeters: 0 },
  ],
  elevated: [[along(-1170), along(1870)]],
  suspension: { towersAtMeters: [along(200), along(720)], towerHeightMeters: 95, backSpanMeters: 300 },
};

/**
 * The south bridge: from the port road's end at the waterfront boulevard,
 * straight east over the strait to the east boulevard, two lanes each way.
 * It climbs at 7% from the boulevard to 24 m, crosses on a lower suspension
 * bridge (towers at x = 380, by the west shore, and 900, on the east), and
 * comes down to Eastmere.
 */
const SOUTH_BRIDGE_Z = PORT_ROAD_Z;
const fromBoulevard = (x: number): number => x - BOULEVARD_X;
const southBridge: RoadDefinition = {
  id: 'south_bridge',
  kind: 'highway',
  widthMeters: 18,
  closed: false,
  controlPoints: [BOULEVARD_X, 380, 900, 1450, EAST_BOULEVARD_X].map((x): Point2 => [x, SOUTH_BRIDGE_Z]),
  profile: [
    { atMeters: 0, heightMeters: 0 },
    { atMeters: fromBoulevard(390), heightMeters: 24 },
    { atMeters: fromBoulevard(910), heightMeters: 24 },
    { atMeters: fromBoulevard(EAST_BOULEVARD_X), heightMeters: 0 },
  ],
  elevated: [[40, fromBoulevard(EAST_BOULEVARD_X) - 60]],
  suspension: { towersAtMeters: [fromBoulevard(380), fromBoulevard(900)], towerHeightMeters: 70, backSpanMeters: 200 },
};

const roads: RoadDefinition[] = [
  motorway,
  southBridge,
  ...halvertonAvenues,
  ...halvertonStreets,
  {
    id: 'waterfront_boulevard',
    kind: 'ringRoad',
    widthMeters: 14,
    closed: false,
    controlPoints: north(BOULEVARD_X, -2400, 2500, [PORT_ROAD_Z, ...STREETS, ...NORTHGATE_STREETS]),
  },
  {
    id: 'west_boulevard',
    kind: 'street',
    widthMeters: 14,
    closed: false,
    controlPoints: north(WEST_BOULEVARD_X, PORT_ROAD_Z, MOTORWAY_Z, [...WEST_STREETS]),
  },
  {
    id: 'port_road',
    kind: 'street',
    widthMeters: 12,
    closed: false,
    controlPoints: east(PORT_ROAD_Z, -2700, BOULEVARD_X, [WEST_BOULEVARD_X]),
  },
  {
    id: 'ferry_road',
    kind: 'street',
    widthMeters: 11,
    closed: false,
    controlPoints: [
      [BOULEVARD_X, -2400],
      [200, -2400],
      [330, -2400],
    ],
  },
  ...northgateStreets,
  {
    id: 'northgate_west_street',
    kind: 'street',
    widthMeters: 11,
    closed: false,
    controlPoints: north(-880, NORTHGATE_STREETS[0], NORTHGATE_STREETS[NORTHGATE_STREETS.length - 1]!, NORTHGATE_STREETS),
  },
  {
    id: 'east_boulevard',
    kind: 'ringRoad',
    widthMeters: 14,
    closed: false,
    controlPoints: north(EAST_BOULEVARD_X, -1800, 1600, [SOUTH_BRIDGE_Z, ...EASTMERE_STREETS, MOTORWAY_Z]),
  },
  ...eastmereStreets,
  ...eastmereAvenues,
  {
    id: 'ridgemont_pass',
    kind: 'rural',
    widthMeters: 9,
    closed: false,
    controlPoints: [
      [EAST_BOULEVARD_X, 1600],
      [2150, 1950],
      [2500, 2180],
      [2300, 2460],
      [2660, 2660],
      [2560, 2960],
      [2950, 3160],
      [3200, 3500],
    ],
  },
  {
    id: 'ridgemont_main_street',
    kind: 'street',
    widthMeters: 10,
    closed: false,
    controlPoints: [
      [2950, 3500],
      [3200, 3500],
      [3500, 3500],
    ],
  },
];

const LAID_OUT: MapDefinition = {
  id: 'metropol',
  halfSizeMeters: 4200,
  roads,
  buildings: [
    // The ferry terminal's hall by its quay.
    { x: 300, z: -2440, widthMeters: 40, depthMeters: 22, heightMeters: 9 },
    // Ridgemont's quarry sheds, past the town.
    { x: 3560, z: 3560, widthMeters: 30, depthMeters: 24, heightMeters: 10 },
  ],
  depots: [
    {
      id: 'city_h_depot',
      cityId: 'city_h',
      yard: { x: -2218, z: 200, headingDegrees: 0, lengthMeters: 44, widthMeters: 26 },
      bay: { x: -2218, z: 200, headingDegrees: 0, lengthMeters: 16, widthMeters: 4.6 },
    },
    {
      id: 'city_i_depot',
      cityId: 'city_i',
      yard: { x: 42, z: 2400, headingDegrees: 0, lengthMeters: 44, widthMeters: 26 },
      bay: { x: 42, z: 2400, headingDegrees: 0, lengthMeters: 16, widthMeters: 4.6 },
    },
    {
      id: 'city_j_depot',
      cityId: 'city_j',
      yard: { x: -1000, z: -1717, headingDegrees: 90, lengthMeters: 44, widthMeters: 26 },
      bay: { x: -1000, z: -1717, headingDegrees: 90, lengthMeters: 16, widthMeters: 4.6 },
    },
    {
      id: 'city_k_depot',
      cityId: 'city_k',
      yard: { x: 1982, z: -1200, headingDegrees: 0, lengthMeters: 44, widthMeters: 26 },
      bay: { x: 1982, z: -1200, headingDegrees: 0, lengthMeters: 16, widthMeters: 4.6 },
    },
    {
      id: 'city_l_depot',
      cityId: 'city_l',
      yard: { x: 3350, z: 3516, headingDegrees: 90, lengthMeters: 44, widthMeters: 26 },
      bay: { x: 3350, z: 3516, headingDegrees: 90, lengthMeters: 16, widthMeters: 4.6 },
    },
  ],
  restAreas: [
    {
      id: 'm1_rest_area',
      lot: { x: -3300, z: MOTORWAY_Z + 28, headingDegrees: 90, lengthMeters: 90, widthMeters: 34 },
    },
  ],
  citySigns: [
    { cityId: 'city_h', roadId: 'halverton_street_3', distanceMeters: 300, direction: 'forward' },
    { cityId: 'city_h', roadId: 'waterfront_boulevard', distanceMeters: 1700, direction: 'forward' },
    { cityId: 'city_i', roadId: 'halverton_avenue_7', distanceMeters: 1900, direction: 'forward' },
    { cityId: 'city_i', roadId: 'waterfront_boulevard', distanceMeters: 3850, direction: 'forward' },
    { cityId: 'city_j', roadId: 'waterfront_boulevard', distanceMeters: 900, direction: 'backward' },
    { cityId: 'city_j', roadId: 'west_boulevard', distanceMeters: 150, direction: 'backward' },
    { cityId: 'city_k', roadId: 'east_boulevard', distanceMeters: 300, direction: 'forward' },
    { cityId: 'city_k', roadId: 'east_boulevard', distanceMeters: 2900, direction: 'backward' },
    { cityId: 'city_l', roadId: 'ridgemont_pass', distanceMeters: 2620, direction: 'forward' },
  ],
  fields: [],
  windTurbines: [],
  rivers: [
    {
      id: 'grand_strait',
      widthMeters: 520,
      points: [
        [760, 4200],
        [620, 2600],
        [460, MOTORWAY_Z],
        [470, 0],
        [620, -1400],
        [700, -2800],
        [640, -4200],
      ],
    },
  ],
  // The forests are kept to where the roads run by them (about 40,000 trees in all, three times North Valley's):
  // the pass climbs through the pines, the northern mountains' slopes face Northgate, woods cover the
  // south-east hills.
  forests: [
    // The pines either side of the pass.
    {
      id: 'ridge_pines_west',
      kind: 'pine',
      outline: [
        [1700, 2000],
        [2080, 2000],
        [2380, 2200],
        [2200, 2450],
        [2250, 2560],
        [2540, 2720],
        [2470, 3000],
        [2500, 3200],
        [1800, 3000],
      ],
    },
    {
      id: 'ridge_pines_east',
      kind: 'pine',
      outline: [
        [2350, 1960],
        [2850, 1950],
        [3300, 2350],
        [3150, 3050],
        [3020, 3120],
        [2720, 2960],
        [2790, 2650],
        [2440, 2470],
        [2620, 2200],
      ],
    },
    {
      id: 'north_forest',
      kind: 'pine',
      outline: [
        [-3500, 2900],
        [-2000, 2850],
        [-1500, 3300],
        [-1600, 3950],
        [-3500, 3950],
      ],
    },
    {
      id: 'east_woods',
      kind: 'mixed',
      outline: [
        [2500, -1800],
        [3700, -1750],
        [3700, -3000],
        [2450, -3000],
      ],
    },
  ],
  terrain: {
    hills: [
      // The ridge the pass climbs over, either side of it.
      { x: 2050, z: 2900, radiusMeters: 1100, heightMeters: 230 },
      { x: 3300, z: 2350, radiusMeters: 850, heightMeters: 180 },
      // The mountains along the north, behind Northgate.
      { x: -2500, z: 3400, radiusMeters: 1300, heightMeters: 260 },
      { x: -1000, z: 3700, radiusMeters: 900, heightMeters: 160 },
      // Wooded hills in the south-east.
      { x: 3000, z: -2700, radiusMeters: 1100, heightMeters: 120 },
    ],
  },
  parks: [
    {
      id: 'halverton_park',
      area: {
        x: (PARK.west + PARK.east) / 2,
        z: (PARK.south + PARK.north) / 2,
        headingDegrees: 0,
        lengthMeters: PARK.north - PARK.south - 24,
        widthMeters: PARK.east - PARK.west - 26,
      },
    },
    // A block of Northgate's, a square in Eastmere, a green by the port, Ridgemont's by its main street.
    { id: 'northgate_park', area: { x: -280, z: 1925, headingDegrees: 0, lengthMeters: 200, widthMeters: 190 } },
    { id: 'eastmere_square', area: { x: 2750, z: 175, headingDegrees: 0, lengthMeters: 150, widthMeters: 180 } },
    { id: 'ironquay_green', area: { x: -1000, z: -1580, headingDegrees: 0, lengthMeters: 140, widthMeters: 200 } },
    { id: 'ridgemont_green', area: { x: 3380, z: 3440, headingDegrees: 0, lengthMeters: 70, widthMeters: 120 } },
  ],
  districts: [
    { id: 'halverton_towers', kind: 'towers', area: { x: -880, z: 270, headingDegrees: 0, lengthMeters: 1500, widthMeters: 1480 } },
    { id: 'northgate_flats', kind: 'apartments', area: { x: -410, z: 1925, headingDegrees: 0, lengthMeters: 850, widthMeters: 940 } },
    { id: 'ironquay_port', kind: 'harbour', area: { x: -1300, z: -2050, headingDegrees: 0, lengthMeters: 600, widthMeters: 2000 } },
    { id: 'eastmere_offices', kind: 'offices', area: { x: 2600, z: 50, headingDegrees: 0, lengthMeters: 1560, widthMeters: 1240 } },
    { id: 'ridgemont_town', kind: 'oldTown', area: { x: 3225, z: 3500, headingDegrees: 0, lengthMeters: 200, widthMeters: 560 } },
  ],
  gates: [
    {
      id: 'metropol_ferry',
      area: { x: 330, z: -2400, headingDegrees: 90, lengthMeters: 40, widthMeters: 30 },
      toMapId: 'north_valley',
      toGateId: 'gull_point_ferry',
      arrival: { x: 250, z: -2400, headingDegrees: 270 },
    },
  ],
  spawn: { x: WEST_BOULEVARD_X + 3.5, z: 120, headingDegrees: 0 },
  scenery: {
    seed: 20261102,
    treesPerKilometer: 40,
    streetLampSpacingMeters: 30,
    streetscape: true,
    countryside: false,
    roadSigns: true,
    sideRoadsPerKilometer: 0,
  },
};

/** A point laid out with z north, on the game's maps (north toward −z). */
const flip = ([x, z]: Point2): Point2 => [x, -z];
/** A heading (degrees, 0 along +z) laid out with z north, on the game's maps. */
const flipHeading = (degrees: number): number => (180 - degrees + 360) % 360;
/** A rectangle laid out with z north, on the game's maps: a half turn is the same rectangle, so 0° stays 0°. */
const flipRectangle = (area: RectangleDefinition): RectangleDefinition => ({
  ...area,
  z: -area.z,
  headingDegrees: (180 - area.headingDegrees + 360) % 180,
});

/** `map` laid out with z north, turned over to the game's maps' way (north toward −z): every point and heading. */
function flipNorth(map: MapDefinition): MapDefinition {
  return {
    ...map,
    roads: map.roads.map((road) => ({ ...road, controlPoints: road.controlPoints.map(flip) })),
    buildings: map.buildings.map((building) => ({ ...building, z: -building.z })),
    depots: map.depots.map((depot) => ({ ...depot, yard: flipRectangle(depot.yard), bay: flipRectangle(depot.bay) })),
    restAreas: map.restAreas.map((restArea) => ({ ...restArea, lot: flipRectangle(restArea.lot) })),
    rivers: (map.rivers ?? []).map((river) => ({ ...river, points: river.points.map(flip) })),
    forests: (map.forests ?? []).map((forest) => ({ ...forest, outline: forest.outline.map(flip) })),
    terrain: { hills: (map.terrain?.hills ?? []).map((hill) => ({ ...hill, z: -hill.z })) },
    parks: (map.parks ?? []).map((park) => ({ ...park, area: flipRectangle(park.area) })),
    districts: (map.districts ?? []).map((district) => ({ ...district, area: flipRectangle(district.area) })),
    gates: (map.gates ?? []).map((gate) => ({
      ...gate,
      area: flipRectangle(gate.area),
      arrival: { x: gate.arrival.x, z: -gate.arrival.z, headingDegrees: flipHeading(gate.arrival.headingDegrees) },
    })),
    spawn: { x: map.spawn.x, z: -map.spawn.z, headingDegrees: flipHeading(map.spawn.headingDegrees) },
  };
}

export const METROPOL_MAP: MapDefinition = flipNorth(LAID_OUT);
