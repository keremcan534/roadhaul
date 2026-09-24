import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { UPGRADES } from '../../../../src/data/content/upgrades';
import {
  validateUpgradeDefinition,
  VEHICLE_STATS,
  type UpgradeDefinition,
  type UpgradeLevelDefinition,
  type VehicleStat,
} from '../../../../src/data/definitions/UpgradeDefinition';
import { upgradeFixture } from '../../../support/contentFixtures';

function issues(upgrade: UpgradeDefinition): { path: string; message: string }[] {
  const validator = new Validator();
  validateUpgradeDefinition(upgrade, 'upgrade', validator);
  return [...validator.issues];
}

function level(overrides: Partial<UpgradeLevelDefinition> = {}): UpgradeLevelDefinition {
  return { cost: 1000, modifiers: [{ stat: 'brakingPower', bonus: 0.1 }], ...overrides };
}

describe('validateUpgradeDefinition', () => {
  it('accepts the built-in upgrades and the test fixture', () => {
    for (const upgrade of [...UPGRADES, upgradeFixture()]) {
      expect(issues(upgrade), upgrade.id).toEqual([]);
    }
  });

  it('ships five upgrade types of three levels each (spec §43)', () => {
    expect(UPGRADES).toHaveLength(5);
    for (const upgrade of UPGRADES) {
      expect(upgrade.levels, upgrade.id).toHaveLength(3);
    }
  });

  it('offers a first upgrade a new company can afford after a delivery or two (spec §41)', () => {
    const openAtLevel1 = UPGRADES.filter((upgrade) => (upgrade.levels[0]!.requiredCompanyLevel ?? 1) === 1);

    expect(openAtLevel1.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...openAtLevel1.map((upgrade) => upgrade.levels[0]!.cost))).toBeLessThanOrEqual(2000);
  });

  it('shows every built-in upgrade on its own part of the truck, and requires a known part', () => {
    expect(new Set(UPGRADES.map((upgrade) => upgrade.look)).size).toBe(UPGRADES.length);
    expect(issues(upgradeFixture({ look: 'spoiler' as UpgradeDefinition['look'] })).map((issue) => issue.path)).toEqual([
      'upgrade.look',
    ]);
  });

  it('requires at least one level', () => {
    expect(issues(upgradeFixture({ levels: [] }))).toEqual([{ path: 'upgrade.levels', message: 'must be a non-empty list' }]);
    expect(issues(upgradeFixture({ levels: null as unknown as UpgradeLevelDefinition[] })).map((issue) => issue.path)).toEqual([
      'upgrade.levels',
    ]);
  });

  it('reports broken levels and modifiers with their paths instead of crashing', () => {
    const upgrade = upgradeFixture({
      id: 'Bad Id',
      levels: [
        null as unknown as UpgradeLevelDefinition,
        level({ cost: -1, requiredCompanyLevel: 1.5 }),
        level({ modifiers: [] }),
        level({ modifiers: [null as unknown as UpgradeLevelDefinition['modifiers'][number]] }),
        level({ modifiers: [{ stat: 'jumpHeight' as VehicleStat, bonus: 2 }] }),
      ],
    });

    expect(issues(upgrade).map((issue) => issue.path)).toEqual([
      'upgrade.id',
      'upgrade.levels[0]',
      'upgrade.levels[1].cost',
      'upgrade.levels[1].requiredCompanyLevel',
      'upgrade.levels[2].modifiers',
      'upgrade.levels[3].modifiers[0]',
      'upgrade.levels[4].modifiers[0].stat',
      'upgrade.levels[4].modifiers[0].bonus',
    ]);
  });

  it('checks the level after a broken one on its own', () => {
    const upgrade = upgradeFixture({
      levels: [level({ modifiers: null as unknown as UpgradeLevelDefinition['modifiers'] }), level({ cost: 0 })],
    });

    expect(issues(upgrade).map((issue) => issue.path)).toEqual(['upgrade.levels[0].modifiers']);
  });

  it('requires every bonus to improve something, and a saving to leave something over', () => {
    const upgrade = upgradeFixture({
      levels: [
        level({
          modifiers: [
            { stat: 'brakingPower', bonus: 0 },
            { stat: 'cargoProtection', bonus: 1 },
            { stat: 'fuelCapacity', bonus: 1 },
          ],
        }),
      ],
    });

    expect(issues(upgrade)).toEqual([
      { path: 'upgrade.levels[0].modifiers[0].bonus', message: 'must be greater than 0' },
      { path: 'upgrade.levels[0].modifiers[1].bonus', message: 'must be below 1: "cargoProtection" saves a share' },
    ]);
  });

  it('reports a stat listed twice in one level', () => {
    const upgrade = upgradeFixture({
      levels: [
        level({
          modifiers: [
            { stat: 'grip', bonus: 0.1 },
            { stat: 'grip', bonus: 0.2 },
          ],
        }),
      ],
    });

    expect(issues(upgrade)).toEqual([{ path: 'upgrade.levels[0].modifiers[1].stat', message: '"grip" appears twice' }]);
  });

  it('never lets a higher level cost less, unlock earlier or lose an effect', () => {
    const upgrade = upgradeFixture({
      levels: [
        level({
          cost: 3000,
          requiredCompanyLevel: 3,
          modifiers: [
            { stat: 'grip', bonus: 0.2 },
            { stat: 'stability', bonus: 0.1 },
          ],
        }),
        level({ cost: 2000, requiredCompanyLevel: 2, modifiers: [{ stat: 'grip', bonus: 0.1 }] }),
      ],
    });

    expect(issues(upgrade)).toEqual([
      { path: 'upgrade.levels[1].cost', message: 'must not be lower than the previous level' },
      { path: 'upgrade.levels[1].requiredCompanyLevel', message: 'must not be lower than the previous level' },
      { path: 'upgrade.levels[1].modifiers', message: "must keep at least the previous level's grip bonus" },
      { path: 'upgrade.levels[1].modifiers', message: "must keep at least the previous level's stability bonus" },
    ]);
  });

  it('knows seven stats, each improved by some built-in upgrade', () => {
    const improved = new Set(UPGRADES.flatMap((upgrade) => upgrade.levels.flatMap((l) => l.modifiers.map((m) => m.stat))));

    expect(VEHICLE_STATS).toHaveLength(7);
    expect([...improved].sort()).toEqual([...VEHICLE_STATS].sort());
  });
});
