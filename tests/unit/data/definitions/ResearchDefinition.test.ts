import { describe, expect, it } from 'vitest';
import { Validator } from '../../../../src/core/validation/Validator';
import { validateGameContent } from '../../../../src/data/ContentCatalog';
import { RESEARCH } from '../../../../src/data/content/research';
import {
  RESEARCH_BRANCHES,
  validateResearchDefinition,
  type ResearchDefinition,
} from '../../../../src/data/definitions/ResearchDefinition';
import { contentFixture } from '../../../support/contentFixtures';

const STEP: ResearchDefinition = { id: 'test_step', branch: 'logistics', tier: 1, effect: 'loadingTimeReduction', value: 0.2, points: 2, cost: 1000 };

function issues(research: ResearchDefinition): string[] {
  const validator = new Validator();
  validateResearchDefinition(research, 'research', validator);
  return validator.issues.map((issue) => issue.path);
}

describe('validateResearchDefinition', () => {
  it('accepts the shipped research tree', () => {
    for (const research of RESEARCH) {
      expect(issues(research), research.id).toEqual([]);
    }
  });

  it('ships three branches of four tiers, dearer and later as they go', () => {
    for (const branch of RESEARCH_BRANCHES) {
      const steps = RESEARCH.filter((research) => research.branch === branch);
      expect(steps.map((research) => research.tier), branch).toEqual([1, 2, 3, 4]);
      for (let index = 1; index < steps.length; index++) {
        expect(steps[index]!.points, steps[index]!.id).toBeGreaterThan(steps[index - 1]!.points);
        expect(steps[index]!.cost, steps[index]!.id).toBeGreaterThan(steps[index - 1]!.cost);
      }
      // Its first step within a new company's reach.
      expect(steps[0]!.requiredCompanyLevel ?? 1, branch).toBe(1);
    }
  });

  it('wants a known branch and effect, a whole tier and points, and a value its effect allows', () => {
    expect(issues({ ...STEP, branch: 'magic' as ResearchDefinition['branch'] })).toEqual(['research.branch']);
    expect(issues({ ...STEP, effect: 'luck' as ResearchDefinition['effect'] })).toEqual(['research.effect']);
    expect(issues({ ...STEP, tier: 0, points: 1.5, cost: -1 })).toEqual(['research.tier', 'research.points', 'research.cost']);
    // A share off below 1, a count whole.
    expect(issues({ ...STEP, value: 1 })).toEqual(['research.value']);
    expect(issues({ ...STEP, effect: 'extraContracts', value: 0.5 })).toEqual(['research.value']);
    expect(issues({ ...STEP, requiredCompanyLevel: 0 })).toEqual(['research.requiredCompanyLevel']);
  });

  it('wants each branch a line of tiers, none unlocking before the tier above it', () => {
    const paths = (research: readonly ResearchDefinition[]) =>
      validateGameContent(contentFixture({ research })).map((issue) => issue.path);

    expect(paths([STEP, { ...STEP, id: 'test_next', tier: 2 }])).toEqual([]);
    expect(paths([STEP, { ...STEP, id: 'test_next', tier: 3 }])).toEqual(['research[1].tier']);
    expect(paths([{ ...STEP, tier: 2 }])).toEqual(['research[0].tier']);
    expect(paths([{ ...STEP, requiredCompanyLevel: 3 }, { ...STEP, id: 'test_next', tier: 2, requiredCompanyLevel: 2 }])).toEqual([
      'research[1].requiredCompanyLevel',
    ]);
    // Other branches keep their own count.
    expect(paths([STEP, { ...STEP, id: 'test_other', branch: 'business' }])).toEqual([]);
  });
});
