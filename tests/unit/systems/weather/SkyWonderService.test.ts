import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import type { Season } from '../../../../src/data/definitions/Season';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { SkyWonderService } from '../../../../src/systems/weather/SkyWonderService';
import { MemoryLogger } from '../../../support/MemoryLogger';

const CONFIG = {
  auroraChance: { spring: 0.5, summer: 0, autumn: 0.5, winter: 1 },
  meteorCountSeconds: 300,
  eclipses: { ...DEFAULT_GAME_CONFIG.skyWonders.eclipses, solarChance: 1, lunarChance: 1 },
};
const SKY = DEFAULT_GAME_CONFIG.timeOfDay;
/** The model's new moon of 9 November 2026 (21:58 UTC): an eclipse of the sun on its day, with every new moon's. */
const NEW_MOON_DAY_MS = Date.UTC(2026, 10, 9, 8);
/** A week on: neither a new nor a full moon. */
const PLAIN_DAY_MS = Date.UTC(2026, 10, 16, 8);

function setup(season: Season = 'winter', roll = 0.4, nowMs = PLAIN_DAY_MS) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const sky = {
    weights: { night: 0 },
    minutes: 10 * 60,
    moonDrawn: 0,
    drawMoonToPhase(_phase: number, weight: number) {
      sky.moonDrawn = weight;
    },
  };
  const clock = { nowMs, now: () => clock.nowMs };
  const calendar = { clock, offsetMinutes: 0, latitudeDegrees: SKY.latitudeDegrees, solarNoonHours: SKY.solarNoonHours };
  const service = new SkyWonderService(CONFIG, sky, { season }, calendar, () => roll, events, logger);
  const seen: string[] = [];
  events.on('SkyWonderSighted', ({ kind }) => seen.push(kind));
  const began: GameEvents['EclipseBegan'][] = [];
  events.on('EclipseBegan', (event) => began.push(event));
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 1) {
      service.update(1);
    }
  };
  return { service, sky, clock, seen, began, run };
}

describe('SkyWonderService', () => {
  it('draws each night as it falls whether the northern lights come out, and fades them in and out', () => {
    const { service, sky, run } = setup('winter');
    run(60);
    expect(service.aurora).toBe(0);
    sky.weights.night = 1;
    run(10);
    expect(service.aurora).toBeGreaterThan(0.2);
    run(120);
    expect(service.aurora).toBeGreaterThan(0.99);
    // Dawn: they fade away.
    sky.weights.night = 0;
    run(120);
    expect(service.aurora).toBeLessThan(0.01);
  });

  it('keeps them away on the nights the draw says no, unless asked to show them', () => {
    const summer = setup('summer');
    summer.sky.weights.night = 1;
    summer.run(120);
    expect(summer.service.aurora).toBe(0);

    const shown = setup('summer');
    shown.service.forceAurora(true);
    shown.sky.weights.night = 1;
    shown.run(120);
    expect(shown.service.aurora).toBeGreaterThan(0.99);
  });

  it('counts a wonder as it is first watched on the sky: the lights once a night, a rainbow and a shooting star every few minutes', () => {
    const { service, seen, run, sky } = setup();
    // On the sky while the player looks away (paused): counted once watched, and not again for looking away and back.
    service.observe('aurora', true, false);
    expect(seen).toEqual([]);
    service.observe('aurora', true, true);
    service.observe('aurora', true, false);
    service.observe('aurora', true, true);
    // Hidden by the clouds and back: still tonight's.
    service.observe('aurora', false, true);
    service.observe('aurora', true, true);
    expect(seen).toEqual(['aurora']);
    // The next night's lights count again.
    sky.weights.night = 0;
    run(1);
    sky.weights.night = 1;
    run(1);
    service.observe('aurora', false, true);
    service.observe('aurora', true, true);
    expect(seen).toEqual(['aurora', 'aurora']);

    service.observe('rainbow', true, true);
    service.observe('rainbow', false, true);
    run(60);
    service.observe('rainbow', true, true);
    service.observe('rainbow', false, true);
    run(600);
    service.observe('rainbow', true, true);

    service.observe('meteor', true, true);
    service.observe('meteor', false, true);
    run(60);
    service.observe('meteor', true, true);
    service.observe('meteor', false, true);
    run(300);
    service.observe('meteor', true, true);
    expect(seen).toEqual(['aurora', 'aurora', 'rainbow', 'rainbow', 'meteor', 'meteor']);
  });

  it("brings an eclipse of the sun on a new moon's day as the game's clock reaches it, announced once as it begins", () => {
    const { service, sky, began, run } = setup('winter', 0.4, NEW_MOON_DAY_MS);
    const eclipse = service.eclipseOn(0)!;
    expect(eclipse.kind).toBe('solar');
    const half = CONFIG.eclipses.solarPartialMinutes + CONFIG.eclipses.solarTotalMinutes / 2;
    sky.minutes = eclipse.centreMinutes - half - 5;
    run(1);
    expect(service.eclipse.kind).toBeNull();
    expect(began).toEqual([]);
    sky.minutes = eclipse.centreMinutes - half + 5;
    run(1);
    expect(service.eclipse.kind).toBe('solar');
    sky.minutes = eclipse.centreMinutes;
    run(3);
    expect(service.eclipse).toMatchObject({ kind: 'solar', cover: 1, totality: 1 });
    expect(began).toEqual([{ kind: 'solar', totalityMinutes: eclipse.totalityMinutes }]);
    // Over: gone; the next game day it comes round again.
    sky.minutes = eclipse.centreMinutes + half + 5;
    run(1);
    expect(service.eclipse.kind).toBeNull();
    sky.minutes = eclipse.centreMinutes;
    run(1);
    expect(began).toHaveLength(2);
  });

  it('has none on a plain day, but one at the hour asked for a look', () => {
    const { service, sky, began, run } = setup();
    expect(service.eclipseOn(0)).toBeNull();
    sky.minutes = 770;
    run(1);
    expect(service.eclipse.kind).toBeNull();

    service.forceEclipse('lunar', 50);
    expect(service.eclipseOn(0)).toMatchObject({ kind: 'lunar', centreMinutes: 50 });
    sky.minutes = 50;
    run(1);
    expect(service.eclipse).toMatchObject({ kind: 'lunar', totality: 1 });
    // Through it the moon stands exactly full, opposite the sun.
    expect(sky.moonDrawn).toBe(1);
    expect(began).toEqual([{ kind: 'lunar', totalityMinutes: 30 }]);
    service.forceEclipse(null);
    run(1);
    expect(service.eclipse.kind).toBeNull();
    expect(sky.moonDrawn).toBe(0);
  });

  it("tells the news tomorrow's eclipse, and plans a new day's as the calendar turns", () => {
    const { service, clock, sky, run } = setup('winter', 0.4, NEW_MOON_DAY_MS - 86_400_000);
    expect(service.eclipseOn(0)).toBeNull();
    expect(service.eclipseOn(1)?.kind).toBe('solar');
    sky.minutes = service.eclipseOn(1)!.centreMinutes;
    run(1);
    expect(service.eclipse.kind).toBeNull();
    clock.nowMs = NEW_MOON_DAY_MS;
    run(1);
    expect(service.eclipse.kind).toBe('solar');
  });

  it('counts an eclipse seen at totality once each time it comes round', () => {
    const { service, sky, seen, run } = setup('winter', 0.4, NEW_MOON_DAY_MS);
    const eclipse = service.eclipseOn(0)!;
    sky.minutes = eclipse.centreMinutes;
    run(1);
    service.observe('solarEclipse', true, true);
    service.observe('solarEclipse', false, true);
    service.observe('solarEclipse', true, true);
    expect(seen).toEqual(['solarEclipse']);
    // Over, and round again the next game day: it counts again.
    sky.minutes = eclipse.centreMinutes + 120;
    run(1);
    service.observe('solarEclipse', false, true);
    sky.minutes = eclipse.centreMinutes;
    run(1);
    service.observe('solarEclipse', true, true);
    expect(seen).toEqual(['solarEclipse', 'solarEclipse']);
  });
});
