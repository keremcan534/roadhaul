import { addPerks, NO_PERKS, type FacilityPerks, type PerkSource } from '../../domain/company/facilities';

/** Where the company's perks come from: what it has built, and what it has researched. */
export type PerkPart = 'facilities' | 'research';

/**
 * The company's perks as they stand, shared with the services they change:
 * the economy's prices, the garage's size, the fleet's pay, the standing in
 * the cities, the experience and pay a delivery brings, the cargo's care,
 * the diesel burnt, the loading time and the job board. FacilityService and
 * ResearchService each keep their part up to date; the perks are both added
 * up. One per game, made by the composition root.
 */
export class CompanyPerks implements PerkSource {
  private readonly parts: Record<PerkPart, FacilityPerks> = { facilities: NO_PERKS, research: NO_PERKS };
  private current: FacilityPerks = NO_PERKS;

  get perks(): FacilityPerks {
    return this.current;
  }

  /** Sets what `part` gives the company now. */
  set(part: PerkPart, perks: FacilityPerks): void {
    this.parts[part] = perks;
    this.current = addPerks(this.parts.facilities, this.parts.research);
  }

  /** What `part` alone gives the company. */
  of(part: PerkPart): FacilityPerks {
    return this.parts[part];
  }
}
