import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../../../../src/data/content/upgrades';
import type { UpgradeDefinition } from '../../../../src/data/definitions/UpgradeDefinition';
import {
  fittedUpgradeLevel,
  MAX_SAVING,
  NO_BONUSES,
  statBonuses,
  truckLooks,
  upgradePerformance,
} from '../../../../src/domain/vehicles/upgradeBonuses';

const SAVER: UpgradeDefinition = {
  id: 'saver',
  look: 'stance',
  levels: [{ cost: 1, modifiers: [{ stat: 'cargoProtection', bonus: 0.6 }, { stat: 'fuelEfficiency', bonus: 0.5 }] }],
};
const PADDING: UpgradeDefinition = {
  id: 'padding',
  look: 'wheels',
  levels: [{ cost: 1, modifiers: [{ stat: 'cargoProtection', bonus: 0.5 }, { stat: 'enginePower', bonus: 0.1 }] }],
};

describe('statBonuses', () => {
  it('is all zeros for a truck with nothing fitted', () => {
    expect(statBonuses({}, UPGRADES)).toEqual(NO_BONUSES);
    expect(Object.values(NO_BONUSES).every((bonus) => bonus === 0)).toBe(true);
  });

  it('counts only the fitted level of each upgrade, which includes the levels below it', () => {
    const bonuses = statBonuses({ engine: 2, fuel_tank: 3 }, UPGRADES);

    expect(bonuses.enginePower).toBeCloseTo(0.16, 12);
    expect(bonuses.fuelEfficiency).toBeCloseTo(0.05, 12);
    expect(bonuses.fuelCapacity).toBeCloseTo(0.6, 12);
    expect(bonuses.brakingPower).toBe(0);
  });

  it('adds up different upgrades that improve the same stat, keeping savings below everything', () => {
    const bonuses = statBonuses({ saver: 1, padding: 1 }, [SAVER, PADDING]);

    expect(bonuses.cargoProtection).toBe(MAX_SAVING);
    expect(bonuses.fuelEfficiency).toBe(0.5);
    expect(bonuses.enginePower).toBe(0.1);
  });

  it('ignores unknown upgrades and levels that do not exist', () => {
    expect(statBonuses({ turbo: 1, engine: 7, brakes: 0, tires: 1.5 }, UPGRADES)).toEqual(NO_BONUSES);
  });
});

describe('fittedUpgradeLevel', () => {
  it('reads a usable level and treats anything else as none', () => {
    const engine = UPGRADES.find((upgrade) => upgrade.id === 'engine')!;

    expect(fittedUpgradeLevel({ engine: 3 }, engine)).toBe(3);
    expect(fittedUpgradeLevel({}, engine)).toBe(0);
    expect(fittedUpgradeLevel({ engine: 4 }, engine)).toBe(0);
    expect(fittedUpgradeLevel(JSON.parse('{"__proto__": 2}') as Record<string, number>, engine)).toBe(0);
  });
});

describe('upgradePerformance', () => {
  it('turns bonuses into engine, brake, grip and stability factors', () => {
    const performance = upgradePerformance({
      ...NO_BONUSES,
      enginePower: 0.25,
      brakingPower: 0.3,
      grip: 0.18,
      stability: 0.15,
      cargoProtection: 0.45,
    });

    expect(performance).toEqual({ torqueFactor: 1.25, brakeFactor: 1.3, gripFactor: 1.18, stabilityFactor: 1.15 });
  });
});

describe('truckLooks', () => {
  it('shows each fitted upgrade on its part of the truck, and nothing on a truck without upgrades', () => {
    expect(truckLooks({}, UPGRADES)).toEqual({ exhaust: 0, brakes: 0, wheels: 0, stance: 0, fuelTank: 0 });
    expect(truckLooks({ engine: 2, tires: 1, fuel_tank: 3, unknown: 2 }, UPGRADES)).toEqual({
      exhaust: 2,
      brakes: 0,
      wheels: 1,
      stance: 0,
      fuelTank: 3,
    });
  });

  it('shows the higher level when two upgrades show on the same part, and ignores levels that do not exist', () => {
    const grip = { ...PADDING, id: 'grip' };

    expect(truckLooks({ padding: 1, grip: 1 }, [PADDING, grip]).wheels).toBe(1);
    expect(truckLooks({ padding: 4 }, [PADDING]).wheels).toBe(0);
  });
});
