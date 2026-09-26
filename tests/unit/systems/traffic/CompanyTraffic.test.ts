import { describe, expect, it } from 'vitest';
import type { CompanyTruckMarker } from '../../../../src/systems/fleet/DepotRoads';
import { STEP_SECONDS } from '../../../support/driving';
import { bootGame, newCompany, type Game } from '../../../support/game';

/** How often CompanyTraffic looks for trucks to bring in, seconds (one look per call below). */
const LOOK = 0.25;

/** A new company whose rivals' trucks have been on their contracts two minutes: one of them on the road. */
async function rivalOnTheRoad(credits = 5000): Promise<{ game: Game; marker: CompanyTruckMarker }> {
  const game = await newCompany(1, credits);
  for (let second = 0; second < 120; second++) {
    game.rivals.update(1);
  }
  const count = game.rivals.updateMarkers();
  const marker = game.rivals.markers.slice(0, count).find((candidate) => candidate.moving && candidate.key !== '');
  if (marker === undefined) {
    throw new Error('No rival truck on the road.');
  }
  return { game, marker: { ...marker } };
}

/**
 * Puts the truck `distance` meters from `marker`, inside the map, facing
 * away from it (`facing` 'away': the rival is behind, out of sight) or
 * towards it.
 */
function standFrom(game: Game, marker: CompanyTruckMarker, distance: number, facing: 'away' | 'towards'): void {
  const half = game.driving.world.halfSizeMeters - 50;
  for (let k = 0; k < 16; k++) {
    const angle = Math.atan2(-marker.x, -marker.z) + (k * Math.PI) / 8; // Towards the middle of the map first.
    const x = marker.x + Math.sin(angle) * distance;
    const z = marker.z + Math.cos(angle) * distance;
    if (Math.abs(x) < half && Math.abs(z) < half) {
      game.driving.placeTruck(x, z, facing === 'away' ? angle : angle + Math.PI);
      return;
    }
  }
  throw new Error('No room on the map.');
}

/** The traffic moves on a quarter of a second, and CompanyTraffic takes a look (the rivals stand still). */
function look(game: Game): void {
  for (let step = 0; step < Math.round(LOOK / STEP_SECONDS); step++) {
    game.traffic.update(STEP_SECONDS);
    game.companyTraffic.update(STEP_SECONDS);
  }
}

function placed(game: Game, key: string): { x: number; z: number; heading: number } | null {
  const placement = { x: 0, z: 0, heading: 0 };
  return game.companyTraffic.placeInTraffic(key, placement) ? placement : null;
}

/** Looks for up to `seconds` until truck `key` drives in the traffic (the traffic's own may stand where it would come). */
function lookUntilInTraffic(game: Game, key: string, seconds = 10): { x: number; z: number; heading: number } | null {
  for (let elapsed = 0; elapsed < seconds; elapsed += LOOK) {
    look(game);
    const where = placed(game, key);
    if (where !== null) {
      return where;
    }
  }
  return null;
}

/** Looks for `seconds`: truck `key` never drives in the traffic meanwhile. */
function staysOutOfTraffic(game: Game, key: string, seconds = 5): boolean {
  for (let elapsed = 0; elapsed < seconds; elapsed += LOOK) {
    look(game);
    if (placed(game, key) !== null) {
      return false;
    }
  }
  return true;
}

describe('CompanyTraffic', () => {
  it('does nothing before a game is driven', async () => {
    const game = await bootGame();
    game.companyTraffic.update(LOOK);
    expect(game.companyTraffic.inTraffic).toBe(0);
    expect(placed(game, 'rival_yeniliman:0')).toBeNull();
  });

  it('brings a rival truck near the truck into the traffic, out of sight, as a lorry in its colour, where the maps show it', async () => {
    const { game, marker } = await rivalOnTheRoad();
    standFrom(game, marker, 300, 'away');
    const where = lookUntilInTraffic(game, marker.key)!;

    expect(where).not.toBeNull();
    expect(game.companyTraffic.inTraffic).toBeGreaterThanOrEqual(1);
    // It came in where the maps had it, and has driven on a little since.
    expect(Math.hypot(where.x - marker.x, where.z - marker.z)).toBeLessThan(15 + 25 * LOOK);
    const simulation = game.traffic.simulation!;
    const slot = Array.from({ length: simulation.capacity }, (_, i) => i).find(
      (i) => simulation.active[i] === 1 && simulation.guest[i]! >= 0 && simulation.x[i] === where.x && simulation.z[i] === where.z,
    )!;
    expect(simulation.color[slot]).toBe(marker.color);
    expect(simulation.types[simulation.type[slot]!]!.kind).toBe('truck');

    // The maps show it where it drives.
    game.rivals.updateMarkers();
    const shown = game.rivals.markers.find((candidate) => candidate.key === marker.key)!;
    expect(game.companyTraffic.placeInTraffic(shown.key, shown)).toBe(true);
    expect(shown.x).toBe(where.x);
  });

  it('leaves the ones in sight and those beyond the traffic\'s reach on the maps', async () => {
    const { game, marker } = await rivalOnTheRoad();
    standFrom(game, marker, 300, 'towards');
    expect(staysOutOfTraffic(game, marker.key)).toBe(true);

    standFrom(game, marker, 900, 'away');
    expect(staysOutOfTraffic(game, marker.key)).toBe(true);
  });

  it('brings a truck that has left the traffic back only once it has been out of reach', async () => {
    const { game, marker } = await rivalOnTheRoad();
    standFrom(game, marker, 300, 'away');
    expect(lookUntilInTraffic(game, marker.key)).not.toBeNull();

    // Gone from the traffic (as when it gets where it was going): still in reach, it stays away.
    game.traffic.simulation!.reset();
    expect(staysOutOfTraffic(game, marker.key)).toBe(true);

    standFrom(game, marker, 900, 'away');
    look(game);
    standFrom(game, marker, 300, 'away');
    expect(lookUntilInTraffic(game, marker.key)).not.toBeNull();
  });

  it('lets a rival\'s lorry go once the rival is bought out', async () => {
    const { game, marker } = await rivalOnTheRoad(5_000_000);
    standFrom(game, marker, 300, 'away');
    expect(lookUntilInTraffic(game, marker.key)).not.toBeNull();
    const rivalId = marker.key.slice(0, marker.key.indexOf(':'));

    expect(game.rivals.acquire(rivalId).ok).toBe(true);
    look(game);
    expect(placed(game, marker.key)).toBeNull();
    // It drove on as the traffic's own, and left the road out of sight.
    look(game);
    const simulation = game.traffic.simulation!;
    for (let i = 0; i < simulation.capacity; i++) {
      if (simulation.active[i] === 1) {
        expect(simulation.color[i]).not.toBe(marker.color);
      }
    }
  });
});
