import type { JobOffer } from '../../systems/missions/MissionService';

/**
 * The job board's order: contracts the company can take now first, then
 * those waiting for a truck, then those waiting for a company level (lowest
 * first). Content order within each group.
 */
export function sortJobOffers(offers: readonly JobOffer[]): JobOffer[] {
  const rank = (offer: JobOffer): number =>
    offer.blockedBy === null ? 0 : offer.blockedBy === 'truck' ? 1 : 1 + offer.requiredCompanyLevel;
  return offers
    .map((offer, index) => ({ offer, index }))
    .sort((a, b) => rank(a.offer) - rank(b.offer) || a.index - b.index)
    .map(({ offer }) => offer);
}
