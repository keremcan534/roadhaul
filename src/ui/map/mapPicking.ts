import type { FleetMarker } from '../../systems/fleet/FleetService';
import type { RivalMarker } from '../../systems/rivals/RivalService';
import type { MapCityLabel } from './mapSketch';
import type { MapViewport } from './MapViewport';

/** What a tap on the map points at: one of the fleet's trucks, a rival's, or a city. */
export type MapPick =
  | { readonly kind: 'fleet'; readonly marker: FleetMarker }
  | { readonly kind: 'rival'; readonly marker: RivalMarker }
  | { readonly kind: 'city'; readonly cityId: string };

/** A truck is picked within this far of its arrow on screen, CSS px. */
const TRUCK_PIXELS = 24;
/** A city is picked anywhere in its territory, and at least this close to its middle on screen, CSS px. */
const CITY_PIXELS = 44;

/**
 * What a tap at (x, y), CSS px on `view`, points at: the company truck
 * whose arrow is nearest, within reach (of arrows on top of each other, the
 * one drawn last, on top: the fleet's over the rivals'); else the city
 * whose territory (`territoryMeters` round its middle) holds the tap, the
 * nearest if two do; else null. The first `fleetCount` and `rivalCount`
 * markers count.
 */
export function pickOnMap(
  view: MapViewport,
  x: number,
  y: number,
  fleet: readonly FleetMarker[],
  fleetCount: number,
  rivals: readonly RivalMarker[],
  rivalCount: number,
  cities: readonly MapCityLabel[],
  territoryMeters: number,
): MapPick | null {
  let pick: MapPick | null = null;
  let nearest = TRUCK_PIXELS;
  // In the order MapPainter draws them: a later arrow as near wins.
  for (let i = 0; i < rivalCount; i++) {
    const marker = rivals[i]!;
    const distance = Math.hypot(view.screenX(marker.x, marker.z) - x, view.screenY(marker.x, marker.z) - y);
    if (distance <= nearest) {
      nearest = distance;
      pick = { kind: 'rival', marker };
    }
  }
  for (let i = 0; i < fleetCount; i++) {
    const marker = fleet[i]!;
    const distance = Math.hypot(view.screenX(marker.x, marker.z) - x, view.screenY(marker.x, marker.z) - y);
    if (distance <= nearest) {
      nearest = distance;
      pick = { kind: 'fleet', marker };
    }
  }
  if (pick !== null) {
    return pick;
  }
  const worldX = view.worldX(x, y);
  const worldZ = view.worldZ(x, y);
  let reach = Math.max(territoryMeters, CITY_PIXELS / Math.max(1e-6, view.scale));
  for (const city of cities) {
    const distance = Math.hypot(city.x - worldX, city.z - worldZ);
    if (distance <= reach) {
      reach = distance;
      pick = { kind: 'city', cityId: city.cityId };
    }
  }
  return pick;
}
