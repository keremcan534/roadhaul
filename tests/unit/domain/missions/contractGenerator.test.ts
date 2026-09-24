import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { GAME_CONTENT } from '../../../../src/data/content';
import {
  validateMissionDefinition,
  vehicleCanHaul,
  type MissionDefinition,
} from '../../../../src/data/definitions/MissionDefinition';
import { generateContracts, type ContractMarket } from '../../../../src/domain/missions/contractGenerator';

const { cities, cargo, vehicles } = GAME_CONTENT;
/** Road distances between the three towns' bays, as on the shipped map. */
const DISTANCES: Readonly<Record<string, number>> = {
  'city_a:city_b': 4390,
  'city_a:city_c': 3250,
  'city_b:city_c': 3040,
};
const market: ContractMarket = {
  cities,
  cargo,
  vehicles,
  distanceMeters: (from, to) => DISTANCES[[from, to].sort().join(':')]!,
};
const cargoOf = (mission: MissionDefinition) => cargo.find((candidate) => candidate.id === mission.cargoId)!;
const haulers = (mission: MissionDefinition) =>
  vehicles.filter((vehicle) => vehicleCanHaul(vehicle, mission, cargoOf(mission)));
const startingTruck = vehicles.find((vehicle) => (vehicle.requiredCompanyLevel ?? 1) === 1)!;
/** Many batches, for what must hold for all of them. */
const batches = Array.from({ length: 300 }, (_, index) => generateContracts(market, 90_000 + index, 5));
const all = batches.flat();

describe('generateContracts', () => {
  it('deals the same contracts for the same batch, and others for the next', () => {
    expect(generateContracts(market, 81_234, 5)).toEqual(generateContracts(market, 81_234, 5));
    expect(generateContracts(market, 81_235, 5)).not.toEqual(generateContracts(market, 81_234, 5));
    expect(generateContracts(market, 81_234, 5).map((mission) => mission.id)).toEqual([
      'daily_81234_1',
      'daily_81234_2',
      'daily_81234_3',
      'daily_81234_4',
      'daily_81234_5',
    ]);
  });

  it('writes valid contracts between two different cities with a depot, for known cargo', () => {
    for (const mission of all) {
      const validator = new Validator();
      validateMissionDefinition(mission, 'mission', validator);
      expect(validator.issues, mission.id).toEqual([]);
      expect(mission.originCityId).not.toBe(mission.destinationCityId);
      expect(cities.map((city) => city.id)).toContain(mission.originCityId);
      expect(cities.map((city) => city.id)).toContain(mission.destinationCityId);
    }
  });

  it('offers only work some truck can haul, and never before that truck is for sale', () => {
    for (const mission of all) {
      const trucks = haulers(mission);
      expect(trucks.length, mission.id).toBeGreaterThan(0);
      const earliestTruck = Math.min(...trucks.map((vehicle) => vehicle.requiredCompanyLevel ?? 1));
      expect(mission.requiredCompanyLevel ?? 1, mission.id).toBeGreaterThanOrEqual(earliestTruck);
    }
  });

  it('opens every batch with two easy contracts for a new company and its starting truck', () => {
    for (const batch of batches) {
      for (const mission of batch.slice(0, 2)) {
        expect(mission.difficulty).toBe('easy');
        expect(mission.requiredCompanyLevel ?? 1).toBe(1);
        expect(haulers(mission)).toContain(startingTruck);
      }
    }
  });

  it('asks for more of harder work: a higher level and less time', () => {
    const levelOf = { easy: 1, normal: 2, hard: 3, expert: 4 } as const;
    const fastestAverageKmh = { easy: 34, normal: 40, hard: 48, expert: 48 } as const;
    for (const mission of all) {
      expect(mission.requiredCompanyLevel ?? 1).toBeGreaterThanOrEqual(levelOf[mission.difficulty]);
      const meters = market.distanceMeters(mission.originCityId, mission.destinationCityId);
      expect((meters / mission.timeLimitSeconds) * 3.6, mission.id).toBeLessThanOrEqual(fastestAverageKmh[mission.difficulty]);
    }
    expect(new Set(all.map((mission) => mission.difficulty))).toEqual(new Set(['easy', 'normal', 'hard', 'expert']));
  });

  it('pays more for harder and heavier work', () => {
    const average = (list: readonly MissionDefinition[]) => list.reduce((sum, mission) => sum + mission.baseReward, 0) / list.length;
    const byDifficulty = (difficulty: MissionDefinition['difficulty']) => all.filter((mission) => mission.difficulty === difficulty);
    expect(average(byDifficulty('normal'))).toBeGreaterThan(average(byDifficulty('easy')));
    expect(average(byDifficulty('hard'))).toBeGreaterThan(average(byDifficulty('normal')));
    const light = all.filter((mission) => mission.difficulty === 'normal' && mission.cargoWeightTons <= 4);
    const heavy = all.filter((mission) => mission.difficulty === 'normal' && mission.cargoWeightTons >= 8);
    expect(average(heavy)).toBeGreaterThan(average(light));
    for (const mission of all) {
      expect(mission.baseReward % 50).toBe(0);
    }
  });

  it('ships more of what a city makes from it', () => {
    const fromFarms = all.filter((mission) => mission.originCityId === 'city_c');
    const farmGoods = fromFarms.filter((mission) => ['agriculture', 'food', 'frozenFood'].includes(cargoOf(mission).category));
    const fromElsewhere = all.filter((mission) => mission.originCityId !== 'city_c');
    const farmGoodsElsewhere = fromElsewhere.filter((mission) =>
      ['agriculture', 'food', 'frozenFood'].includes(cargoOf(mission).category),
    );
    expect(farmGoods.length / fromFarms.length).toBeGreaterThan((farmGoodsElsewhere.length / fromElsewhere.length) * 1.3);
  });

  it('deals nothing without two cities to drive between', () => {
    expect(generateContracts({ ...market, cities: cities.slice(0, 1) }, 5, 5)).toEqual([]);
  });
});
