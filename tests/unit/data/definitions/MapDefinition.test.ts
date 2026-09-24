import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import {
  rectangleContains,
  rectangleCorners,
  validateMapDefinition,
  type DepotDefinition,
  type MapDefinition,
  type RoadKind,
} from '../../../../src/data/definitions/MapDefinition';
import { mapFixture } from '../../../support/contentFixtures';

function issuePaths(map: MapDefinition): string[] {
  const validator = new Validator();
  validateMapDefinition(map, 'map', validator);
  return validator.issues.map((issue) => issue.path);
}

describe('validateMapDefinition', () => {
  it('accepts the fixture map', () => {
    expect(issuePaths(mapFixture())).toEqual([]);
  });

  it('requires at least one road with enough control points', () => {
    expect(issuePaths(mapFixture({ roads: [] }))).toEqual(['map.roads']);
    expect(
      issuePaths(
        mapFixture({
          roads: [
            {
              id: 'too_short',
              kind: 'street',
              widthMeters: 8,
              closed: true,
              controlPoints: [
                [0, 0],
                [10, 0],
              ],
            },
          ],
        }),
      ),
    ).toEqual(['map.roads[0].controlPoints']);
  });

  it('requires every road to be one of the spec §20 kinds', () => {
    const [road] = mapFixture().roads;

    expect(issuePaths(mapFixture({ roads: [{ ...road!, kind: 'motorway' as RoadKind }] }))).toEqual(['map.roads[0].kind']);
  });

  it('reports missing roads and buildings instead of crashing', () => {
    const map = mapFixture({ roads: [null], buildings: [undefined] } as unknown as Partial<MapDefinition>);

    expect(issuePaths(map)).toEqual(['map.roads[0]', 'map.buildings[0]']);
  });

  it('keeps roads, buildings and the spawn inside the map', () => {
    const map = mapFixture({
      roads: [
        {
          id: 'escape',
          kind: 'street',
          widthMeters: 8,
          closed: false,
          controlPoints: [
            [0, 0],
            [500, 0],
          ],
        },
      ],
      buildings: [{ x: 0, z: 300, widthMeters: 10, depthMeters: 10, heightMeters: 5 }],
      spawn: { x: 250, z: 0, headingDegrees: 0 },
    });

    expect(issuePaths(map)).toEqual(['map.roads[0].controlPoints[1]', 'map.buildings[0]', 'map.spawn']);
  });

  it('validates sizes and scenery settings', () => {
    const map = mapFixture({
      buildings: [{ x: 0, z: 0, widthMeters: 0, depthMeters: 10, heightMeters: -1 }],
      scenery: { seed: 1.5, treesPerKilometer: -3, streetLampSpacingMeters: 4 },
    });

    expect(issuePaths(map)).toEqual([
      'map.buildings[0].widthMeters',
      'map.buildings[0].heightMeters',
      'map.scenery.seed',
      'map.scenery.treesPerKilometer',
      'map.scenery.streetLampSpacingMeters',
    ]);
  });

  it('checks where city name boards stand: on a known road, a distance along it, facing one way', () => {
    const map = mapFixture({
      citySigns: [
        { cityId: 'test_origin', roadId: 'test_road', distanceMeters: 20, direction: 'forward' },
        { cityId: 'Test Origin', roadId: 'no_road', distanceMeters: -1, direction: 'sideways' as 'forward' },
        null as unknown as MapDefinition['citySigns'][number],
      ],
    });

    expect(issuePaths(map)).toEqual([
      'map.citySigns[1].cityId',
      'map.citySigns[1].roadId',
      'map.citySigns[1].distanceMeters',
      'map.citySigns[1].direction',
      'map.citySigns[2]',
    ]);
    expect(issuePaths(mapFixture({ citySigns: 'none' as unknown as MapDefinition['citySigns'] }))).toEqual(['map.citySigns']);
  });

  it('lights the city roads only when the map asks for street lamps', () => {
    const lit = (streetLampSpacingMeters?: number): MapDefinition =>
      mapFixture({ scenery: { seed: 1, treesPerKilometer: 0, ...(streetLampSpacingMeters === undefined ? {} : { streetLampSpacingMeters }) } });

    expect(issuePaths(lit())).toEqual([]);
    expect(issuePaths(lit(30))).toEqual([]);
    for (const spacing of [9, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(issuePaths(lit(spacing)), String(spacing)).toEqual(['map.scenery.streetLampSpacingMeters']);
    }
  });

  it('reports depots that are not objects or have broken rectangles', () => {
    const [depot] = mapFixture().depots;
    const broken: DepotDefinition = {
      ...depot!,
      id: 'Bad Depot',
      yard: { ...depot!.yard, lengthMeters: 0 },
      bay: null as unknown as DepotDefinition['bay'],
    };

    expect(issuePaths(mapFixture({ depots: [broken, undefined as unknown as DepotDefinition] }))).toEqual([
      'map.depots[0].id',
      'map.depots[0].yard.lengthMeters',
      'map.depots[0].bay',
      'map.depots[1]',
    ]);
  });

  it('keeps depots inside the map and their bays inside their yards', () => {
    const [depot] = mapFixture().depots;
    const outside: DepotDefinition = { ...depot!, yard: { ...depot!.yard, x: 190 } };
    // The yard reaches 22 m either side of its centre along X; this bay reaches 28 m.
    const strayBay: DepotDefinition = { ...depot!, bay: { ...depot!.bay, x: depot!.bay.x + 20 } };

    expect(issuePaths(mapFixture({ depots: [outside, strayBay] }))).toEqual([
      'map.depots[0].yard',
      'map.depots[1].bay',
    ]);
  });
});

describe('rectangles', () => {
  // 10 m long along 30°, 4 m wide, centred on (5, -2).
  const rectangle = { x: 5, z: -2, headingDegrees: 30, lengthMeters: 10, widthMeters: 4 };
  const along = { x: Math.sin(Math.PI / 6), z: Math.cos(Math.PI / 6) };
  const across = { x: Math.cos(Math.PI / 6), z: -Math.sin(Math.PI / 6) };
  const at = (l: number, w: number): [number, number] => [
    rectangle.x + along.x * l + across.x * w,
    rectangle.z + along.z * l + across.z * w,
  ];

  it('finds the four corners of a rotated rectangle', () => {
    const corners = rectangleCorners(rectangle);
    const expected = [at(5, 2), at(5, -2), at(-5, -2), at(-5, 2)];

    corners.forEach(([x, z], index) => {
      expect(x).toBeCloseTo(expected[index]![0], 9);
      expect(z).toBeCloseTo(expected[index]![1], 9);
    });
  });

  it('contains points by its own length and width, whatever its heading', () => {
    expect(rectangleContains(rectangle, ...at(0, 0))).toBe(true);
    expect(rectangleContains(rectangle, ...at(4.9, 1.9))).toBe(true);
    expect(rectangleContains(rectangle, ...at(5.1, 0))).toBe(false);
    expect(rectangleContains(rectangle, ...at(0, -2.1))).toBe(false);
    // The same point as seen from an unrotated rectangle would be inside.
    expect(rectangleContains(rectangle, 5 + 4.5, -2)).toBe(false);
  });

  it('grows by the margin on every side', () => {
    expect(rectangleContains(rectangle, ...at(6, 0), 1.01)).toBe(true);
    expect(rectangleContains(rectangle, ...at(0, 3), 1.01)).toBe(true);
    expect(rectangleContains(rectangle, ...at(6.1, 0), 1)).toBe(false);
  });
});
