import type { LiveryDefinition } from '../definitions/LiveryDefinition';

/**
 * The trucks' designs: the classic for free; seven for credits as the company
 * grows; nine only crates give, the rarer the bolder; and two packs of three
 * in the shop (cosmetic only).
 */
export const LIVERIES: readonly LiveryDefinition[] = [
  { id: 'classic', pattern: 'classic', price: 0 },
  { id: 'speed', pattern: 'speed', price: 2500 },
  { id: 'chevrons', pattern: 'chevrons', price: 3000, requiredCompanyLevel: 2 },
  { id: 'checker', pattern: 'checker', price: 3500, requiredCompanyLevel: 2 },
  { id: 'waves', pattern: 'waves', price: 4000, requiredCompanyLevel: 3 },
  { id: 'sunset', pattern: 'sunset', price: 5000, requiredCompanyLevel: 4 },
  { id: 'hexagon', pattern: 'hexagon', price: 0, crate: 'rare' },
  { id: 'stars', pattern: 'stars', price: 0, crate: 'rare' },
  { id: 'camo', pattern: 'camo', price: 0, crate: 'epic' },
  { id: 'lightning', pattern: 'lightning', price: 0, crate: 'epic' },
  { id: 'galaxy', pattern: 'galaxy', price: 0, crate: 'legendary' },
  { id: 'flames', pattern: 'flames', price: 0, pack: 'designs_street' },
  { id: 'tiger', pattern: 'tiger', price: 0, pack: 'designs_street' },
  { id: 'splatter', pattern: 'splatter', price: 0, pack: 'designs_street' },
  { id: 'neon', pattern: 'neon', price: 0, pack: 'designs_neon' },
  { id: 'circuit', pattern: 'circuit', price: 0, pack: 'designs_neon' },
  { id: 'synthwave', pattern: 'synthwave', price: 0, pack: 'designs_neon' },
  { id: 'carbon', pattern: 'carbon', price: 6500, requiredCompanyLevel: 5 },
  { id: 'rally', pattern: 'rally', price: 8000, requiredCompanyLevel: 6 },
  { id: 'pixel', pattern: 'pixel', price: 0, crate: 'rare' },
  { id: 'tribal', pattern: 'tribal', price: 0, crate: 'epic' },
  { id: 'aurora', pattern: 'aurora', price: 0, crate: 'epic' },
  { id: 'eclipse', pattern: 'eclipse', price: 0, crate: 'legendary' },
];
