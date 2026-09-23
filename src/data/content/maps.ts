import type { MapDefinition } from '../definitions/MapDefinition';

/**
 * The first drivable map (roadmap step 08): a ~2.6 km closed test road with
 * long sweepers, a chicane and a tight hairpin that needs braking, plus a
 * small depot beside the start. The 3-city map arrives in step 21.
 */
export const MAPS: readonly MapDefinition[] = [
  {
    id: 'test_track',
    halfSizeMeters: 520,
    roads: [
      {
        id: 'test_loop',
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
    ],
    spawn: { x: 0, z: -300, headingDegrees: 97 },
    scenery: { seed: 20260923, treesPerKilometer: 90 },
  },
];
