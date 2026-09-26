import type { DriverDefinition } from '../definitions/DriverDefinition';

/**
 * The drivers looking for work (spec §27), from a beginner who is cheap but
 * slow and careless to a veteran who is quick and safe but asks more. The
 * better ones join a company that has made a name for itself.
 */
export const DRIVERS: readonly DriverDefinition[] = [
  { id: 'driver_kemal', skill: 1, speedFactor: 0.85, incidentChance: 0.16, payShare: 0.2, hiringFee: 800 },
  { id: 'driver_selin', skill: 2, speedFactor: 0.92, incidentChance: 0.11, payShare: 0.22, hiringFee: 1500 },
  { id: 'driver_murat', skill: 2, speedFactor: 0.95, incidentChance: 0.12, payShare: 0.23, hiringFee: 1800 },
  { id: 'driver_zeynep', skill: 3, speedFactor: 1, incidentChance: 0.07, payShare: 0.24, hiringFee: 3500, requiredCompanyLevel: 2 },
  { id: 'driver_hakan', skill: 3, speedFactor: 1.04, incidentChance: 0.09, payShare: 0.25, hiringFee: 4000, requiredCompanyLevel: 2 },
  { id: 'driver_elif', skill: 4, speedFactor: 1.1, incidentChance: 0.05, payShare: 0.26, hiringFee: 7000, requiredCompanyLevel: 3 },
  { id: 'driver_osman', skill: 4, speedFactor: 1.12, incidentChance: 0.06, payShare: 0.27, hiringFee: 8000, requiredCompanyLevel: 3 },
  { id: 'driver_derya', skill: 5, speedFactor: 1.2, incidentChance: 0.03, payShare: 0.28, hiringFee: 14000, requiredCompanyLevel: 4 },
];
