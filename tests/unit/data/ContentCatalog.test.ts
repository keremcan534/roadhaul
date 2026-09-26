import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/core/validation/Validator';
import { WEATHER_CHOICES } from '../../../src/data/config/controls';
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
  rivalFixture,
  vehicleFixture,
  weatherFixture,
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
      missions: [missionFixture({ requiredCompanyLevel: 0 })],
    });

    expect(issuePaths(content)).toEqual([
      'vehicles[0].id',
      'vehicles[0].vehicleClass',
      'vehicles[0].fuelCapacityLiters',
      'cargo[0].category',
      'cargo[0].damageSensitivity',
      'missions[0].requiredCompanyLevel',
      'rivals[0].vehicleId', // The fixture's rival runs the truck renamed above.
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

  it('reports weathers that would turn into one that does not exist', () => {
    const content = contentFixture({ weather: [weatherFixture({ next: ['test_rain', 'blizzard'] })] });

    expect(validateGameContent(content)).toEqual([
      { path: 'weather[0].next[0]', message: 'unknown weather "test_rain"' },
      { path: 'weather[0].next[1]', message: 'unknown weather "blizzard"' },
    ]);
  });

  it('has every weather the player may hold in Settings', () => {
    const catalog = ContentCatalog.create(GAME_CONTENT);

    for (const choice of WEATHER_CHOICES.filter((choice) => choice !== 'auto')) {
      expect(catalog.weather.has(choice), choice).toBe(true);
    }
  });

  it('keeps the ids of generated contracts out of the game\'s own', () => {
    const content = contentFixture({ missions: [missionFixture({ id: 'daily_1_1' })] });

    expect(validateGameContent(content)).toEqual([
      { path: 'missions[0].id', message: 'ids starting with "daily_" are kept for generated contracts' },
    ]);
  });

  it('reports city name boards of unknown cities', () => {
    const map = mapFixture();
    const content = contentFixture({
      maps: [
        {
          ...map,
          citySigns: [
            { cityId: 'test_origin', roadId: 'test_road', distanceMeters: 10, direction: 'forward' },
            { cityId: 'atlantis', roadId: 'test_road', distanceMeters: 290, direction: 'backward' },
          ],
        },
      ],
    });

    expect(validateGameContent(content)).toEqual([
      { path: 'maps[0].citySigns[1].cityId', message: 'unknown city "atlantis"' },
    ]);
  });

  it('reports rivals at home where there is no depot, or in another rival\'s city, in its colour, or in trucks that do not exist', () => {
    const content = contentFixture({
      cities: [cityFixture(), cityFixture({ id: 'test_destination', specialization: 'industrial' }), cityFixture({ id: 'test_village', specialization: 'agricultural' })],
      rivals: [
        rivalFixture(),
        rivalFixture({ id: 'test_twin', color: 0x3355cc }),
        rivalFixture({ id: 'test_farmers', color: 0x22aa44, homeCityId: 'test_village', vehicleId: 'hovercraft' }),
        rivalFixture({ id: 'test_ghosts', color: 0x999999, homeCityId: 'atlantis' }),
      ],
    });

    expect(validateGameContent(content)).toEqual([
      { path: 'rivals[1].homeCityId', message: 'another rival is at home in "test_destination"' },
      { path: 'rivals[1].color', message: 'another rival has this colour' },
      { path: 'rivals[2].homeCityId', message: 'city "test_village" has no depot on any map' },
      { path: 'rivals[2].vehicleId', message: 'unknown vehicle "hovercraft"' },
      { path: 'rivals[3].homeCityId', message: 'unknown city "atlantis"' },
    ]);
  });

  it('reports entries that are not objects instead of crashing on them', () => {
    const content = {
      vehicles: [null],
      cargo: [5],
      cities: [null, cityFixture(), cityFixture({ id: 'test_destination' })],
      missions: [null, missionFixture()],
      maps: [],
      upgrades: [7],
      trafficVehicles: ['car'],
      weather: [null],
      daylight: [null],
      events: [null],
      paints: [null],
      drivers: [null],
      rivals: [null],
    } as unknown as Parameters<typeof validateGameContent>[0];

    expect(issuePaths(content)).toEqual([
      'vehicles[0]',
      'cargo[0]',
      'cities[0]',
      'missions[0]',
      'upgrades[0]',
      'trafficVehicles[0]',
      'weather[0]',
      'daylight[0]',
      'events[0]',
      'paints[0]',
      'drivers[0]',
      'rivals[0]',
      'missions[1].originCityId', // No maps, so no depots.
      'missions[1].destinationCityId',
      'missions[1].cargoId',
      'daylight', // Dawn, dusk and night are all missing.
      'daylight',
      'daylight',
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
      'maps[0].depots[1].cityId', // The fixture's destination depot lost its city too…
      'rivals[0].homeCityId', // …and so did the rival at home there.
    ]);
  });
});
