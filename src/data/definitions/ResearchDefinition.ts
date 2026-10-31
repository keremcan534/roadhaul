import type { Validator } from '../../core/validation/Validator';
import type { Credits } from '../units';
import { FACILITY_EFFECTS, validatePerkValue, type FacilityEffect } from './FacilityDefinition';

/** The research tree's branches: how the company moves goods, its trucks, and its trade. */
export const RESEARCH_BRANCHES = ['logistics', 'engineering', 'business'] as const;
export type ResearchBranch = (typeof RESEARCH_BRANCHES)[number];

/**
 * A step of the research tree: researched once, for research points the
 * company's deliveries earn and credits, it gives the whole company a perk
 * for good (FacilityEffect, added to the facilities'). Each branch is a line
 * of tiers: a tier needs the one before it in its branch. Player-facing
 * names come from the string tables (`research.<id>.name`).
 */
export interface ResearchDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  readonly branch: ResearchBranch;
  /** Its place in its branch, from 1: tier 1 needs nothing, each other the tier below it. */
  readonly tier: number;
  readonly effect: FacilityEffect;
  /** The effect's size: a share for the discounts and bonuses (0.05 is 5 %), a count for the contracts. */
  readonly value: number;
  /** Research points it takes. */
  readonly points: number;
  readonly cost: Credits;
  /** The company level that lets it be researched. Omit for level 1. */
  readonly requiredCompanyLevel?: number;
}

export function validateResearchDefinition(research: ResearchDefinition, path: string, validator: Validator): void {
  validator.id(research.id, `${path}.id`);
  validator.oneOf(research.branch, RESEARCH_BRANCHES, `${path}.branch`);
  validator.positiveInteger(research.tier, `${path}.tier`);
  if (validator.oneOf(research.effect, FACILITY_EFFECTS, `${path}.effect`)) {
    validatePerkValue(research.effect, research.value, `${path}.value`, validator);
  }
  validator.positiveInteger(research.points, `${path}.points`);
  validator.nonNegativeInteger(research.cost, `${path}.cost`);
  if (research.requiredCompanyLevel !== undefined) {
    validator.positiveInteger(research.requiredCompanyLevel, `${path}.requiredCompanyLevel`);
  }
}
