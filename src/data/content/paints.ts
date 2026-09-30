import type { PaintDefinition } from '../definitions/PaintDefinition';

/**
 * The garage's colours, cheapest first; the richer ones open with the company's level. The premium ones last: they come
 * with the "Premium paints" purchase, and are then free to use on every truck.
 */
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
  { id: 'midnight_black', color: 0x15171b, price: 0, premium: true },
  { id: 'racing_green', color: 0x0f4d2f, price: 0, premium: true },
  { id: 'candy_red', color: 0x9e0f1f, price: 0, premium: true },
  { id: 'sky_blue', color: 0x5aa9e6, price: 0, premium: true },
  { id: 'gold_rush', color: 0xc9a227, price: 0, premium: true },
  { id: 'rose_pink', color: 0xd9678f, price: 0, premium: true },
];
