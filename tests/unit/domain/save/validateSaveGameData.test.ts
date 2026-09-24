import { describe, expect, it } from 'vitest';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { createNewSaveGameData } from '../../../../src/domain/save/createNewSaveGameData';
import { CURRENT_SAVE_VERSION, type SaveGameData } from '../../../../src/domain/save/SaveGameData';
import { validateSaveGameData } from '../../../../src/domain/save/validateSaveGameData';
import { contentFixture, missionFixture, vehicleFixture } from '../../../support/contentFixtures';

const content = ContentCatalog.create(contentFixture());
const MAX_LEVEL = 5;

/** A valid save for the fixture content: test_truck (300 L tank) on test_map (±200 m). */
function save(): SaveGameData {
  return createNewSaveGameData({
    companyName: 'Kuzey Lojistik',
    startingCredits: 5000,
    startingVehicle: vehicleFixture(),
    startingMapId: 'test_map',
    nowMs: 1000,
  });
}

/** A copy of the valid save with one part replaced. */
function withPart(path: string, value: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(save())) as Record<string, unknown>;
  const keys = path.split('.');
  let target = copy;
  for (const key of keys.slice(0, -1)) {
    target = target[key] as Record<string, unknown>;
  }
  target[keys[keys.length - 1]!] = value;
  return copy;
}

function paths(data: unknown): string[] {
  return validateSaveGameData(data, content, MAX_LEVEL).map((issue) => issue.path);
}

describe('validateSaveGameData', () => {
  it('accepts a new game and a game in progress', () => {
    const inProgress = {
      ...save(),
      world: { mapId: 'test_map', truck: { x: 12, z: -40, headingRadians: 7.5 } },
      missions: {
        active: {
          missionId: 'test_mission',
          state: 'delivering',
          handlingSeconds: 0,
          deliverySeconds: 42.5,
          cargoDamage: 0.05,
          failureReason: null,
          contract: null,
        },
      },
    };

    expect(paths(save())).toEqual([]);
    expect(paths(inProgress)).toEqual([]);
  });

  it('rejects things that are not saves at all', () => {
    expect(paths(null)).toEqual(['save']);
    expect(paths([])).toEqual(['save']);
    expect(paths({ version: CURRENT_SAVE_VERSION })).toEqual([
      'createdAtMs',
      'updatedAtMs',
      'profile',
      'company',
      'economy',
      'garage',
      'world',
      'missions',
      'stats',
      'events',
      'tutorial',
    ]);
  });

  it.each([
    ['version', CURRENT_SAVE_VERSION - 1],
    ['profile.companyName', ' padded '],
    ['profile.companyName', ''],
    ['company.level', 0],
    ['company.level', 6],
    ['company.xp', -1],
    ['company.reputation', 1.5],
    ['economy.credits', -10],
    ['economy.credits', 2 ** 60],
    ['world.mapId', 'atlantis'],
    ['world.truck', { x: 500, z: 0, headingRadians: 0 }],
    ['world.truck', { x: 0, z: 0 }],
    ['missions.active', 'yes'],
    ['stats.deliveriesCompleted', -2],
    ['stats.distanceDrivenMeters', Number.POSITIVE_INFINITY],
    ['events.runs', null],
    ['tutorial.step', 'finished'],
  ])('reports %s = %j', (path, value) => {
    expect(paths(withPart(path, value))).toEqual([path]);
  });

  it('checks every truck against its model and the active truck against the garage', () => {
    expect(paths(withPart('garage.vehicles', []))).toEqual(['garage.vehicles']);
    expect(paths(withPart('garage.vehicles.0.definitionId', 'ghost_truck'))).toEqual([
      'garage.vehicles[0].definitionId',
    ]);
    expect(paths(withPart('garage.vehicles.0.fuelLiters', 301))).toEqual(['garage.vehicles[0].fuelLiters']);
    expect(paths(withPart('garage.vehicles.0.damage', 1.2))).toEqual(['garage.vehicles[0].damage']);
    expect(paths(withPart('garage.vehicles.0.instanceId', 'truck'))).toEqual([
      'garage.vehicles[0].instanceId',
      'garage.activeVehicleInstanceId',
    ]);
    expect(paths(withPart('garage.activeVehicleInstanceId', 'truck_002'))).toEqual(['garage.activeVehicleInstanceId']);
  });

  it('checks each truck\'s paint: its factory colour, or a known one', () => {
    expect(paths(withPart('garage.vehicles.0.paintId', null))).toEqual([]);
    expect(paths(withPart('garage.vehicles.0.paintId', 'test_red'))).toEqual([]);
    for (const paintId of ['chrome', 7, undefined, '']) {
      expect(paths(withPart('garage.vehicles.0.paintId', paintId)), String(paintId)).toEqual(['garage.vehicles[0].paintId']);
    }
  });

  it('checks each truck\'s upgrades, and lets a bigger tank hold more fuel', () => {
    // The fixture upgrade adds engine power only; test_truck has a 300 L tank.
    expect(paths(withPart('garage.vehicles.0.upgrades', { test_upgrade: 2 }))).toEqual([]);
    expect(paths(withPart('garage.vehicles.0.upgrades', null))).toEqual(['garage.vehicles[0].upgrades']);
    expect(paths(withPart('garage.vehicles.0.upgrades', { test_upgrade: 3 }))).toEqual([
      'garage.vehicles[0].upgrades.test_upgrade',
    ]);
    expect(paths(withPart('garage.vehicles.0.upgrades', { test_upgrade: 0.5, turbo: 1 }))).toEqual([
      'garage.vehicles[0].upgrades.test_upgrade',
      'garage.vehicles[0].upgrades.turbo',
    ]);

    const tankContent = ContentCatalog.create(
      contentFixture({
        upgrades: [{ id: 'big_tank', look: 'fuelTank', levels: [{ cost: 100, modifiers: [{ stat: 'fuelCapacity', bonus: 0.5 }] }] }],
      }),
    );
    const fuelled = (liters: number, upgrades: Record<string, number>): unknown => {
      const data = withPart('garage.vehicles.0.upgrades', upgrades) as SaveGameData;
      return withFuel(data, liters);
    };
    const tankPaths = (data: unknown): string[] =>
      validateSaveGameData(data, tankContent, MAX_LEVEL).map((issue) => issue.path);
    expect(tankPaths(fuelled(450, { big_tank: 1 }))).toEqual([]);
    expect(tankPaths(fuelled(451, { big_tank: 1 }))).toEqual(['garage.vehicles[0].fuelLiters']);
    expect(tankPaths(fuelled(301, {}))).toEqual(['garage.vehicles[0].fuelLiters']);
  });

  it('keeps each event\'s latest run once, for events that exist', () => {
    const run = { eventId: 'test_event', edition: 3, progress: 1, rewarded: false };

    expect(paths(withPart('events.runs', [run]))).toEqual([]);
    expect(paths(withPart('events.runs', [{ ...run, rewarded: true, progress: 2 }]))).toEqual([]);
    expect(paths(withPart('events.runs', [{ ...run, eventId: 'ghost_week' }]))).toEqual(['events.runs[0].eventId']);
    expect(paths(withPart('events.runs', [run, run]))).toEqual(['events.runs[1].eventId']);
    expect(paths(withPart('events.runs', [{ ...run, edition: -1, progress: Number.NaN, rewarded: 'yes' }]))).toEqual([
      'events.runs[0].edition',
      'events.runs[0].progress',
      'events.runs[0].rewarded',
    ]);
    expect(paths(withPart('events.runs', [7]))).toEqual(['events.runs[0]']);
  });

  it('only keeps unfinished contracts of known missions', () => {
    const active = {
      missionId: 'test_mission',
      state: 'loaded',
      handlingSeconds: 0,
      deliverySeconds: 3,
      cargoDamage: 0,
      failureReason: null,
      contract: null,
    };

    expect(paths(withPart('missions.active', { ...active, missionId: 'ghost' }))).toEqual(['missions.active.missionId']);
    expect(paths(withPart('missions.active', { ...active, state: 'completed' }))).toEqual(['missions.active.state']);
    expect(paths(withPart('missions.active', { ...active, deliverySeconds: -1 }))).toEqual([
      'missions.active.deliverySeconds',
    ]);
    expect(paths(withPart('missions.active', { ...active, failureReason: 'abandoned' }))).toEqual([
      'missions.active.failureReason',
    ]);
  });

  it('keeps a generated contract whole: valid, under its own id, naming known cargo and cities', () => {
    const contract = missionFixture({ id: 'daily_7_2', baseReward: 1250 });
    const active = {
      missionId: 'daily_7_2',
      state: 'loaded',
      handlingSeconds: 0,
      deliverySeconds: 3,
      cargoDamage: 0,
      failureReason: null,
      contract,
    };

    expect(paths(withPart('missions.active', active))).toEqual([]);
    expect(paths(withPart('missions.active', { ...active, missionId: 'daily_7_3' }))).toEqual([
      'missions.active.contract.id',
    ]);
    expect(
      paths(withPart('missions.active', { ...active, contract: { ...contract, cargoId: 'gold', originCityId: 'atlantis' } })),
    ).toEqual(['missions.active.contract.cargoId', 'missions.active.contract.originCityId']);
    expect(paths(withPart('missions.active', { ...active, contract: { ...contract, timeLimitSeconds: -5 } }))).toEqual([
      'missions.active.contract.timeLimitSeconds',
    ]);
    expect(paths(withPart('missions.active', { ...active, contract: 'daily' }))).toEqual(['missions.active.contract']);
    // Without the field (a save of the wrong shape) it is not a contract either.
    const { contract: _dropped, ...withoutContract } = active;
    expect(paths(withPart('missions.active', withoutContract))).toEqual(['missions.active.contract']);
  });
});

function withFuel(data: SaveGameData, liters: number): unknown {
  const [truck] = data.garage.vehicles;
  return { ...data, garage: { ...data.garage, vehicles: [{ ...truck!, fuelLiters: liters }] } };
}
