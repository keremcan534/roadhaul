import { NO_PERKS, type FacilityPerks, type PerkSource } from '../../domain/company/facilities';

/**
 * The company's perks as they stand, shared with the services they change:
 * the economy's prices, the garage's size, the fleet's pay, the standing in
 * the cities, the experience a delivery brings and the job board.
 * FacilityService keeps them up to date. One per game, made by the
 * composition root.
 */
export class CompanyPerks implements PerkSource {
  private current: FacilityPerks = NO_PERKS;

  get perks(): FacilityPerks {
    return this.current;
  }

  set(perks: FacilityPerks): void {
    this.current = perks;
  }
}
