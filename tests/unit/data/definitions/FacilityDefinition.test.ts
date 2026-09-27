import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { DEFAULT_GAME_CONFIG, validateGameConfig } from '../../../../src/data/config/GameConfig';
import { ContentCatalog, validateGameContent } from '../../../../src/data/ContentCatalog';
import { FACILITIES } from '../../../../src/data/content/facilities';
import {
  FACILITY_EFFECTS,
  validateFacilityDefinition,
  type FacilityDefinition,
} from '../../../../src/data/definitions/FacilityDefinition';
import { contentFixture, facilityFixture } from '../../../support/contentFixtures';

function issues(facility: FacilityDefinition): string[] {
  const validator = new Validator();
  validateFacilityDefinition(facility, 'facility', validator);
  return validator.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

describe('validateFacilityDefinition', () => {
  it('accepts the built-in facilities and the test fixture', () => {
    for (const facility of [...FACILITIES, facilityFixture()]) {
      expect(issues(facility), facility.id).toEqual([]);
    }
  });

  it('ships one facility for every effect, three levels each, a first one a new company can build', () => {
    expect(new Set(FACILITIES.map((facility) => facility.effect))).toEqual(new Set(FACILITY_EFFECTS));
    expect(FACILITIES).toHaveLength(FACILITY_EFFECTS.length);
    for (const facility of FACILITIES) {
      expect(facility.levels, facility.id).toHaveLength(3);
    }
    const openAtLevel1 = FACILITIES.filter((facility) => (facility.levels[0]!.requiredCompanyLevel ?? 1) === 1);
    expect(openAtLevel1.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...openAtLevel1.map((facility) => facility.levels[0]!.cost))).toBeLessThanOrEqual(5000);
  });

  it('wants a known effect, levels, whole costs and company levels', () => {
    expect(issues(facilityFixture({ effect: 'luck' as FacilityDefinition['effect'] }))[0]).toMatch(
      /^facility\.effect: must be one of repairDiscount, fuelDiscount, garageSlots, fleetPayBonus, marketShareBonus, xpBonus, extraContracts/,
    );
    expect(issues(facilityFixture({ levels: [] }))).toEqual(['facility.levels: must be a non-empty list']);
    expect(issues(facilityFixture({ levels: [{ cost: 10.5, value: 0.1 }] }))[0]).toMatch(/^facility\.levels\[0\]\.cost/);
    expect(issues(facilityFixture({ levels: [{ cost: 100, requiredCompanyLevel: 0, value: 0.1 }] }))[0]).toMatch(
      /^facility\.levels\[0\]\.requiredCompanyLevel/,
    );
    expect(issues(facilityFixture({ id: 'Bad Id' }))[0]).toMatch(/^facility\.id/);
  });

  it('keeps a discount below 1, a count whole, and a bonus within +200 %', () => {
    expect(issues(facilityFixture({ effect: 'fuelDiscount', levels: [{ cost: 100, value: 1 }] }))).toEqual([
      'facility.levels[0].value: must be below 1: "fuelDiscount" takes a share off',
    ]);
    expect(issues(facilityFixture({ effect: 'garageSlots', levels: [{ cost: 100, value: 1.5 }] }))).toEqual([
      'facility.levels[0].value: must be a whole number up to 10',
    ]);
    expect(issues(facilityFixture({ effect: 'extraContracts', levels: [{ cost: 100, value: 11 }] }))).toEqual([
      'facility.levels[0].value: must be a whole number up to 10',
    ]);
    expect(issues(facilityFixture({ effect: 'xpBonus', levels: [{ cost: 100, value: 2.5 }] }))).toEqual([
      'facility.levels[0].value: must be at most 2',
    ]);
    for (const value of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(issues(facilityFixture({ levels: [{ cost: 100, value }] })), String(value)).toEqual([
        'facility.levels[0].value: must be a number above 0',
      ]);
    }
  });

  it('never lets a higher level cost less, unlock earlier or do less', () => {
    expect(
      issues(
        facilityFixture({
          levels: [
            { cost: 3000, requiredCompanyLevel: 3, value: 0.3 },
            { cost: 2000, requiredCompanyLevel: 2, value: 0.3 },
          ],
        }),
      ),
    ).toEqual([
      'facility.levels[1].cost: must not be lower than the previous level',
      'facility.levels[1].requiredCompanyLevel: must not be lower than the previous level',
      'facility.levels[1].value: must be more than the previous level',
    ]);
  });
});

describe('facilities in the content and the config', () => {
  it('lets no two facilities do the same thing', () => {
    const twice = contentFixture({ facilities: [facilityFixture(), facilityFixture({ id: 'test_second_workshop' })] });

    expect(validateGameContent(twice).map((issue) => `${issue.path}: ${issue.message}`)).toEqual([
      'facilities[1].effect: "repairDiscount" is another facility\'s too',
    ]);
  });

  it('wants every level within the company\'s reach, and the job board within a dozen contracts', () => {
    const content = ContentCatalog.create(
      contentFixture({
        facilities: [
          facilityFixture({ levels: [{ cost: 100, requiredCompanyLevel: 9, value: 0.1 }] }),
          facilityFixture({ id: 'test_office', effect: 'extraContracts', levels: [{ cost: 100, value: 8 }] }),
        ],
      }),
    );

    expect(validateGameConfig(DEFAULT_GAME_CONFIG, content).map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['content.facilities[0].levels[0].requiredCompanyLevel', 'content.facilities[1].levels']),
    );
  });
});
