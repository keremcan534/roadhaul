import { describe, expect, it } from 'vitest';
import { CARGO } from '../../../../src/data/content/cargo';
import { CITIES } from '../../../../src/data/content/cities';
import { RIVALS } from '../../../../src/data/content/rivals';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { vehicleCanHaul, type MissionDefinition } from '../../../../src/data/definitions/MissionDefinition';
import type { ContractMarket } from '../../../../src/domain/missions/contractGenerator';
import { isTenderId, planTender, TENDER_ID_PREFIX, type TenderRules } from '../../../../src/domain/rivals/tenders';

const MARKET: ContractMarket = {
  cities: CITIES,
  cargo: CARGO,
  vehicles: VEHICLES,
  distanceMeters: (from, to) => (from === 'city_c' || to === 'city_c' ? 4000 : 3000),
};
const RULES: TenderRules = { prizeShare: 0.6, rivalSpeedKmh: 40, unloadSeconds: 3 };
const BOX_TRUCK = VEHICLES.find((vehicle) => vehicle.id === 'rh_h1')!;

function canHaulWith(level: number) {
  return (contract: MissionDefinition) =>
    (contract.requiredCompanyLevel ?? 1) <= level &&
    vehicleCanHaul(BOX_TRUCK, contract, CARGO.find((cargo) => cargo.id === contract.cargoId)!);
}

function plan(number: number, overrides: { canTake?: (contract: MissionDefinition) => boolean; rivals?: typeof RIVALS } = {}) {
  return planTender({
    market: MARKET,
    number,
    rivals: overrides.rivals ?? RIVALS,
    rules: RULES,
    canTake: overrides.canTake ?? canHaulWith(1),
  });
}

describe('planTender', () => {
  it('numbers tenders as generated contracts of their own, the same for the same number', () => {
    const first = plan(0)!;
    expect(first.contract.id).toBe(`${TENDER_ID_PREFIX}1`);
    expect(first.contract.id.startsWith('daily_')).toBe(true);
    expect(isTenderId(first.contract.id)).toBe(true);
    expect(isTenderId('daily_123_1')).toBe(false);
    expect(plan(0)).toEqual(first);
    const routes = new Set(Array.from({ length: 30 }, (_, number) => {
      const tender = plan(number)!;
      return `${tender.contract.originCityId}>${tender.contract.destinationCityId}`;
    }));
    expect(routes.size).toBeGreaterThan(3);
  });

  it('offers a contract the company can take now if the batch has one', () => {
    for (let number = 0; number < 40; number++) {
      const tender = plan(number)!;
      expect(canHaulWith(1)(tender.contract), tender.contract.id).toBe(true);
    }
    // A bigger company with every truck gets the batch's hardest.
    const hard = Array.from({ length: 40 }, (_, number) => plan(number, { canTake: () => true })!);
    expect(hard.every((tender) => tender.contract.difficulty === 'hard')).toBe(true);
    // Nothing it can take: the batch's first.
    expect(plan(3, { canTake: () => false })!.contract.difficulty).toBe('easy');
  });

  it('is raced by the rival at home at either end, at its pace, and pays a prize on top', () => {
    for (let number = 0; number < 40; number++) {
      const tender = plan(number)!;
      const rival = RIVALS.find((candidate) => candidate.id === tender.rivalId)!;
      expect([tender.contract.originCityId, tender.contract.destinationCityId]).toContain(rival.homeCityId);
      const meters = MARKET.distanceMeters(tender.contract.originCityId, tender.contract.destinationCityId);
      expect(tender.rivalSeconds).toBeCloseTo(meters / ((40 / 3.6) * rival.speedFactor) + 3, 6);
      expect(tender.prize).toBe(Math.round((tender.contract.baseReward * 0.6) / 10) * 10);
      expect(tender.prize).toBeGreaterThan(0);
      // The rival is quicker than the contract's time limit asks.
      expect(tender.rivalSeconds).toBeLessThan(tender.contract.timeLimitSeconds);
    }
  });

  it('is raced by any rival still in business when none is at home there, and by none when all are gone', () => {
    const away = RIVALS.find((rival) => rival.homeCityId === 'city_b')!;
    const tenders = Array.from({ length: 30 }, (_, number) => plan(number, { rivals: [away] })!);
    expect(tenders.every((tender) => tender.rivalId === away.id)).toBe(true);
    expect(plan(0, { rivals: [] })).toBeNull();
    expect(planTender({ market: { ...MARKET, cities: CITIES.slice(0, 1) }, number: 0, rivals: RIVALS, rules: RULES, canTake: () => true })).toBeNull();
  });
});
