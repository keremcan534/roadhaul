import type { RivalCompanyDefinition } from '../definitions/RivalCompanyDefinition';

/**
 * The region's other haulage companies (spec §65 V3), one from each city,
 * named after it: a small, quick parcel firm in the harbour town where the
 * player starts, a farm co-operative's reefers in the village, and the
 * industrial estate's big flatbed firm. The names are original (spec §85).
 */
export const RIVALS: readonly RivalCompanyDefinition[] = [
  {
    id: 'rival_yeniliman',
    color: 0xd9363e,
    homeCityId: 'city_a',
    vehicleId: 'rh_h1',
    startingTrucks: 2,
    maxTrucks: 5,
    startingCredits: 3000,
    speedFactor: 1.1,
    aggression: 0.65,
  },
  {
    id: 'rival_basakova',
    color: 0x2f9e44,
    homeCityId: 'city_c',
    vehicleId: 'rh_h2',
    startingTrucks: 2,
    maxTrucks: 4,
    startingCredits: 4000,
    speedFactor: 1,
    aggression: 0.35,
  },
  {
    id: 'rival_demirkent',
    color: 0x3b82c4,
    homeCityId: 'city_b',
    vehicleId: 'rh_h3',
    startingTrucks: 2,
    maxTrucks: 5,
    startingCredits: 6000,
    speedFactor: 0.95,
    aggression: 0.5,
  },
];
