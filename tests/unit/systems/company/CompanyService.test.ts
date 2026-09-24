import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { calculateMissionReward } from '../../../../src/domain/missions/missionReward';
import { CompanyService } from '../../../../src/systems/company/CompanyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { missionFixture } from '../../../support/contentFixtures';
import { MemoryLogger } from '../../../support/MemoryLogger';

const mission = missionFixture({ id: 'm' });
const reward = calculateMissionReward({
  baseReward: 1000,
  cargoRewardMultiplier: 1,
  timeSensitivity: 0.5,
  timeLimitSeconds: 120,
  deliverySeconds: 60,
  cargoDamage: 0,
  damageTolerance: 0.3,
});

function setup() {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const company = new CompanyService(events, { levelXp: [0, 1000, 3000, 6500, 12000] }, logger);
  company.restore(
    { companyName: 'Kuzey Lojistik' },
    { level: 1, xp: 900, reputation: 4 },
    { deliveriesCompleted: 2, deliveriesFailed: 0, creditsEarned: 2500, distanceDrivenMeters: 0 },
  );
  const levelUps: number[] = [];
  events.on('CompanyLevelUp', ({ level }) => levelUps.push(level));
  return { events, company, levelUps };
}

function deliver(events: EventBus<GameEvents>, xp: number, reputation: number): void {
  events.emit('MissionCompleted', { missionId: 'm', mission, reward, deliverySeconds: 60, cargoDamage: 0, xp, reputation });
}

describe('CompanyService', () => {
  it('restores name, XP, level, reputation and statistics', () => {
    const { company } = setup();

    expect(company.companyName).toBe('Kuzey Lojistik');
    expect(company.level).toBe(1);
    expect(company.levelProgress).toEqual({ level: 1, xpIntoLevel: 900, xpForLevel: 1000, fraction: 0.9 });
    expect(company.reputation).toBe(4);
    expect(company.stats).toEqual({ deliveriesCompleted: 2, deliveriesFailed: 0, creditsEarned: 2500 });
    expect(company.maxLevel).toBe(5);
  });

  it('adds XP and reputation for a delivery and announces a level-up (spec §14)', () => {
    const { events, company, levelUps } = setup();
    const progressed: GameEvents['CompanyProgressed'][] = [];
    events.on('CompanyProgressed', (event) => progressed.push(event));

    deliver(events, 150, 8);

    expect(company.xp).toBe(1050);
    expect(company.level).toBe(2);
    expect(company.reputation).toBe(12);
    expect(company.stats.deliveriesCompleted).toBe(3);
    expect(company.stats.creditsEarned).toBe(2500 + reward.total);
    expect(progressed).toEqual([{ xp: 1050, level: 2, reputation: 12 }]);
    expect(levelUps).toEqual([2]);
  });

  it('only levels up once per level', () => {
    const { events, levelUps } = setup();

    deliver(events, 150, 1);
    deliver(events, 150, 1);

    expect(levelUps).toEqual([2]);
  });

  it('loses reputation on a failed contract, never below zero', () => {
    const { events, company } = setup();

    events.emit('MissionFailed', { missionId: 'm', mission, reason: 'cargoDamaged', reputationLost: 6 });

    expect(company.reputation).toBe(0);
    expect(company.stats.deliveriesFailed).toBe(1);
    expect(company.xp).toBe(900);
  });

  it('stops listening when disposed', () => {
    const { events, company } = setup();

    company.dispose();

    expect(events.listenerCount('MissionCompleted')).toBe(0);
    expect(events.listenerCount('MissionFailed')).toBe(0);
  });
});
