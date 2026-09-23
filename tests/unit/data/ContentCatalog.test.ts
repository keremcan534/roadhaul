import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/core/validation/Validator';
import { ContentCatalog, validateGameContent } from '../../../src/data/ContentCatalog';
import { GAME_CONTENT } from '../../../src/data/content';
import type { CargoCategory } from '../../../src/data/definitions/CargoDefinition';
import type { VehicleClass } from '../../../src/data/definitions/VehicleDefinition';
import {
  cargoFixture,
  cityFixture,
  contentFixture,
  mapFixture,
  missionFixture,
  vehicleFixture,
} from '../../support/contentFixtures';

function issuePaths(content: Parameters<typeof validateGameContent>[0]): string[] {
  return validateGameContent(content).map((issue) => issue.path);
}

describe('ContentCatalog', () => {
  it('accepts the built-in placeholder content', () => {
    expect(validateGameContent(GAME_CONTENT)).toEqual([]);

    const catalog = ContentCatalog.create(GAME_CONTENT);

    expect(catalog.vehicles.size).toBeGreaterThan(0);
    expect(catalog.cargo.size).toBeGreaterThan(0);
    expect(catalog.cities.size).toBe(3);
    expect(catalog.missions.size).toBeGreaterThan(0);
  });

  it('looks definitions up by id', () => {
    const catalog = ContentCatalog.create(contentFixture());

    expect(catalog.vehicles.get('test_truck').maxPayloadTons).toBe(10);
    expect(catalog.missions.has('test_mission')).toBe(true);
    expect(catalog.cargo.find('gold')).toBeUndefined();
    expect(() => catalog.cities.get('atlantis')).toThrow('Unknown city "atlantis".');
  });

  it('keeps deep-frozen copies so definitions cannot be mutated at runtime', () => {
    const content = contentFixture();
    const catalog = ContentCatalog.create(content);
    const truck = catalog.vehicles.get('test_truck');

    expect(truck).not.toBe(content.vehicles[0]);
    expect(Object.isFrozen(truck)).toBe(true);
    expect(Object.isFrozen(catalog.vehicles.all)).toBe(true);
    expect(() => {
      (truck as { maxSpeedKmh: number }).maxSpeedKmh = 300;
    }).toThrow(TypeError);
  });

  it('reports duplicate ids within a definition kind', () => {
    const content = contentFixture({ cargo: [cargoFixture(), cargoFixture()] });

    expect(issuePaths(content)).toEqual(['cargo[1].id']);
  });

  it('reports invalid fields with their paths', () => {
    const content = contentFixture({
      vehicles: [vehicleFixture({ id: 'Bad Id', fuelCapacityLiters: -5, vehicleClass: 'flying' as VehicleClass })],
      cargo: [cargoFixture({ damageSensitivity: 1.5, category: 'gold' as CargoCategory })],
    });

    expect(issuePaths(content)).toEqual([
      'vehicles[0].id',
      'vehicles[0].vehicleClass',
      'vehicles[0].fuelCapacityLiters',
      'cargo[0].category',
      'cargo[0].damageSensitivity',
    ]);
  });

  it('reports missions that reference unknown cities or cargo', () => {
    const content = contentFixture({
      missions: [missionFixture({ originCityId: 'nowhere', destinationCityId: 'elsewhere', cargoId: 'gold' })],
    });

    expect(issuePaths(content)).toEqual([
      'missions[0].originCityId',
      'missions[0].destinationCityId',
      'missions[0].cargoId',
    ]);
  });

  it('reports missions whose origin and destination are the same city', () => {
    const content = contentFixture({ missions: [missionFixture({ destinationCityId: 'test_origin' })] });

    expect(validateGameContent(content)).toEqual([
      { path: 'missions[0].destinationCityId', message: 'must differ from originCityId' },
    ]);
  });

  it('reports missions no vehicle can haul', () => {
    const tooHeavy = missionFixture({ id: 'too_heavy', cargoWeightTons: 40 });
    const wrongClass = missionFixture({ id: 'wrong_class', requiredVehicleClass: 'heavy' });
    const wrongBody = missionFixture({ id: 'wrong_body', cargoId: 'frozen_peas' });
    const content = contentFixture({
      cargo: [cargoFixture(), cargoFixture({ id: 'frozen_peas', temperature: 'frozen', requiredBody: 'refrigerated' })],
      missions: [tooHeavy, wrongClass, wrongBody],
    });

    expect(validateGameContent(content)).toEqual([
      { path: 'missions[0].cargoWeightTons', message: 'no vehicle with a body for box cargo can carry 40 t' },
      { path: 'missions[1].cargoWeightTons', message: 'no heavy vehicle with a body for box cargo can carry 5 t' },
      { path: 'missions[2].cargoWeightTons', message: 'no vehicle with a body for refrigerated cargo can carry 5 t' },
    ]);
  });

  it('reports depots of unknown cities, duplicate depots, and mission cities without a depot', () => {
    const map = mapFixture();
    const strayDepot = { ...map.depots[0]!, id: 'stray_depot', cityId: 'atlantis' };
    const content = contentFixture({
      cities: [cityFixture(), cityFixture({ id: 'test_destination' }), cityFixture({ id: 'lonely_town' })],
      missions: [missionFixture({ destinationCityId: 'lonely_town' })],
      maps: [{ ...map, depots: [...map.depots, strayDepot, { ...map.depots[0]!, cityId: 'test_destination' }] }],
    });

    expect(validateGameContent(content)).toEqual([
      { path: 'missions[0].destinationCityId', message: 'city "lonely_town" has no depot on any map' },
      { path: 'maps[0].depots[2].cityId', message: 'unknown city "atlantis"' },
      { path: 'maps[0].depots[3].id', message: 'duplicate depot id "test_origin_depot"' },
    ]);
  });

  it('reports entries that are not objects instead of crashing on them', () => {
    const content = {
      vehicles: [null],
      cargo: [5],
      cities: [null, cityFixture(), cityFixture({ id: 'test_destination' })],
      missions: [null, missionFixture()],
      maps: [],
    } as unknown as Parameters<typeof validateGameContent>[0];

    expect(issuePaths(content)).toEqual([
      'vehicles[0]',
      'cargo[0]',
      'cities[0]',
      'missions[0]',
      'missions[1].originCityId', // No maps, so no depots.
      'missions[1].destinationCityId',
      'missions[1].cargoId',
    ]);
    expect(() => ContentCatalog.create(content)).toThrow(ValidationError);
  });

  it('refuses to build a catalog from invalid content, listing every problem', () => {
    const content = contentFixture({
      cities: [cityFixture()],
      missions: [missionFixture({ cargoId: 'gold' })],
    });

    let thrown: unknown;
    try {
      ContentCatalog.create(content);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    expect((thrown as ValidationError).issues.map((issue) => issue.path)).toEqual([
      'missions[0].destinationCityId',
      'missions[0].cargoId',
      'maps[0].depots[1].cityId', // The fixture's destination depot lost its city too.
    ]);
  });
});
