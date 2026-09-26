import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { CITIES } from '../../../../src/data/content/cities';
import { RIVALS } from '../../../../src/data/content/rivals';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import {
  PLAYER_COMPANY_ID,
  validateRivalCompanyDefinition,
  type RivalCompanyDefinition,
} from '../../../../src/data/definitions/RivalCompanyDefinition';
import { rivalFixture } from '../../../support/contentFixtures';

function issues(rival: RivalCompanyDefinition): string[] {
  const validator = new Validator();
  validateRivalCompanyDefinition(rival, 'rival', validator);
  return validator.issues.map((issue) => issue.path);
}

describe('validateRivalCompanyDefinition', () => {
  it('accepts the region\'s rivals and the test fixture', () => {
    for (const rival of [...RIVALS, rivalFixture()]) {
      expect(issues(rival), rival.id).toEqual([]);
    }
  });

  it('gives each of the three cities a rival of its own, each with its own colour and trucks of the game', () => {
    expect(new Set(RIVALS.map((rival) => rival.homeCityId))).toEqual(new Set(CITIES.map((city) => city.id)));
    expect(new Set(RIVALS.map((rival) => rival.color)).size).toBe(RIVALS.length);
    for (const rival of RIVALS) {
      expect(VEHICLES.some((vehicle) => vehicle.id === rival.vehicleId), rival.id).toBe(true);
    }
  });

  it('reports ids, colours, fleets, money, paces and aggression out of range', () => {
    const rival = rivalFixture({
      id: 'Bad Rival',
      color: 0x1000000,
      homeCityId: 'Nowhere',
      vehicleId: '',
      startingTrucks: 0,
      maxTrucks: -1,
      startingCredits: 10.5,
      speedFactor: 2,
      aggression: 1.5,
    });

    expect(issues(rival)).toEqual([
      'rival.id',
      'rival.color',
      'rival.homeCityId',
      'rival.vehicleId',
      'rival.startingTrucks',
      'rival.maxTrucks',
      'rival.startingCredits',
      'rival.speedFactor',
      'rival.aggression',
    ]);
    expect(issues(rivalFixture({ startingTrucks: 3, maxTrucks: 2 }))).toEqual(['rival.maxTrucks']);
  });

  it('keeps the player\'s id for the player', () => {
    expect(issues(rivalFixture({ id: PLAYER_COMPANY_ID }))).toEqual(['rival.id']);
  });
});
