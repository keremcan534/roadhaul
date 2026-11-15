import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { GAME_CONTENT } from '../../../../src/data/content';
import {
  validateMissionDefinition,
  vehicleCanHaul,
  type MissionDefinition,
} from '../../../../src/data/definitions/MissionDefinition';
import { generateContracts, withVariant, type ContractMarket } from '../../../../src/domain/missions/contractGenerator';

const { cargo, vehicles } = GAME_CONTENT;
/** The cities with a depot on the starting map (North Valley's): the market the contracts below are dealt on. */
const startingMap = GAME_CONTENT.maps[0]!;
const cities = GAME_CONTENT.cities.filter((city) => startingMap.depots.some((depot) => depot.cityId === city.id));
/** Road distances between the towns' bays, as on the shipped map. */
const DISTANCES: Readonly<Record<string, number>> = {
  'city_a:city_b': 4390,
  'city_a:city_c': 3250,
  'city_a:city_d': 3330,
  'city_b:city_c': 3040,
  'city_b:city_d': 3200,
  'city_c:city_d': 6190,
  'city_a:city_e': 3160,
  'city_a:city_f': 6160,
  'city_a:city_g': 6840,
  'city_b:city_e': 5530,
  'city_b:city_f': 2880,
  'city_b:city_g': 3510,
  'city_c:city_e': 2530,
  'city_c:city_f': 5870,
  'city_c:city_g': 3610,
  'city_d:city_e': 6460,
  'city_d:city_f': 2860,
  'city_d:city_g': 6670,
  'city_e:city_f': 8370,
  'city_e:city_g': 5760,
  'city_f:city_g': 6300,
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
      // A rush is a quarter faster than its difficulty's pace, no more.
      const fastest = fastestAverageKmh[mission.difficulty] * (mission.variant === 'rush' ? 1.25 : 1);
      expect((meters / mission.timeLimitSeconds) * 3.6, mission.id).toBeLessThanOrEqual(fastest);
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

  it('deals a rush or a convoy now and then after the two easy openers, never an easy convoy, and never for a tender', () => {
    const later = batches.flatMap((batch) => batch.slice(2));
    const kinds = (variant: string) => later.filter((mission) => (mission.variant ?? 'standard') === variant);

    for (const batch of batches) {
      expect(batch.slice(0, 2).every((mission) => mission.variant === undefined)).toBe(true);
    }
    // Tenders draw negative batches.
    for (let tender = 1; tender < 100; tender++) {
      expect(generateContracts(market, -tender, 4).every((mission) => mission.variant === undefined)).toBe(true);
    }
    // About a fifth each (18% rushes, 20% convoys above easy), drawn apart from the rest of the batch.
    expect(kinds('rush').length / later.length).toBeGreaterThan(0.1);
    expect(kinds('rush').length / later.length).toBeLessThan(0.28);
    expect(kinds('convoy').length / later.length).toBeGreaterThan(0.1);
    expect(kinds('convoy').length / later.length).toBeLessThan(0.3);
    expect(kinds('convoy').some((mission) => mission.difficulty === 'easy')).toBe(false);
  });

  it('makes a rush of a job on four fifths of its clock for half as much again, and a convoy of it as it is', () => {
    const plain = generateContracts(market, -5, 4)[3]!; // A hard one, of a tender's batch: a plain one.

    const rush = withVariant(plain, 'rush');
    const convoy = withVariant(plain, 'convoy');

    expect(rush).toEqual({
      ...plain,
      variant: 'rush',
      timeLimitSeconds: Math.ceil((plain.timeLimitSeconds * 0.8) / 10) * 10,
      baseReward: Math.round((plain.baseReward * 1.5) / 50) * 50,
    });
    expect(convoy).toEqual({ ...plain, variant: 'convoy' });
  });

  it('deals nothing without two cities to drive between', () => {
    expect(generateContracts({ ...market, cities: cities.slice(0, 1) }, 5, 5)).toEqual([]);
  });
});
