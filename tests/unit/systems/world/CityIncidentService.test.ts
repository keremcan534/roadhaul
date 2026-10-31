import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import type { CityIncidentKind } from '../../../../src/data/definitions/CityIncident';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { CityIncidentService } from '../../../../src/systems/world/CityIncidentService';
import { MemoryLogger } from '../../../support/MemoryLogger';
import { bootGame, type Game } from '../../../support/game';

const CONFIG = DEFAULT_GAME_CONFIG.cityLife;

/** A new company in the shipped game, its truck where a new game starts (Havenport), and an incident service on it. */
async function setup(night = 0, roll = 0.37) {
  const game: Game = await bootGame();
  game.session.startNewGame('Kuzey Lojistik');
  const sky = { weights: { night } };
  let seed = roll;
  const random = (): number => (seed = (seed * 9301 + 0.49297) % 1);
  const service = new CityIncidentService(CONFIG, game.driving, sky, random, game.events, new MemoryLogger());
  const started: GameEvents['CityIncidentStarted'][] = [];
  const ended: GameEvents['CityIncidentEnded'][] = [];
  game.events.on('CityIncidentStarted', (event) => started.push(event));
  game.events.on('CityIncidentEnded', (event) => ended.push(event));
  const run = (seconds: number, step = 0.5): void => {
    for (let t = 0; t < seconds; t += step) {
      service.update(step);
    }
  };
  return { game, service, sky, started, ended, run };
}

const distanceFromTruck = (game: Game, x: number, z: number): number =>
  Math.hypot(x - game.driving.vehicle.x, z - game.driving.vehicle.z);

describe('CityIncidentService', () => {
  it('waits a few minutes of driving for the first, then starts one near the truck, and the next minutes after it ends', async () => {
    const { service, started, ended, run, game } = await setup();

    run(CONFIG.firstAfterSeconds - 1);
    expect(started).toEqual([]);
    run(2);
    expect(started).toHaveLength(1);
    const first = started[0]!;
    expect(first.kind).not.toBe('fireworks'); // Not by day.
    expect(distanceFromTruck(game, first.x, first.z)).toBeLessThanOrEqual(CONFIG.farMeters + 50);
    expect(first.cityId).toBe('city_a');

    // A chase may end sooner, where its road does.
    for (let t = 0; t <= CONFIG.durationSeconds[first.kind] && ended.length === 0; t += 0.5) {
      run(0.5);
    }
    expect(ended).toHaveLength(1);
    expect(service.incident).toBeNull();
    expect(service.vehicleKinds).toEqual([]);
    run(CONFIG.gapSeconds[0] - 5);
    expect(started).toHaveLength(1);
    run(CONFIG.gapSeconds[1] - CONFIG.gapSeconds[0] + 10);
    expect(started).toHaveLength(2);
  });

  it('sets a town building on fire, the fire engine, an ambulance and a police car parked on the road by it', async () => {
    const { service, started, run, game } = await setup();
    service.force('building_fire');
    run(0.5);

    const fire = service.incident!;
    expect(fire.kind).toBe('building_fire');
    expect(started).toEqual([{ kind: 'building_fire', cityId: 'city_a', x: fire.x, z: fire.z }]);
    expect(fire.heightMeters).toBeGreaterThanOrEqual(7);
    expect(distanceFromTruck(game, fire.x, fire.z)).toBeGreaterThanOrEqual(CONFIG.nearMeters);
    expect(service.vehicleKinds).toEqual(['fire_engine', 'ambulance', 'police']);
    for (let i = 0; i < 3; i++) {
      // On a road, near the building: at most a block away.
      expect(Math.hypot(service.vehicleX[i]! - fire.x, service.vehicleZ[i]! - fire.z), String(i)).toBeLessThan(90);
    }
    // They stay where they parked.
    const parkedAt = service.vehicleX[0];
    run(30);
    expect(service.vehicleX[0]).toBe(parkedAt);
  });

  it('sends a police chase down the roads past the truck, the police behind the car they chase, until its road ends', async () => {
    const { service, ended, run, game } = await setup();
    service.force('police_chase');
    run(0.5);
    expect(service.vehicleKinds).toEqual(['getaway', 'police', 'police']);

    let nearest = Number.POSITIVE_INFINITY;
    const lead = (): number => Math.hypot(service.vehicleX[0]! - service.vehicleX[1]!, service.vehicleZ[0]! - service.vehicleZ[1]!);
    let gaps = 0;
    for (let t = 0; t < CONFIG.durationSeconds.police_chase && service.incident !== null; t += 0.5) {
      nearest = Math.min(nearest, distanceFromTruck(game, service.vehicleX[0]!, service.vehicleZ[0]!));
      gaps = Math.max(gaps, lead());
      run(0.5);
    }
    // It came past, within sight of the truck…
    expect(nearest).toBeLessThan(80);
    // …the police close behind (24 m along the road, less across a corner).
    expect(gaps).toBeLessThanOrEqual(25);
    expect(ended).toHaveLength(1);
  });

  it('runs a chase from its start after another incident has run its time', async () => {
    const { service, ended, run } = await setup();
    service.force('building_fire');
    run(CONFIG.durationSeconds.building_fire + 1);
    expect(ended).toHaveLength(1);
    service.force('police_chase');
    run(0.5);
    expect(service.incident?.kind).toBe('police_chase');

    const x = service.vehicleX[0];
    const z = service.vehicleZ[0];
    run(5);
    expect(service.incident?.kind).toBe('police_chase');
    expect(Math.hypot(service.vehicleX[0]! - x!, service.vehicleZ[0]! - z!)).toBeGreaterThan(CONFIG.chaseSpeed * 3);
  });

  it('forgets the incident under way when a company is started or continued from the main menu', async () => {
    const { service, started, run, game } = await setup();
    service.force('building_fire');
    run(0.5);
    expect(service.incident).not.toBeNull();

    game.events.emit('GameStateChanged', { previous: 'driving', current: 'mainMenu' });
    game.events.emit('GameStateChanged', { previous: 'mainMenu', current: 'driving' });
    expect(service.incident).toBeNull();
    expect(service.vehicleKinds).toEqual([]);
    run(CONFIG.firstAfterSeconds - 2);
    expect(started).toHaveLength(1);
  });

  it('lets off fireworks only after dark, but at any time when asked for', async () => {
    const night = await setup(1, 0.9);
    night.run(CONFIG.firstAfterSeconds + 1);
    const kinds = new Set<CityIncidentKind>();
    for (let i = 0; i < 12 && night.started.length > 0; i++) {
      kinds.add(night.started.at(-1)!.kind);
      night.run(CONFIG.durationSeconds.building_fire + CONFIG.gapSeconds[1] + 2);
    }
    expect(kinds.has('fireworks')).toBe(true);

    const day = await setup(0);
    day.service.force('fireworks');
    day.run(0.5);
    expect(day.service.incident?.kind).toBe('fireworks');
    expect(day.service.vehicleKinds).toEqual([]);
  });

  it('waits while the truck is off the road', async () => {
    const { game } = await setup();
    const parked = { isDriving: false, vehicle: game.driving.vehicle, world: game.driving.world };
    const service = new CityIncidentService(CONFIG, parked, { weights: { night: 0 } }, () => 0.5, game.events, new MemoryLogger());
    const started: string[] = [];
    game.events.on('CityIncidentStarted', ({ kind }) => started.push(kind));
    service.force('building_fire');
    for (let t = 0; t < CONFIG.firstAfterSeconds * 2; t++) {
      service.update(1);
    }
    expect(started).toEqual([]);
  });
});
