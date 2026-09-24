import type { MapDefinition } from '../definitions/MapDefinition';

/**
 * The MVP's region (spec §20, roadmap step 21): three original cities joined
 * by the four kinds of road.
 *
 * - City A, Yeniliman (west): the starting town, where the high street
 *   crosses the harbour road. The company's home depot is on the high street.
 * - City B, Demirkent (east): an industrial estate inside a ring road.
 * - City C, Başakova (north): a farm village on one street.
 * - The highway joins A's harbour road to B's ring road, with a rest area
 *   half way (spec §25). Country roads join A to C and C to B.
 *
 * Roads meet where they share a control point. The map is a miniature of
 * spec §76's 35 km prototype: routes between depots are 3 to 4 km, a few
 * minutes' driving on a phone.
 */
export const MAPS: readonly MapDefinition[] = [
  {
    id: 'north_valley',
    halfSizeMeters: 2400,
    roads: [
      {
        id: 'a_high_street',
        kind: 'street',
        widthMeters: 10,
        closed: false,
        controlPoints: [
          [-1700, -760],
          [-1700, -500],
          [-1700, -250],
          [-1700, 0],
          [-1700, 200],
        ],
      },
      {
        id: 'a_harbour_road',
        kind: 'street',
        widthMeters: 10,
        closed: false,
        controlPoints: [
          [-2100, -250],
          [-1900, -250],
          [-1700, -250],
          [-1550, -250],
          [-1400, -250],
        ],
      },
      {
        id: 'highway_a_b',
        kind: 'highway',
        widthMeters: 14,
        closed: false,
        controlPoints: [
          [-1400, -250],
          [-1100, -330],
          [-700, -520],
          [-300, -640],
          [100, -660],
          [500, -620],
          [900, -560],
          [1250, -520],
          [1550, -500],
        ],
      },
      {
        id: 'b_ring_road',
        kind: 'ringRoad',
        widthMeters: 11,
        closed: true,
        controlPoints: [
          [1550, -600],
          [1600, -690],
          [1800, -730],
          [2000, -690],
          [2060, -600],
          [2060, -550],
          [2060, -450],
          [2060, -400],
          [2000, -310],
          [1800, -280],
          [1600, -310],
          [1550, -400],
          [1550, -450],
          [1550, -500],
          [1550, -550],
        ],
      },
      {
        id: 'rural_a_c',
        kind: 'rural',
        widthMeters: 8,
        closed: false,
        controlPoints: [
          [-1700, 200],
          [-1660, 450],
          [-1470, 700],
          [-1170, 860],
          [-860, 1010],
          [-600, 1210],
          [-350, 1410],
          [-100, 1500],
        ],
      },
      {
        id: 'c_village_street',
        kind: 'street',
        widthMeters: 9,
        closed: false,
        controlPoints: [
          [-100, 1500],
          [100, 1500],
          [300, 1500],
          [500, 1500],
          [700, 1500],
        ],
      },
      {
        id: 'rural_c_b',
        kind: 'rural',
        widthMeters: 8,
        closed: false,
        controlPoints: [
          [700, 1500],
          [1000, 1350],
          [1250, 1100],
          [1450, 800],
          [1600, 450],
          [1720, 100],
          [1800, -280],
        ],
      },
    ],
    buildings: [
      // City A: shops and offices along the high street and the harbour road…
      { x: -1665, z: -440, widthMeters: 22, depthMeters: 36, heightMeters: 10 },
      { x: -1665, z: -370, widthMeters: 22, depthMeters: 28, heightMeters: 14 },
      { x: -1665, z: -310, widthMeters: 22, depthMeters: 24, heightMeters: 8 },
      { x: -1650, z: -205, widthMeters: 30, depthMeters: 20, heightMeters: 12 },
      { x: -1600, z: -205, widthMeters: 26, depthMeters: 20, heightMeters: 9 },
      { x: -1560, z: -300, widthMeters: 30, depthMeters: 26, heightMeters: 11 },
      { x: -1760, z: -190, widthMeters: 30, depthMeters: 24, heightMeters: 16 },
      { x: -1760, z: -120, widthMeters: 28, depthMeters: 26, heightMeters: 10 },
      { x: -1665, z: 60, widthMeters: 22, depthMeters: 30, heightMeters: 9 },
      // …the home depot's office and warehouse…
      { x: -1745, z: -450, widthMeters: 12, depthMeters: 20, heightMeters: 6 },
      { x: -1790, z: -440, widthMeters: 30, depthMeters: 40, heightMeters: 11 },
      // …and the harbour sheds.
      { x: -2020, z: -300, widthMeters: 40, depthMeters: 30, heightMeters: 13 },
      { x: -2040, z: -200, widthMeters: 36, depthMeters: 26, heightMeters: 9 },
      // City B: warehouses inside the ring road, a chimney, and the depot's office and sheds outside it.
      { x: 1700, z: -600, widthMeters: 60, depthMeters: 40, heightMeters: 14 },
      { x: 1880, z: -600, widthMeters: 70, depthMeters: 44, heightMeters: 16 },
      { x: 1700, z: -420, widthMeters: 56, depthMeters: 36, heightMeters: 12 },
      { x: 1890, z: -420, widthMeters: 64, depthMeters: 40, heightMeters: 18 },
      { x: 1985, z: -650, widthMeters: 8, depthMeters: 8, heightMeters: 30 },
      { x: 2105, z: -500, widthMeters: 10, depthMeters: 24, heightMeters: 7 },
      { x: 2150, z: -560, widthMeters: 40, depthMeters: 50, heightMeters: 12 },
      { x: 2150, z: -440, widthMeters: 40, depthMeters: 50, heightMeters: 10 },
      // City C: barns, a silo and farmhouses along the village street.
      { x: 300, z: 1440, widthMeters: 30, depthMeters: 20, heightMeters: 9 },
      { x: 345, z: 1450, widthMeters: 8, depthMeters: 8, heightMeters: 16 },
      { x: 150, z: 1540, widthMeters: 18, depthMeters: 14, heightMeters: 7 },
      { x: 420, z: 1545, widthMeters: 26, depthMeters: 18, heightMeters: 8 },
      { x: 560, z: 1455, widthMeters: 34, depthMeters: 22, heightMeters: 9 },
      { x: 40, z: 1455, widthMeters: 20, depthMeters: 16, heightMeters: 6 },
      // The rest area's shop, behind its lot.
      { x: 100, z: -603, widthMeters: 26, depthMeters: 14, heightMeters: 6 },
    ],
    // Each yard's near long side overlaps its road by 2 m, so the truck can drive straight in.
    depots: [
      {
        id: 'city_a_depot',
        cityId: 'city_a',
        yard: { x: -1716, z: -450, headingDegrees: 0, lengthMeters: 44, widthMeters: 26 },
        bay: { x: -1716, z: -450, headingDegrees: 0, lengthMeters: 16, widthMeters: 4.6 },
      },
      {
        id: 'city_b_depot',
        cityId: 'city_b',
        yard: { x: 2076.5, z: -500, headingDegrees: 0, lengthMeters: 44, widthMeters: 26 },
        bay: { x: 2076.5, z: -500, headingDegrees: 0, lengthMeters: 16, widthMeters: 4.6 },
      },
      {
        id: 'city_c_depot',
        cityId: 'city_c',
        yard: { x: 300, z: 1484.5, headingDegrees: 90, lengthMeters: 44, widthMeters: 26 },
        bay: { x: 300, z: 1484.5, headingDegrees: 90, lengthMeters: 16, widthMeters: 4.6 },
      },
    ],
    restAreas: [
      {
        id: 'valley_rest_area',
        lot: { x: 100, z: -638, headingDegrees: 90, lengthMeters: 90, widthMeters: 34 },
      },
    ],
    // Each town's name greets the traffic coming in on each of its two roads from the country.
    citySigns: [
      { cityId: 'city_a', roadId: 'highway_a_b', distanceMeters: 70, direction: 'backward' },
      { cityId: 'city_a', roadId: 'rural_a_c', distanceMeters: 70, direction: 'backward' },
      { cityId: 'city_b', roadId: 'highway_a_b', distanceMeters: 2940, direction: 'forward' },
      { cityId: 'city_b', roadId: 'rural_c_b', distanceMeters: 2100, direction: 'forward' },
      { cityId: 'city_c', roadId: 'rural_a_c', distanceMeters: 2080, direction: 'forward' },
      { cityId: 'city_c', roadId: 'rural_c_b', distanceMeters: 70, direction: 'backward' },
    ],
    // Farmland: fields line the country roads, with Başakova's own behind the village houses, and a few along the
    // highway. Each lies beside a stretch of road, a few meters back from its edge.
    fields: [
      { roadId: 'rural_a_c', fromMeters: 140, lengthMeters: 170, side: 'left', setbackMeters: 10, depthMeters: 110, crop: 'wheat' },
      { roadId: 'rural_a_c', fromMeters: 330, lengthMeters: 160, side: 'right', setbackMeters: 12, depthMeters: 120, crop: 'green' },
      { roadId: 'rural_a_c', fromMeters: 560, lengthMeters: 180, side: 'left', setbackMeters: 10, depthMeters: 100, crop: 'stubble' },
      { roadId: 'rural_a_c', fromMeters: 800, lengthMeters: 170, side: 'right', setbackMeters: 10, depthMeters: 110, crop: 'ploughed' },
      { roadId: 'rural_a_c', fromMeters: 1040, lengthMeters: 190, side: 'left', setbackMeters: 12, depthMeters: 120, crop: 'wheat' },
      { roadId: 'rural_a_c', fromMeters: 1300, lengthMeters: 170, side: 'right', setbackMeters: 10, depthMeters: 100, crop: 'stubble' },
      { roadId: 'rural_a_c', fromMeters: 1560, lengthMeters: 180, side: 'left', setbackMeters: 10, depthMeters: 110, crop: 'green' },
      { roadId: 'rural_a_c', fromMeters: 1800, lengthMeters: 160, side: 'right', setbackMeters: 12, depthMeters: 120, crop: 'wheat' },
      { roadId: 'c_village_street', fromMeters: 60, lengthMeters: 170, side: 'right', setbackMeters: 72, depthMeters: 160, crop: 'green' },
      { roadId: 'c_village_street', fromMeters: 250, lengthMeters: 180, side: 'right', setbackMeters: 72, depthMeters: 160, crop: 'stubble' },
      { roadId: 'c_village_street', fromMeters: 450, lengthMeters: 180, side: 'right', setbackMeters: 72, depthMeters: 160, crop: 'wheat' },
      { roadId: 'c_village_street', fromMeters: 60, lengthMeters: 170, side: 'left', setbackMeters: 75, depthMeters: 140, crop: 'wheat' },
      { roadId: 'c_village_street', fromMeters: 250, lengthMeters: 180, side: 'left', setbackMeters: 75, depthMeters: 140, crop: 'green' },
      { roadId: 'c_village_street', fromMeters: 450, lengthMeters: 180, side: 'left', setbackMeters: 75, depthMeters: 140, crop: 'ploughed' },
      { roadId: 'rural_c_b', fromMeters: 150, lengthMeters: 170, side: 'right', setbackMeters: 10, depthMeters: 110, crop: 'stubble' },
      { roadId: 'rural_c_b', fromMeters: 380, lengthMeters: 170, side: 'left', setbackMeters: 12, depthMeters: 100, crop: 'wheat' },
      { roadId: 'rural_c_b', fromMeters: 620, lengthMeters: 180, side: 'right', setbackMeters: 10, depthMeters: 120, crop: 'green' },
      { roadId: 'rural_c_b', fromMeters: 880, lengthMeters: 170, side: 'left', setbackMeters: 10, depthMeters: 110, crop: 'ploughed' },
      { roadId: 'rural_c_b', fromMeters: 1150, lengthMeters: 170, side: 'right', setbackMeters: 12, depthMeters: 100, crop: 'wheat' },
      { roadId: 'highway_a_b', fromMeters: 500, lengthMeters: 220, side: 'right', setbackMeters: 15, depthMeters: 130, crop: 'wheat' },
      { roadId: 'highway_a_b', fromMeters: 1900, lengthMeters: 220, side: 'left', setbackMeters: 15, depthMeters: 130, crop: 'green' },
    ],
    // A wind farm in the valley beside the highway, and three turbines beside the country road into Demirkent.
    windTurbines: [
      { x: -560, z: -380 },
      { x: -340, z: -360 },
      { x: -120, z: -350 },
      { x: 100, z: -360 },
      { x: 320, z: -370 },
      { x: 540, z: -390 },
      { x: 1400, z: 200 },
      { x: 1330, z: 430 },
      { x: 1250, z: 650 },
    ],
    // On A's high street, in the lane heading north past the home depot (traffic keeps right).
    spawn: { x: -1702.5, z: -600, headingDegrees: 0 },
    // Street lamps light the three towns' streets and B's ring road, on alternate sides.
    scenery: { seed: 20260923, treesPerKilometer: 70, streetLampSpacingMeters: 26 },
  },
];
