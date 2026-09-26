import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { DRIVERS } from '../../../../src/data/content/drivers';
import { validateDriverDefinition, type DriverDefinition } from '../../../../src/data/definitions/DriverDefinition';
import { driverFixture } from '../../../support/contentFixtures';

function issues(driver: DriverDefinition): string[] {
  const validator = new Validator();
  validateDriverDefinition(driver, 'driver', validator);
  return validator.issues.map((issue) => issue.path);
}

describe('validateDriverDefinition', () => {
  it('accepts the drivers looking for work and the test fixture', () => {
    for (const driver of [...DRIVERS, driverFixture()]) {
      expect(issues(driver), driver.id).toEqual([]);
    }
  });

  it('makes a better driver quicker and safer, dearer to hire and asking a bigger share, and later to join', () => {
    const bySkill = [...DRIVERS].sort((a, b) => a.skill - b.skill);
    const skills = new Set(DRIVERS.map((driver) => driver.skill));
    expect(skills).toEqual(new Set([1, 2, 3, 4, 5]));
    for (let i = 1; i < bySkill.length; i++) {
      const [before, after] = [bySkill[i - 1]!, bySkill[i]!];
      if (after.skill > before.skill) {
        expect(after.speedFactor, after.id).toBeGreaterThan(before.speedFactor);
        expect(after.hiringFee, after.id).toBeGreaterThan(before.hiringFee);
        expect(after.payShare, after.id).toBeGreaterThanOrEqual(before.payShare);
        expect(after.requiredCompanyLevel ?? 1, after.id).toBeGreaterThanOrEqual(before.requiredCompanyLevel ?? 1);
      }
    }
    const best = bySkill[bySkill.length - 1]!;
    const worst = bySkill[0]!;
    expect(best.incidentChance).toBeLessThan(worst.incidentChance / 3);
    // A new company can hire someone.
    expect(DRIVERS.some((driver) => (driver.requiredCompanyLevel ?? 1) === 1)).toBe(true);
  });

  it('reports skills, paces, chances, shares and fees out of range', () => {
    const driver = driverFixture({
      id: 'Bad Driver',
      skill: 6,
      speedFactor: 3,
      incidentChance: -0.1,
      payShare: 1,
      hiringFee: 0,
      requiredCompanyLevel: 1.5,
    });

    expect(issues(driver)).toEqual([
      'driver.id',
      'driver.skill',
      'driver.speedFactor',
      'driver.incidentChance',
      'driver.payShare',
      'driver.hiringFee',
      'driver.requiredCompanyLevel',
    ]);
  });
});
