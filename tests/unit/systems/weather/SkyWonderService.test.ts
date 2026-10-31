import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import type { Season } from '../../../../src/data/definitions/Season';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { SkyWonderService } from '../../../../src/systems/weather/SkyWonderService';
import { MemoryLogger } from '../../../support/MemoryLogger';

const CONFIG = { auroraChance: { spring: 0.5, summer: 0, autumn: 0.5, winter: 1 }, meteorCountSeconds: 300 };

function setup(season: Season = 'winter', roll = 0.4) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const sky = { weights: { night: 0 } };
  const service = new SkyWonderService(CONFIG, sky, { season }, () => roll, events, logger);
  const seen: string[] = [];
  events.on('SkyWonderSighted', ({ kind }) => seen.push(kind));
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 1) {
      service.update(1);
    }
  };
  return { service, sky, seen, run };
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
});
