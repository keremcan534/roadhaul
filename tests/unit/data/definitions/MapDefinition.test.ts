import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { validateMapDefinition, type MapDefinition } from '../../../../src/data/definitions/MapDefinition';
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

  it('keeps roads, buildings and the spawn inside the map', () => {
    const map = mapFixture({
      roads: [
        {
          id: 'escape',
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
      scenery: { seed: 1.5, treesPerKilometer: -3 },
    });

    expect(issuePaths(map)).toEqual([
      'map.buildings[0].widthMeters',
      'map.buildings[0].heightMeters',
      'map.scenery.seed',
      'map.scenery.treesPerKilometer',
    ]);
  });
});
