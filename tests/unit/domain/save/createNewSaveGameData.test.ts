import { describe, expect, it } from 'vitest';
import {
  createNewSaveGameData,
  formatVehicleInstanceId,
  type NewGameParams,
} from '../../../../src/domain/save/createNewSaveGameData';
import { CURRENT_SAVE_VERSION } from '../../../../src/domain/save/SaveGameData';
import { vehicleFixture } from '../../../support/contentFixtures';

const NOW_MS = Date.UTC(2026, 8, 23, 12, 0, 0);

function params(overrides: Partial<NewGameParams> = {}): NewGameParams {
  return {
    companyName: '  Kuzey Lojistik ',
    startingCredits: 5000,
    startingVehicle: vehicleFixture({ id: 'rh_h1', fuelCapacityLiters: 150 }),
    startingMapId: 'test_track',
    nowMs: NOW_MS,
    ...overrides,
  };
}

describe('createNewSaveGameData', () => {
  it('creates a version-stamped save for a new company with a full, undamaged starter truck', () => {
    expect(createNewSaveGameData(params())).toEqual({
      version: CURRENT_SAVE_VERSION,
      createdAtMs: NOW_MS,
      updatedAtMs: NOW_MS,
      profile: { companyName: 'Kuzey Lojistik' },
      company: { level: 1, xp: 0, reputation: 0 },
      economy: { credits: 5000 },
      garage: {
        activeVehicleInstanceId: 'truck_001',
        vehicles: [{ instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 150, damage: 0, upgrades: {} }],
      },
      world: { mapId: 'test_track', truck: null },
      missions: { active: null },
      stats: { deliveriesCompleted: 0, deliveriesFailed: 0, creditsEarned: 0, distanceDrivenMeters: 0 },
    });
  });

  it('references the vehicle definition by id instead of embedding it', () => {
    const json = JSON.stringify(createNewSaveGameData(params()));

    expect(json).toContain('"definitionId":"rh_h1"');
    expect(json).not.toContain('maxSpeedKmh');
  });

  it('survives a JSON round trip unchanged', () => {
    const save = createNewSaveGameData(params());

    expect(JSON.parse(JSON.stringify(save))).toEqual(save);
  });

  it('rejects a company name the player should have been asked to fix', () => {
    expect(() => createNewSaveGameData(params({ companyName: ' ' }))).toThrow(RangeError);
  });

  it.each([-1, 10.5, Number.NaN])('rejects %s starting credits', (startingCredits) => {
    expect(() => createNewSaveGameData(params({ startingCredits }))).toThrow(RangeError);
  });
});

describe('formatVehicleInstanceId', () => {
  it.each([
    [1, 'truck_001'],
    [42, 'truck_042'],
    [1234, 'truck_1234'],
  ])('formats %i as %s', (sequence, expected) => {
    expect(formatVehicleInstanceId(sequence)).toBe(expected);
  });

  it.each([0, -1, 1.5])('rejects %s', (sequence) => {
    expect(() => formatVehicleInstanceId(sequence)).toThrow(RangeError);
  });
});
