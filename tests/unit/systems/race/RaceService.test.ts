import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG, type CrateTier } from '../../../../src/data/config/GameConfig';
import { RACE_CAR } from '../../../../src/data/content/raceCar';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import type { PlaceDefinition } from '../../../../src/data/definitions/MapDefinition';
import { createVehicleInput } from '../../../../src/domain/vehicles/VehicleInput';
import { DrivingService } from '../../../../src/systems/driving/DrivingService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { RaceService } from '../../../../src/systems/race/RaceService';
import { contentFixture, mapFixture } from '../../../support/contentFixtures';
import { STEP_SECONDS } from '../../../support/driving';
import { MemoryLogger } from '../../../support/MemoryLogger';

/** A club at the west end of the fixture's street (along x, z = 0), its races to the east end. */
const CLUB: PlaceDefinition = {
  id: 'test_race_club',
  kind: 'raceClub',
  lot: { x: -135, z: 20, headingDegrees: 90, lengthMeters: 44, widthMeters: 30 },
  raceTo: { x: 148, z: 0 },
};

function setup(options: { racesLeft?: number; contract?: boolean } = {}) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const content = ContentCatalog.create(contentFixture({ maps: [mapFixture({ places: [CLUB] })] }));
  const driving = new DrivingService(content, events, logger);
  driving.start(content.vehicles.all[0]!.id, 'test_map');
  driving.placeTruck(-135, 12, Math.PI / 2);
  let racesLeft = options.racesLeft ?? 3;
  const places = {
    get racesLeftToday() {
      return racesLeft;
    },
    countRace: () => {
      racesLeft--;
    },
  };
  const crates: CrateTier[] = [];
  const service = new RaceService(
    driving,
    places,
    { active: options.contract === true ? {} : null },
    { grant: (tier) => crates.push(tier) },
    RACE_CAR,
    DEFAULT_GAME_CONFIG.races,
    events,
    logger,
  );
  const ended: GameEvents['RaceEnded'][] = [];
  events.on('RaceEnded', (event) => ended.push(event));
  const started: string[] = [];
  events.on('RaceStarted', ({ placeId }) => started.push(placeId));
  return { service, driving, crates, ended, started, racesLeft: () => racesLeft };
}

/** Steps the race and the car `seconds`, with `throttle` on the car once the lights let it. */
function run(service: RaceService, driving: DrivingService, seconds: number, throttle = 0) {
  for (let t = 0; t < seconds - 1e-9; t += STEP_SECONDS) {
    const input = createVehicleInput();
    input.throttle = throttle;
    service.update(STEP_SECONDS, input);
    if (service.active) {
      driving.step(STEP_SECONDS, input);
    }
  }
}

describe('RaceService', () => {
  it('races only from a race club, without a contract, and a few a day', () => {
    const { raceTo: _finish, ...diner } = CLUB;
    expect(setup().service.canStart({ ...diner, kind: 'diner' })).toEqual({ ok: false, error: 'notAClub' });
    expect(setup({ contract: true }).service.start(CLUB)).toEqual({ ok: false, error: 'contract' });
    expect(setup({ racesLeft: 0 }).service.start(CLUB)).toEqual({ ok: false, error: 'noneLeft' });
  });

  it('puts the truck aside, lines the race car up on the road, and holds it while the lights count down', () => {
    const { service, driving, started, racesLeft } = setup();
    const truckX = driving.vehicle.x;

    expect(service.start(CLUB)).toEqual({ ok: true, value: undefined });
    expect(started).toEqual(['test_race_club']);
    expect(racesLeft()).toBe(2);
    expect(driving.racing).toBe(true);
    expect(driving.definition.id).toBe('rh_sprint');
    expect(driving.parkedTruck!.x).toBe(truckX);
    expect(Math.abs(driving.vehicle.z)).toBeLessThan(5); // On the street.
    expect(service.stage).toBe('countdown');

    const held = createVehicleInput();
    held.throttle = 1;
    service.update(STEP_SECONDS, held);
    expect(held).toMatchObject({ throttle: 0, brake: 1, lever: 'drive' });
    run(service, driving, DEFAULT_GAME_CONFIG.races.countdownSeconds);
    expect(service.stage).toBe('racing');
    expect(service.field).toBe(4);
  });

  it('pays the podium a crate at the line, and the truck is driven again', () => {
    const { service, driving, crates, ended } = setup();
    service.start(CLUB);
    run(service, driving, DEFAULT_GAME_CONFIG.races.countdownSeconds + 2, 1);
    expect(driving.vehicle.speed).toBeGreaterThan(3);
    expect(service.position).toBeGreaterThan(1); // The rivals start ahead on the grid.

    // Up the street (put down 20 m on at a time, as fast as no car goes) and over the line before any rival.
    for (let x = driving.vehicle.x; service.active && x < 147; ) {
      x = Math.min(x + 20, 147);
      driving.placeTruck(x, 2.5, Math.PI / 2);
      run(service, driving, STEP_SECONDS);
    }

    expect(ended).toEqual([{ placeId: 'test_race_club', position: 1, of: 4, seconds: expect.any(Number), crate: 'gold' }]);
    expect(crates).toEqual(['gold']);
    expect(service.active).toBe(false);
    expect(driving.racing).toBe(false);
    expect(driving.definition.id).not.toBe('rh_sprint');
    expect(driving.vehicle.x).toBeCloseTo(-135, 0);
  });

  it('gives last place and no crate to a race not finished long after the rivals', () => {
    const { service, driving, crates, ended } = setup();
    service.start(CLUB);

    run(service, driving, 240);

    expect(ended).toMatchObject([{ position: 4, crate: null }]);
    expect(crates).toEqual([]);
  });

  it('lets the player give up: no place, no crate', () => {
    const { service, driving, crates, ended } = setup();
    service.start(CLUB);
    run(service, driving, 5, 1);

    service.quit();

    expect(ended).toMatchObject([{ position: null, crate: null }]);
    expect(crates).toEqual([]);
    expect(driving.racing).toBe(false);
    service.quit(); // Nothing more to give up.
    expect(ended).toHaveLength(1);
  });
});
