import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import type { MissionReward } from '../../../../src/domain/missions/missionReward';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { TutorialService } from '../../../../src/systems/tutorial/TutorialService';
import { missionFixture } from '../../../support/contentFixtures';
import { MemoryLogger } from '../../../support/MemoryLogger';

function setup() {
  const logger = new MemoryLogger();
  const bus = new EventBus<GameEvents>(logger);
  const tutorial = new TutorialService(bus, logger);
  const changes: GameEvents['TutorialStepChanged'][] = [];
  bus.on('TutorialStepChanged', (change) => changes.push(change));
  tutorial.restore('takeContract');
  return { bus, tutorial, changes };
}

const REWARD = { basePay: 900, timeBonus: 0, latePenalty: 0, conditionBonus: 0, total: 900, onTime: true, lateSeconds: 0 };

function playContract(bus: EventBus<GameEvents>): void {
  const missionId = 'first_package';
  bus.emit('MissionStateChanged', { missionId, previous: null, current: 'accepted' });
  bus.emit('MissionStateChanged', { missionId, previous: 'accepted', current: 'travellingToPickup' });
  bus.emit('MissionStateChanged', { missionId, previous: 'travellingToPickup', current: 'loaded' });
  bus.emit('MissionStateChanged', { missionId, previous: 'loaded', current: 'delivering' });
  bus.emit('MissionCompleted', {
    missionId,
    mission: missionFixture({ id: missionId }),
    reward: REWARD as MissionReward,
    deliverySeconds: 100,
    cargoDamage: 0,
    xp: 100,
    reputation: 10,
  });
}

describe('TutorialService', () => {
  it('follows the first contract and the first upgrade through the game\'s events', () => {
    const { bus, tutorial, changes } = setup();

    playContract(bus);
    expect(tutorial.step).toBe('buyUpgrade');
    bus.emit('UpgradePurchased', { instanceId: 'truck_001', upgradeId: 'engine', level: 1, cost: 3000 });

    expect(tutorial.isActive).toBe(false);
    expect(changes.map(({ step }) => step)).toEqual(['driveToPickup', 'deliver', 'buyUpgrade', 'done']);
  });

  it('can be skipped, once', () => {
    const { tutorial, changes } = setup();

    tutorial.skip();
    tutorial.skip();

    expect(tutorial.step).toBe('done');
    expect(changes).toEqual([{ step: 'done', previous: 'takeContract' }]);
  });

  it('stays quiet for a company that has done it, and once disposed', () => {
    const { bus, tutorial, changes } = setup();
    tutorial.restore('done');
    playContract(bus);
    expect(changes).toEqual([]);

    tutorial.restore('takeContract');
    tutorial.dispose();
    playContract(bus);
    expect(tutorial.step).toBe('takeContract');
  });
});
