import type { MapDefinition } from '../definitions/MapDefinition';

/**
 * The first drivable map (roadmap step 08): a ~2.4 km closed test road with
 * long sweepers, a chicane and a tight hairpin that needs braking. Three
 * depots sit beside it: the company's home depot near the start (city A),
 * an industrial yard in the east (city B) and a farm yard in the west
 * (city C). The 3-city map arrives in step 21.
 */
export const MAPS: readonly MapDefinition[] = [
  {
    id: 'test_track',
    halfSizeMeters: 520,
    roads: [
      {
        id: 'test_loop',
        kind: 'rural',
        widthMeters: 10,
        closed: true,
        controlPoints: [
          [0, -300],
          [150, -320],
          [300, -250],
          [380, -100],
          [360, 60],
          [260, 160],
          [120, 140],
          [40, 220],
          [60, 340],
          [-60, 400],
          [-220, 360],
          [-330, 250],
          [-360, 80],
          [-300, -80],
          [-200, -200],
          [-100, -290],
        ],
      },
    ],
    buildings: [
      { x: -20, z: -350, widthMeters: 32, depthMeters: 16, heightMeters: 9 },
      { x: 30, z: -356, widthMeters: 18, depthMeters: 12, heightMeters: 6 },
      { x: 64, z: -352, widthMeters: 14, depthMeters: 10, heightMeters: 5 },
      { x: 180, z: 60, widthMeters: 40, depthMeters: 26, heightMeters: 14 },
      { x: -170, z: 250, widthMeters: 24, depthMeters: 24, heightMeters: 10 },
      // City B's warehouses, east of its yard.
      { x: 432, z: -58, widthMeters: 24, depthMeters: 40, heightMeters: 12 },
      { x: 432, z: -12, widthMeters: 24, depthMeters: 26, heightMeters: 9 },
      // City C's barn and store, west of its yard.
      { x: -408, z: 96, widthMeters: 16, depthMeters: 26, heightMeters: 8 },
      { x: -404, z: 124, widthMeters: 8, depthMeters: 8, heightMeters: 14 },
    ],
    // Each yard's near edge overlaps the road, so the truck can drive straight in.
    depots: [
      {
        id: 'city_a_depot',
        cityId: 'city_a',
        yard: { x: 55.8, z: -328.9, headingDegrees: 103, lengthMeters: 44, widthMeters: 26 },
        bay: { x: 55.8, z: -328.9, headingDegrees: 103, lengthMeters: 16, widthMeters: 4.6 },
      },
      {
        id: 'city_b_depot',
        cityId: 'city_b',
        yard: { x: 400.8, z: -47.3, headingDegrees: -2, lengthMeters: 44, widthMeters: 26 },
        bay: { x: 400.8, z: -47.3, headingDegrees: -2, lengthMeters: 16, widthMeters: 4.6 },
      },
      {
        id: 'city_c_depot',
        cityId: 'city_c',
        yard: { x: -378.1, z: 107.1, headingDegrees: 180, lengthMeters: 44, widthMeters: 26 },
        bay: { x: -378.1, z: 107.1, headingDegrees: 180, lengthMeters: 16, widthMeters: 4.6 },
      },
    ],
    spawn: { x: 0, z: -300, headingDegrees: 97 },
    scenery: { seed: 20260923, treesPerKilometer: 90 },
  },
];
