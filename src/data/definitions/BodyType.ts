/**
 * What a truck carries its load in (spec §10 `RequiredTrailerType`; the MVP
 * trucks are rigid, so the body is part of the truck). Cargo names the body it
 * needs.
 */
export const BODY_TYPES = ['box', 'refrigerated', 'flatbed'] as const;
export type BodyType = (typeof BODY_TYPES)[number];

/** Cargo bodies each truck body can haul: a refrigerated box also takes dry cargo. */
const BODY_ACCEPTS: Readonly<Record<BodyType, readonly BodyType[]>> = {
  box: ['box'],
  refrigerated: ['box', 'refrigerated'],
  flatbed: ['flatbed'],
};

export function bodyCanHaul(truckBody: BodyType, cargoBody: BodyType): boolean {
  return BODY_ACCEPTS[truckBody]?.includes(cargoBody) ?? false;
}
