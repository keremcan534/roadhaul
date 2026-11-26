import type { Credits } from '../../data/units';

/** Where a hitchhiker wants to go: a town, by its depot's yard, and how far that is from where they stood. */
export interface HitchDestination {
  /** The town (a CityDefinition id). */
  readonly cityId: string;
  /** Its depot's yard: they get out anywhere near it. */
  readonly x: number;
  readonly z: number;
  /** As the crow flies from where they were picked up, meters. */
  readonly meters: number;
}

/** A town counts as ahead within this angle of the way the truck is going, degrees. */
const AHEAD_DEGREES = 75;

/** A depot as the hitchhikers see it: its town and its yard. */
export interface HitchTown {
  readonly cityId: string;
  readonly yard: { readonly x: number; readonly z: number };
}

/**
 * The town a hitchhiker standing at (x, z) wants to go to: one of the
 * towns (by their first depot) between `tripMeters` of them as the crow
 * flies, never the town nearest them (the one they are leaving); the towns
 * ahead of `heading` (within AHEAD_DEGREES of the way the truck is going)
 * first, `roll` (uniform in [0, 1)) picking among them. Null when no town
 * is that far. Pure.
 */
export function pickHitchDestination(
  depots: readonly HitchTown[],
  x: number,
  z: number,
  heading: number,
  tripMeters: readonly [number, number],
  roll: number,
): HitchDestination | null {
  const towns: HitchTown[] = [];
  for (const depot of depots) {
    if (!towns.some((town) => town.cityId === depot.cityId)) {
      towns.push(depot);
    }
  }
  let home: HitchTown | null = null;
  for (const town of towns) {
    if (home === null || Math.hypot(town.yard.x - x, town.yard.z - z) < Math.hypot(home.yard.x - x, home.yard.z - z)) {
      home = town;
    }
  }
  const [least, most] = tripMeters;
  const far = towns.filter((town) => {
    const meters = Math.hypot(town.yard.x - x, town.yard.z - z);
    return town !== home && meters >= least && meters <= most;
  });
  const forward = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  // Ahead: within AHEAD_DEGREES of the way the truck is going.
  const ahead = far.filter((town) => {
    const dx = town.yard.x - x;
    const dz = town.yard.z - z;
    return dx * forward + dz * forwardZ > Math.cos((AHEAD_DEGREES * Math.PI) / 180) * Math.hypot(dx, dz);
  });
  const choices = ahead.length > 0 ? ahead : far;
  if (choices.length === 0) {
    return null;
  }
  const town = choices[Math.min(choices.length - 1, Math.floor(Math.max(0, roll) * choices.length))]!;
  return { cityId: town.cityId, x: town.yard.x, z: town.yard.z, meters: Math.hypot(town.yard.x - x, town.yard.z - z) };
}

/** What a ride of `meters` (as the crow flies) pays: a fare and so much a kilometre, to the nearest 10 credits. */
export function hitchFare(meters: number, baseFare: Credits, farePerKm: Credits): Credits {
  return Math.round((baseFare + (farePerKm * Math.max(0, meters)) / 1000) / 10) * 10;
}
