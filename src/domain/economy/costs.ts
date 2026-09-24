import type { Credits, Fraction } from '../../data/units';

/** What `liters` of fuel cost at `pricePerLiter`, rounded up to whole credits (the pump never gives change). */
export function fuelCost(liters: number, pricePerLiter: Credits): Credits {
  return Math.max(0, Math.ceil(liters * pricePerLiter - 1e-9));
}

/** What repairing `damage` (0..1) costs when a complete rebuild costs `fullRepairCost`, rounded up to whole credits. */
export function repairCost(damage: Fraction, fullRepairCost: Credits): Credits {
  return Math.max(0, Math.ceil(damage * fullRepairCost - 1e-9));
}
