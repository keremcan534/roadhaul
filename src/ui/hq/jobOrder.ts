import type { JobOffer } from '../../systems/missions/MissionService';

/**
 * The job board's order: contracts the company can take now first, then
 * those waiting for a truck, then those waiting for a company level (lowest
 * first). Within each group those `first` picks (a tender) come first, then
 * the contracts of the day, then the board's own order.
 */
export function sortJobOffers(offers: readonly JobOffer[], first: (offer: JobOffer) => boolean = () => false): JobOffer[] {
  const rank = (offer: JobOffer): number =>
    offer.blockedBy === null ? 0 : offer.blockedBy === 'truck' ? 1 : 1 + offer.requiredCompanyLevel;
  return offers
    .map((offer, index) => ({ offer, index, first: first(offer) }))
    .sort(
      (a, b) =>
        rank(a.offer) - rank(b.offer) ||
        Number(b.first) - Number(a.first) ||
        Number(b.offer.daily) - Number(a.offer.daily) ||
        a.index - b.index,
    )
    .map(({ offer }) => offer);
}
