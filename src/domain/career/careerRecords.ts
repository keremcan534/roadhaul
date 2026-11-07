import type { CareerSaveData } from '../save/SaveGameData';

/** A career with nothing in it yet: a new company's, or an older save's from v18 on. */
export function emptyCareer(): CareerSaveData {
  return {
    tonsDelivered: 0,
    longestHaulMeters: 0,
    haulMeters: 0,
    bestPay: 0,
    topSpeedKmh: 0,
    drivingSeconds: 0,
    fuelLiters: 0,
    fuelSpent: 0,
    repairsSpent: 0,
    knocks: 0,
    overturns: 0,
    carsWrecked: 0,
    propsKnocked: 0,
    fleetDeliveries: 0,
    fines: 0,
    finesPaid: 0,
    roadsideHelps: 0,
    cargo: {},
    destinations: {},
  };
}

/** The id counted most (`counts`, by id), the first of those tied in `order`; null with nothing counted. */
export function mostCounted(counts: Readonly<Record<string, number>>, order: readonly string[]): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const id of order) {
    const count = counts[id] ?? 0;
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}
