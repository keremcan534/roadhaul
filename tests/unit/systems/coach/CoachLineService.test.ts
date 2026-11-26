import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { COACH } from '../../../../src/data/content/coach';
import { GAME_CONTENT } from '../../../../src/data/content';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import type { PlaceDefinition } from '../../../../src/data/definitions/MapDefinition';
import type { Credits } from '../../../../src/data/units';
import { createVehicleInput } from '../../../../src/domain/vehicles/VehicleInput';
import { CoachLineService, type CoachClock } from '../../../../src/systems/coach/CoachLineService';
import { DrivingService } from '../../../../src/systems/driving/DrivingService';
import type { MoneyReason } from '../../../../src/systems/economy/EconomyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { STEP_SECONDS } from '../../../support/driving';
import { MemoryLogger } from '../../../support/MemoryLogger';

const content = ContentCatalog.create(GAME_CONTENT);
const config = DEFAULT_GAME_CONFIG.coachLines;
const map = content.maps.get('north_valley');
const STATION = (map.places ?? []).find((place) => place.kind === 'busStation')!;

function setup(options: { contract?: boolean; clock?: CoachClock } = {}) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const driving = new DrivingService(content, events, logger);
  driving.start(content.vehicles.all[0]!.id, 'north_valley');
  driving.placeTruck(STATION.lot.x, STATION.lot.z, (STATION.lot.headingDegrees * Math.PI) / 180);
  const earned: [Credits, MoneyReason][] = [];
  let xp = 0;
  const service = new CoachLineService(
    driving,
    { active: options.contract === true ? {} : null },
    { earn: (amount, reason) => earned.push([amount, reason]) },
    { award: (amount) => (xp += amount) },
    () => options.clock ?? { hour: 12, day: 20_000 },
    COACH,
    config,
    DEFAULT_GAME_CONFIG.traffic.speedLimitsKmh,
    events,
    logger,
  );
  const ended: GameEvents['CoachLineEnded'][] = [];
  events.on('CoachLineEnded', (event) => ended.push(event));
  const served: GameEvents['CoachStopServed'][] = [];
  events.on('CoachStopServed', (event) => served.push(event));
  return { service, driving, events, earned, ended, served, xp: () => xp };
}

/** Steps the run and the coach `seconds` with no hands on the controls (held at a stop, rolling to rest between). */
function run(service: CoachLineService, driving: DrivingService, seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += STEP_SECONDS) {
    const input = createVehicleInput();
    input.brake = 1;
    service.update(STEP_SECONDS, input);
    if (service.active) {
      driving.step(STEP_SECONDS, input);
    }
  }
}

/** The coach set down at its next stop, standing, and stepped until it is served. */
function arrive(service: CoachLineService, driving: DrivingService) {
  const stop = service.navTarget!;
  driving.placeTruck(stop.x, stop.z, stop.heading);
  run(service, driving, STEP_SECONDS * 2);
}

/** Steps until the doors close (the coach then drives to the next stop) or the run ends. */
function boardAndLeave(service: CoachLineService, driving: DrivingService) {
  for (let i = 0; i < 2000 && service.stage === 'atStop'; i++) {
    run(service, driving, STEP_SECONDS * 10);
  }
}

describe('CoachLineService', () => {
  it('runs only from a coach station, without a contract, the truck free', () => {
    const diner: PlaceDefinition = { ...STATION, kind: 'diner' };
    expect(setup().service.canStart(diner)).toEqual({ ok: false, error: 'notAStation' });
    expect(setup({ contract: true }).service.start(STATION)).toEqual({ ok: false, error: 'contract' });
    const { service } = setup();
    expect(service.start(STATION)).toEqual({ ok: true, value: undefined });
    expect(service.start(STATION)).toEqual({ ok: false, error: 'busy' });
  });

  it('puts the truck aside and opens the coach doors beside the station for the people waiting there', () => {
    const { service, driving } = setup();
    const truckX = driving.vehicle.x;
    service.start(STATION);

    expect(driving.racing).toBe(true);
    expect(driving.definition.id).toBe(COACH.id);
    expect(driving.parkedTruck!.x).toBeCloseTo(truckX);
    expect(service.stage).toBe('atStop');
    expect(service.stopIndex).toBe(0);
    expect(service.onBoard).toBeGreaterThanOrEqual(config.waiting[0]);
    expect(service.navTarget).toBeNull();
    // The doors close after the people are on: then the GPS leads to the first town's stop.
    boardAndLeave(service, driving);
    expect(service.stage).toBe('driving');
    expect(service.stopIndex).toBe(1);
    expect(service.navTarget).toBe(service.line!.stops[1]);
  });

  it('serves each stop standing beside it: people off and on, on time or late; and pays everyone carried at the last', () => {
    const { service, driving, earned, ended, served, xp } = setup();
    service.start(STATION);
    boardAndLeave(service, driving);
    const stops = service.line!.stops.length;
    // Not at the stop yet: driving past it at speed serves nothing.
    expect(service.stage).toBe('driving');
    for (let index = 1; index < stops; index++) {
      const onBoard = service.onBoard;
      arrive(service, driving);
      expect(service.stage === 'atStop' || !service.active).toBe(true);
      const last = served.at(-1)!;
      expect(last.stopIndex).toBe(index);
      expect(service.onBoard).toBe(onBoard - last.off + last.on);
      if (index === stops - 1) {
        expect(last.off).toBe(onBoard);
        expect(last.on).toBe(0);
      }
      boardAndLeave(service, driving);
    }

    expect(service.active).toBe(false);
    expect(driving.racing).toBe(false);
    const result = ended[0]!;
    expect(result.finished).toBe(true);
    expect(result.passengers).toBeGreaterThan(0);
    expect(result.fares).toBe(result.passengers * config.fareCredits);
    // Set down at each stop at once: well ahead of the timetable, and no pulls.
    expect(result.onTimeStops).toBe(stops - 1);
    expect(result.stars).toBe(3);
    expect(result.total).toBe(result.fares + result.onTimeBonus + result.comfortBonus);
    expect(earned).toEqual([[result.total, 'coach']]);
    expect(xp()).toBe(result.xp);
  });

  it('counts a stop reached after the timetable as late, and loses the bonus for it', () => {
    const { service, driving, ended } = setup();
    service.start(STATION);
    boardAndLeave(service, driving);
    // Dawdling a long while before the first stop.
    run(service, driving, service.line!.stops[1]!.dueSeconds + config.lateGraceSeconds + 30);
    arrive(service, driving);
    service.quit();

    expect(ended[0]!.finished).toBe(false);
    expect(ended[0]!.onTimeStops).toBe(0);
    expect(ended[0]!.onTimeBonus).toBe(0);
  });

  it('loses comfort for knocks with people on board', () => {
    const { service, driving, events } = setup();
    service.start(STATION);
    expect(service.comfort).toBe(100);
    events.emit('RaceCarCollided', { impactSpeedMetersPerSecond: 5 });
    expect(service.comfort).toBe(100 - config.comfortPerKnock);
    // A touch at walking pace is no knock.
    events.emit('RaceCarCollided', { impactSpeedMetersPerSecond: 0.5 });
    expect(service.comfort).toBe(100 - config.comfortPerKnock);
    expect(driving.racing).toBe(true);
  });

  it('given up, pays the fares of those already off and nothing more, and drives the truck again', () => {
    const { service, driving, earned, ended } = setup();
    service.start(STATION);
    boardAndLeave(service, driving);
    arrive(service, driving);
    const carried = service.passengersCarried;
    service.quit();

    expect(driving.racing).toBe(false);
    expect(ended[0]).toMatchObject({ finished: false, stars: 0, passengers: carried, onTimeBonus: 0, comfortBonus: 0 });
    expect(earned).toEqual(carried > 0 ? [[carried * config.fareCredits, 'coach']] : []);
  });

  it('runs the city line too: round the town and back, everyone off at the station, at the city fare', () => {
    const { service, driving, events, ended, earned } = setup();
    const started: GameEvents['CoachLineStarted'][] = [];
    events.on('CoachLineStarted', (event) => started.push(event));
    const city = service.lineFrom(STATION, 'city')!;
    expect(city.kind).toBe('city');
    expect(service.lineFrom(STATION, 'intercity')).not.toBe(city);
    expect(service.canStart(STATION, 'city')).toEqual({ ok: true, value: undefined });

    service.start(STATION, 'city');
    expect(started).toEqual([{ placeId: STATION.id, kind: 'city', stops: city.stops.length }]);
    expect(service.line).toBe(city);
    boardAndLeave(service, driving);
    for (let index = 1; index < city.stops.length; index++) {
      arrive(service, driving);
      boardAndLeave(service, driving);
    }

    expect(service.active).toBe(false);
    const result = ended[0]!;
    expect(result).toMatchObject({ kind: 'city', finished: true, stops: city.stops.length - 1, stars: 3 });
    expect(result.fares).toBe(result.passengers * config.city.fareCredits);
    expect(earned).toEqual([[result.total, 'coach']]);
    // Back at the station's stop, where it began.
    expect(Math.hypot(driving.vehicle.x - city.stops[0]!.x, driving.vehicle.z - city.stops[0]!.z)).toBeLessThan(40);
  });

  it('finds fewer people waiting at night than in the rush hour', () => {
    const night = setup({ clock: { hour: 2, day: 20_000 } });
    const rush = setup({ clock: { hour: 8, day: 20_000 } });
    night.service.start(STATION);
    rush.service.start(STATION);

    expect(night.service.onBoard).toBeLessThan(rush.service.onBoard);
  });
});
