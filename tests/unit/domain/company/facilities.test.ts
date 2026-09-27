import { describe, expect, it } from 'vitest';
import { FACILITIES } from '../../../../src/data/content/facilities';
import {
  facilityLevel,
  facilityPerks,
  nextFacilityLevel,
  NO_PERKS,
} from '../../../../src/domain/company/facilities';
import { facilityFixture } from '../../../support/contentFixtures';

describe('facilities', () => {
  const workshop = facilityFixture();
  const yard = facilityFixture({
    id: 'test_yard',
    effect: 'garageSlots',
    levels: [
      { cost: 100, value: 1 },
      { cost: 200, value: 3 },
    ],
  });

  it('gives no perks before anything is built', () => {
    expect(facilityPerks(FACILITIES, {})).toEqual(NO_PERKS);
    expect(Object.values(NO_PERKS).every((value) => value === 0)).toBe(true);
  });

  it('gives each facility\'s effect at the level built, the level replacing the one below', () => {
    expect(facilityPerks([workshop, yard], { test_workshop: 1 })).toEqual({ ...NO_PERKS, repairDiscount: 0.2 });
    expect(facilityPerks([workshop, yard], { test_workshop: 2, test_yard: 2 })).toEqual({
      ...NO_PERKS,
      repairDiscount: 0.4,
      garageSlots: 3,
    });
  });

  it('reads a saved level as it can be: none for an unknown, broken or negative one, the top for one too high', () => {
    expect(facilityLevel(workshop, {})).toBe(0);
    expect(facilityLevel(workshop, { test_workshop: 1.5 })).toBe(0);
    expect(facilityLevel(workshop, { test_workshop: -2 })).toBe(0);
    expect(facilityLevel(workshop, { test_workshop: 7 })).toBe(2);
    expect(facilityPerks([workshop], { test_workshop: 7, unknown_place: 3 })).toEqual({ ...NO_PERKS, repairDiscount: 0.4 });
  });

  it('names the next level to build, and none at the top', () => {
    expect(nextFacilityLevel(workshop, 0)).toBe(workshop.levels[0]);
    expect(nextFacilityLevel(workshop, 1)).toBe(workshop.levels[1]);
    expect(nextFacilityLevel(workshop, 2)).toBeNull();
  });

  it('gives a company with every facility at the top at most 45 % off repairs, 30 % off diesel and 4 more trucks', () => {
    const top = Object.fromEntries(FACILITIES.map((facility) => [facility.id, facility.levels.length]));
    const perks = facilityPerks(FACILITIES, top);

    expect(perks.repairDiscount).toBeCloseTo(0.45, 9);
    expect(perks.fuelDiscount).toBeCloseTo(0.3, 9);
    expect(perks.garageSlots).toBe(4);
    expect(perks.extraContracts).toBe(3);
  });
});
