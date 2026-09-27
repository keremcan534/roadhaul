import { describe, expect, it } from 'vitest';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { createNewSaveGameData } from '../../../../src/domain/save/createNewSaveGameData';
import type { MissionDefinition } from '../../../../src/data/definitions/MissionDefinition';
import type { ActiveMissionSaveData, SaveGameData } from '../../../../src/domain/save/SaveGameData';
import { summarizeSave } from '../../../../src/domain/save/saveSummary';
import { contentFixture, missionFixture, vehicleFixture } from '../../../support/contentFixtures';

const content = ContentCatalog.create(contentFixture());

function newSave(): SaveGameData {
  return createNewSaveGameData({
    companyName: 'Kuzey Lojistik',
    startingCredits: 5000,
    startingVehicle: vehicleFixture(),
    startingMapId: 'test_map',
    nowMs: 1_700_000_000_000,
  });
}

/** An active contract as the save keeps it, `contract` null for the game's own. */
function underWay(missionId: string, contract: MissionDefinition | null): ActiveMissionSaveData {
  return {
    missionId,
    state: 'loaded',
    handlingSeconds: 0,
    deliverySeconds: 12,
    cargoDamage: 0,
    failureReason: null,
    contract,
  };
}

describe('summarizeSave', () => {
  it('sums up a new company: its name, level, money, one truck, no drivers, no contract, at the map’s start', () => {
    expect(summarizeSave(newSave(), content)).toEqual({
      companyName: 'Kuzey Lojistik',
      level: 1,
      credits: 5000,
      trucks: 1,
      drivers: 0,
      deliveries: 0,
      truckModelId: 'test_truck',
      mapId: 'test_map',
      truck: null,
      contract: null,
      updatedAtMs: 1_700_000_000_000,
    });
  });

  it('names the truck being driven, where it was left and the game’s own contract under way', () => {
    const save = newSave();
    const later: SaveGameData = {
      ...save,
      garage: {
        activeVehicleInstanceId: 'truck_002',
        vehicles: [...save.garage.vehicles, { ...save.garage.vehicles[0]!, instanceId: 'truck_002', definitionId: 'big_truck' }],
      },
      world: { mapId: 'test_map', truck: { x: 12, z: -3, headingRadians: 1.5 } },
      missions: { active: underWay('test_mission', null) },
      stats: { ...save.stats, deliveriesCompleted: 7 },
    };

    const summary = summarizeSave(later, content);

    expect(summary).toMatchObject({ trucks: 2, deliveries: 7, truckModelId: 'big_truck', truck: { x: 12, z: -3, headingRadians: 1.5 } });
    expect(summary.contract).toEqual({
      missionId: 'test_mission',
      cargoId: 'test_cargo',
      originCityId: 'test_origin',
      destinationCityId: 'test_destination',
      state: 'loaded',
    });
  });

  it('reads a contract of the day from the save itself', () => {
    const daily = missionFixture({ id: 'daily_42_1', originCityId: 'test_destination', destinationCityId: 'test_origin' });

    const summary = summarizeSave({ ...newSave(), missions: { active: underWay('daily_42_1', daily) } }, content);

    expect(summary.contract).toMatchObject({ missionId: 'daily_42_1', originCityId: 'test_destination', destinationCityId: 'test_origin' });
  });
});
