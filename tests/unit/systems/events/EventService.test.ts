import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import type { EventDefinition } from '../../../../src/data/definitions/EventDefinition';
import type { MissionReward } from '../../../../src/domain/missions/missionReward';
import { CompanyService } from '../../../../src/systems/company/CompanyService';
import { EconomyService } from '../../../../src/systems/economy/EconomyService';
import { EventService } from '../../../../src/systems/events/EventService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { contentFixture, eventFixture, missionFixture } from '../../../support/contentFixtures';
import { MemoryLogger } from '../../../support/MemoryLogger';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Wednesday of a week the fixture event runs (it runs from Monday 2026-09-28 for a week). */
const DURING = Date.UTC(2026, 8, 30, 12);
/** The week before, when it is off. */
const BEFORE = DURING - 7 * DAY_MS;

function setup(events: readonly EventDefinition[] = [eventFixture()]) {
  const logger = new MemoryLogger();
  const bus = new EventBus<GameEvents>(logger);
  const content = ContentCatalog.create(
    contentFixture({ events, missions: [missionFixture(), missionFixture({ id: 'heavy_mission', cargoWeightTons: 9 })] }),
  );
  const economy = new EconomyService(bus, DEFAULT_GAME_CONFIG.economy, logger);
  const company = new CompanyService(bus, DEFAULT_GAME_CONFIG.company, logger);
  const clock = { nowMs: DURING, now: () => clock.nowMs };
  const service = new EventService(content, company, economy, clock, bus, logger);
  const progressed: GameEvents['EventProgressed'][] = [];
  bus.on('EventProgressed', (event) => progressed.push(event));
  return { bus, economy, company, clock, service, progressed };
}

/** A delivery of the fixture mission (600 s limit) as MissionService reports it: 2000 credits, no XP. */
function deliver(
  bus: EventBus<GameEvents>,
  { deliverySeconds = 300, cargoDamage = 0, missionId = 'test_mission', total = 2000 } = {},
): void {
  const onTime = deliverySeconds <= 601;
  const reward: MissionReward = {
    basePay: total,
    timeBonus: 0,
    latePenalty: 0,
    conditionBonus: 0,
    total,
    onTime,
    lateSeconds: onTime ? 0 : deliverySeconds - 600,
  };
  bus.emit('MissionCompleted', { missionId, reward, deliverySeconds, cargoDamage, xp: 0, reputation: 0 });
}

describe('EventService', () => {
  it('knows which events run now and which come next, by the clock', () => {
    const { service, clock } = setup();

    expect(service.statuses()).toMatchObject([{ running: true, locked: false, progress: 0, completed: false }]);
    clock.nowMs = BEFORE;
    const [upcoming] = service.statuses();
    expect(upcoming!.running).toBe(false);
    expect(upcoming!.run!.startMs).toBe(Date.UTC(2026, 8, 28));
  });

  it('pays the bonus on a qualifying delivery and counts it toward the objective', () => {
    const { bus, economy, service, progressed } = setup();

    deliver(bus); // Half the time left: it qualifies (a fifth needed).

    // 2000 for the delivery, 25% on top from the event.
    expect(economy.credits).toBe(2500);
    expect(progressed).toEqual([{ eventId: 'test_event', bonus: 500, progress: 1, target: 2, reward: null }]);
    expect(service.statuses()[0]).toMatchObject({ progress: 1, completed: false });
  });

  it('pays nothing extra for deliveries that miss its conditions, or while it is off', () => {
    const { bus, economy, clock, progressed } = setup();

    deliver(bus, { deliverySeconds: 540 }); // A tenth of the time left.
    deliver(bus, { deliverySeconds: 700 }); // Late.
    clock.nowMs = BEFORE;
    deliver(bus);

    expect(economy.credits).toBe(6000);
    expect(progressed).toEqual([]);
  });

  it('pays the reward once when the objective is met, and the bonus after that', () => {
    const { bus, economy, company, service, progressed } = setup();

    deliver(bus);
    deliver(bus);
    deliver(bus);

    // Three deliveries with their bonus, and the reward once: 1000 credits and 100 XP.
    expect(economy.credits).toBe(3 * 2500 + 1000);
    expect(company.xp).toBe(100);
    expect(progressed.map(({ progress, reward }) => [progress, reward])).toEqual([
      [1, null],
      [2, { credits: 1000, xp: 100 }],
      [2, null],
    ]);
    expect(service.statuses()[0]).toMatchObject({ progress: 2, completed: true });
  });

  it('starts every run afresh', () => {
    const { bus, clock, service, progressed } = setup();
    deliver(bus);
    deliver(bus);

    clock.nowMs = DURING + 14 * DAY_MS;
    expect(service.statuses()[0]).toMatchObject({ progress: 0, completed: false });
    deliver(bus);

    expect(progressed.at(-1)).toMatchObject({ progress: 1, reward: null });
  });

  it('adds up credits for an objective counted in credits, and leaves out companies below its level', () => {
    const heavy = eventFixture({
      id: 'heavy_event',
      requiredCompanyLevel: 2,
      qualifyingDelivery: { minCargoWeightTons: 8 },
      objective: { kind: 'credits', target: 5000 },
      payBonus: 0.5,
    });
    const { bus, company, service, progressed } = setup([heavy]);

    deliver(bus, { missionId: 'heavy_mission' });
    expect(progressed).toEqual([]);
    expect(service.statuses()[0]!.locked).toBe(true);
    expect(service.eventsForContract('heavy_mission')).toEqual([]);

    company.award(DEFAULT_GAME_CONFIG.company.levelXp[1]!); // Level 2.
    deliver(bus, { missionId: 'heavy_mission' });
    deliver(bus, { missionId: 'test_mission' }); // 5 t: too light.

    // 2000 paid and 1000 bonus toward the 5000.
    expect(progressed).toEqual([{ eventId: 'heavy_event', bonus: 1000, progress: 3000, target: 5000, reward: null }]);
    expect(service.eventsForContract('heavy_mission').map((event) => event.id)).toEqual(['heavy_event']);
    expect(service.eventsForContract('test_mission')).toEqual([]);
  });

  it('marks no contract for events that only care how the delivery goes', () => {
    const { service } = setup();

    expect(service.eventsForContract('test_mission')).toEqual([]);
  });

  it('saves the progress of each event\'s latest run, and takes it back', () => {
    const first = setup();
    deliver(first.bus);
    const saved = first.service.snapshot();

    const second = setup();
    second.service.restore(saved);
    deliver(second.bus);

    expect(saved).toEqual([{ eventId: 'test_event', edition: 19, progress: 1, rewarded: false }]);
    expect(second.progressed.at(-1)).toMatchObject({ progress: 2, reward: { credits: 1000, xp: 100 } });
    second.service.restore([]);
    expect(second.service.statuses()[0]!.progress).toBe(0);
  });

  it('stops counting when disposed', () => {
    const { bus, service, progressed } = setup();

    service.dispose();
    deliver(bus);

    expect(progressed).toEqual([]);
  });
});
