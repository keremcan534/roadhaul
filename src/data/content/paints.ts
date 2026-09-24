import type { PaintDefinition } from '../definitions/PaintDefinition';

/** The garage's colours, cheapest first; the richer ones open with the company's level. */
export const PAINTS: readonly PaintDefinition[] = [
  { id: 'signal_red', color: 0xc62f2a, price: 1500 },
  { id: 'ocean_blue', color: 0x2b6cb0, price: 1500 },
  { id: 'forest_green', color: 0x2f7d4f, price: 1500 },
  { id: 'sunrise_orange', color: 0xe8702a, price: 1500 },
  { id: 'glacier_white', color: 0xe6eaed, price: 1500 },
  { id: 'graphite', color: 0x3b4047, price: 2000 },
  { id: 'amber', color: 0xf2b233, price: 2000, requiredCompanyLevel: 2 },
  { id: 'royal_purple', color: 0x6b3fa0, price: 2500, requiredCompanyLevel: 3 },
  { id: 'lagoon_teal', color: 0x1d8a8a, price: 2500, requiredCompanyLevel: 3 },
];
