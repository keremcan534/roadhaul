import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import type { GameConfig } from '../../../../src/data/config/GameConfig';
import type { PerformanceModifier, DrivingService } from '../../../../src/systems/driving/DrivingService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import type { TrafficService } from '../../../../src/systems/traffic/TrafficService';
import { WeatherService } from '../../../../src/systems/weather/WeatherService';
import { contentFixture, weatherFixture } from '../../../support/contentFixtures';
import { MemoryLogger } from '../../../support/MemoryLogger';

const STEP = 1 / 60;

/** Clear (60–120 s) and rain (grip 0.8, traffic 0.8); the weather records what it sets. */
function setup(config: Partial<GameConfig['weather']> = {}) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const content = ContentCatalog.create(contentFixture());
  const grip: number[] = [];
  const trafficSpeed: number[] = [];
  const driving = {
    setPerformanceModifier: (source: string, modifier: PerformanceModifier) => {
      if (source === 'weather') grip.push(modifier.gripFactor);
    },
  } as unknown as DrivingService;
  const traffic = { setSpeedFactor: (factor: number) => trafficSpeed.push(factor) } as unknown as TrafficService;
  const changes: GameEvents['WeatherChanged'][] = [];
  events.on('WeatherChanged', (event) => changes.push(event));
  const weather = new WeatherService(
    content,
    driving,
    traffic,
    events,
    { initialWeatherId: 'test_clear', clearWeatherId: 'test_clear', changes: true, transitionSeconds: 20, ...config },
    logger,
  );
  return { weather, grip, trafficSpeed, changes };
}

function run(weather: WeatherService, seconds: number, each?: () => void): void {
  for (let step = 0; step < Math.round(seconds / STEP); step++) {
    weather.update(STEP);
    each?.();
  }
}

describe('WeatherService', () => {
  it('slows traffic in the dark too, as the time of day says, in small steps', () => {
    const content = ContentCatalog.create(contentFixture());
    const trafficSpeed: number[] = [];
    const daylight = { trafficSpeedFactor: 1 };
    const weather = new WeatherService(
      content,
      { setPerformanceModifier: () => {} } as unknown as DrivingService,
      { setSpeedFactor: (factor: number) => trafficSpeed.push(factor) } as unknown as TrafficService,
      new EventBus<GameEvents>(new MemoryLogger()),
      { initialWeatherId: 'test_rain', clearWeatherId: 'test_clear', changes: false, transitionSeconds: 20 },
      new MemoryLogger(),
      daylight,
    );
    expect(trafficSpeed).toEqual([0.8]);

    // The evening darkens slowly: traffic slows in steps, not every fixed step.
    for (let step = 0; step < 100; step++) {
      daylight.trafficSpeedFactor = 1 - (0.1 * step) / 99;
      weather.update(STEP);
    }
    expect(trafficSpeed.at(-1)).toBeCloseTo(0.8 * 0.9, 9);
    expect(trafficSpeed.length).toBeLessThan(30);
  });

  it('starts in the configured weather and applies it', () => {
    const { weather, grip, trafficSpeed } = setup({ initialWeatherId: 'test_rain' });

    expect(weather.current.id).toBe('test_rain');
    expect(weather.previous).toBe(weather.current);
    expect(weather.blend).toBe(1);
    expect(grip).toEqual([0.8]);
    expect(trafficSpeed).toEqual([0.8]);
  });

  it('turns into another weather when the spell is over, easing the grip and the traffic across', () => {
    const { weather, grip, changes } = setup();
    let midway = Number.NaN;

    // Clear lasts at most 120 s; the turn takes 20 s.
    run(weather, 121, () => {
      if (weather.blend > 0.49 && weather.blend < 0.51) midway = weather.gripFactor;
    });

    expect(changes).toEqual([{ weatherId: 'test_rain', previousId: 'test_clear' }]);
    expect(weather.current.id).toBe('test_rain');
    run(weather, 20);
    expect(weather.blend).toBe(1);
    expect(weather.gripFactor).toBe(0.8);
    expect(midway).toBeCloseTo(0.9, 2);
    expect(grip[0]).toBe(1);
    expect(grip.at(-1)).toBe(0.8);
    // Every step of the turn eased the grip down, never up.
    for (let i = 1; i < grip.length; i++) {
      expect(grip[i]).toBeLessThanOrEqual(grip[i - 1]!);
    }
  });

  it('hands the grip on in small steps during a turn, not every fixed step', () => {
    const { weather, grip } = setup();

    run(weather, 141);

    expect(weather.current.id).toBe('test_rain');
    // From 1 to 0.8 in steps of about 0.01, over 20 s of 60 steps a second.
    expect(grip.length).toBeGreaterThan(15);
    expect(grip.length).toBeLessThan(30);
  });

  it('blends the rain and the lamps across a turn', () => {
    const { weather } = setup();
    let midway = { rain: Number.NaN, lamps: Number.NaN };

    run(weather, 141, () => {
      if (weather.blend > 0.49 && weather.blend < 0.51) midway = { rain: weather.rain, lamps: weather.lamps };
    });

    expect(midway.rain).toBeCloseTo(0.5, 1);
    expect(midway.lamps).toBeCloseTo(0.2, 1);
    expect(weather.rain).toBe(1);
    expect(weather.lamps).toBe(0.4);
  });

  it('wets the roads soon after the rain starts, and dries them off slowly after it stops', () => {
    const { weather } = setup({ changes: false });
    expect(weather.wetness).toBe(0);

    weather.set('test_rain');
    run(weather, 5);
    const wetting = weather.wetness;
    expect(wetting).toBeGreaterThan(0.1);
    expect(wetting).toBeLessThan(0.5);
    run(weather, 30);
    expect(weather.wetness).toBe(1);

    // The rain stops: the roads stay wet a while (the rainbow's and the puddles' time), then dry.
    weather.set('test_clear');
    run(weather, 30);
    expect(weather.wetness).toBeGreaterThan(0.7);
    run(weather, 60);
    expect(weather.wetness).toBeGreaterThan(0.3);
    expect(weather.wetness).toBeLessThan(0.7);
    run(weather, 120);
    expect(weather.wetness).toBe(0);
  });

  it('starts wet in the rain, and never wetter than the rain makes it', () => {
    expect(setup({ initialWeatherId: 'test_rain' }).weather.wetness).toBe(1);

    // Turning to rain, the roads wet as it comes on.
    const { weather } = setup();
    let wettest = 0;
    run(weather, 141, () => {
      wettest = Math.max(wettest, weather.wetness - weather.rain);
    });
    expect(wettest).toBeLessThanOrEqual(0);
    expect(weather.current.id).toBe('test_rain');
    expect(weather.wetness).toBe(1);
  });

  it('never turns into the weather it already is', () => {
    const { weather, changes } = setup();

    run(weather, 1200);

    expect(changes.length).toBeGreaterThan(5);
    for (const change of changes) {
      expect(change.weatherId).not.toBe(change.previousId);
    }
  });

  it('goes round the day in order: each weather only turns into those it may', () => {
    const logger = new MemoryLogger();
    const events = new EventBus<GameEvents>(logger);
    const day = (id: string, next: string[]) => weatherFixture({ id, next, minSeconds: 10, maxSeconds: 10 });
    const content = ContentCatalog.create(
      contentFixture({
        weather: [
          day('day', ['rain', 'dusk']),
          day('rain', ['day']),
          day('dusk', ['night']),
          day('night', ['dawn']),
          day('dawn', ['day']),
        ],
      }),
    );
    const turns: string[] = [];
    events.on('WeatherChanged', ({ previousId, weatherId }) => turns.push(`${previousId}>${weatherId}`));
    const weather = new WeatherService(
      content,
      { setPerformanceModifier: () => {} } as unknown as DrivingService,
      { setSpeedFactor: () => {} } as unknown as TrafficService,
      events,
      { initialWeatherId: 'day', clearWeatherId: 'day', changes: true, transitionSeconds: 1 },
      logger,
    );

    run(weather, 2000);

    expect(new Set(turns)).toEqual(new Set(['day>rain', 'rain>day', 'day>dusk', 'dusk>night', 'night>dawn', 'dawn>day']));
  });

  it('keeps its weather when it may not change, and can be set straight away', () => {
    const { weather, changes, grip } = setup({ changes: false });

    run(weather, 600);
    expect(changes).toEqual([]);

    weather.set('test_rain');
    expect(weather.current.id).toBe('test_rain');
    expect(weather.blend).toBe(1);
    expect(grip.at(-1)).toBe(0.8);
    expect(changes).toEqual([{ weatherId: 'test_rain', previousId: 'test_clear' }]);
  });

  it('holds the weather the player picks, turning to it at once, and lets it change again', () => {
    const { weather, changes, grip } = setup();
    expect(weather.held).toBeNull();

    weather.hold('test_rain');

    expect(weather.current.id).toBe('test_rain');
    expect(weather.blend).toBe(1);
    expect(weather.held).toBe('test_rain');
    expect(grip.at(-1)).toBe(0.8);
    expect(changes).toEqual([{ weatherId: 'test_rain', previousId: 'test_clear' }]);
    // The roads wet as the rain falls: not at once.
    expect(weather.wetness).toBe(0);
    run(weather, 1200);
    expect(weather.current.id).toBe('test_rain');
    expect(changes).toHaveLength(1);
    expect(weather.wetness).toBe(1);

    // Let go, it rains on a while (a spell of 60 to 120 s), then turns.
    weather.hold(null);
    expect(weather.held).toBeNull();
    run(weather, 50);
    expect(changes).toHaveLength(1);
    run(weather, 300);
    expect(changes.length).toBeGreaterThan(1);
    expect(changes[1]).toEqual({ weatherId: 'test_clear', previousId: 'test_rain' });
  });

  it('holds the weather it starts in when it may not change, until the player lets it', () => {
    const { weather, changes } = setup({ changes: false });
    expect(weather.held).toBe('test_clear');

    weather.hold(null);
    run(weather, 300);

    expect(weather.held).toBeNull();
    expect(changes.length).toBeGreaterThan(0);
  });

  it('gives the truck its grip back when disposed', () => {
    const { weather, grip } = setup({ initialWeatherId: 'test_rain' });

    weather.dispose();

    expect(grip.at(-1)).toBe(1);
  });

  it('picks by weight: a rarely chosen weather comes up rarely', () => {
    const logger = new MemoryLogger();
    const events = new EventBus<GameEvents>(logger);
    const content = ContentCatalog.create(
      contentFixture({
        weather: [
          weatherFixture({ id: 'common', weight: 9, minSeconds: 10, maxSeconds: 10 }),
          weatherFixture({ id: 'middling', weight: 9, minSeconds: 10, maxSeconds: 10 }),
          weatherFixture({ id: 'rare', weight: 1, minSeconds: 10, maxSeconds: 10 }),
        ],
      }),
    );
    const counts = new Map<string, number>();
    events.on('WeatherChanged', ({ weatherId }) => counts.set(weatherId, (counts.get(weatherId) ?? 0) + 1));
    const weather = new WeatherService(
      content,
      { setPerformanceModifier: () => {} } as unknown as DrivingService,
      { setSpeedFactor: () => {} } as unknown as TrafficService,
      events,
      { initialWeatherId: 'common', clearWeatherId: 'common', changes: true, transitionSeconds: 1 },
      logger,
    );

    run(weather, 11 * 400);

    expect(counts.get('rare') ?? 0).toBeLessThan((counts.get('common') ?? 0) / 3);
    expect(counts.get('rare') ?? 0).toBeGreaterThan(0);
  });
});
