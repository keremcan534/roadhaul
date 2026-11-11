import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { QuestService } from '../../../../src/systems/rewards/QuestService';
import { contentFixture } from '../../../support/contentFixtures';
import { MemoryLogger } from '../../../support/MemoryLogger';

const DAY_MS = 86_400_000;

/** The fixture's three quests (deliver 2, drive 5 km, earn 1000), all three each day; the clock at noon of day 20 000. */
function setup() {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const content = ContentCatalog.create(contentFixture());
  let nowMs = 20_000 * DAY_MS + DAY_MS / 2;
  let driven: number | null = 10_000;
  const granted: string[] = [];
  const quests = new QuestService(
    content,
    { grant: (tier) => void granted.push(tier) },
    'gold',
    { now: () => nowMs },
    0,
    () => driven,
    events,
    logger,
  );
  quests.restore({ day: null, counts: {}, distanceStartMeters: 0, claimed: [], bonusClaimed: false });
  const done: string[] = [];
  events.on('QuestCompleted', ({ questId }) => done.push(questId));
  const deliver = (total: number, onTime = true): void =>
    events.emit('MissionCompleted', { reward: { total, onTime }, cargoDamage: 0, xp: 10 } as unknown as GameEvents['MissionCompleted']);
  return {
    quests,
    events,
    granted,
    done,
    deliver,
    drive: (meters: number) => {
      driven = (driven ?? 0) + meters;
    },
    unload: () => {
      driven = null;
    },
    tomorrow: () => {
      nowMs += DAY_MS;
    },
  };
}

const progressOf = (quests: QuestService): Record<string, number> =>
  Object.fromEntries(quests.quests.map((quest) => [quest.definition.id, quest.progress]));

describe('QuestService', () => {
  it('counts the day\'s quests from its start, announces each once as done, and gives its crate once collected', () => {
    const { quests, events, granted, done, deliver, drive } = setup();
    expect(progressOf(quests)).toEqual({ test_deliver: 0, test_drive: 0, test_earn: 0 });
    deliver(600);
    drive(2_500);
    expect(progressOf(quests)).toEqual({ test_deliver: 1, test_drive: 2, test_earn: 600 });
    deliver(600);
    expect(done).toEqual(['test_deliver', 'test_earn']);
    expect(quests.claimable).toBe(2);
    // The kilometres are checked as the player leaves the road.
    drive(3_000);
    events.emit('GameStateChanged', { previous: 'driving', current: 'mainMenu' });
    events.emit('GameStateChanged', { previous: 'mainMenu', current: 'driving' });
    expect(done).toEqual(['test_deliver', 'test_earn', 'test_drive']);

    expect(quests.claim('test_deliver')).toEqual({ ok: true, value: 'bronze' });
    expect(quests.claim('test_deliver')).toEqual({ ok: false, error: 'claimed' });
    expect(quests.claim('retired')).toEqual({ ok: false, error: 'unknownQuest' });
    expect(quests.claimBonus()).toEqual({ ok: false, error: 'notDone' });
    quests.claim('test_drive');
    quests.claim('test_earn');
    expect(quests.claimable).toBe(1);
    expect(quests.claimBonus()).toEqual({ ok: true, value: 'gold' });
    expect(quests.claimBonus()).toEqual({ ok: false, error: 'claimed' });
    expect(granted).toEqual(['bronze', 'silver', 'bronze', 'gold']);
  });

  it('does not count a quest unfinished: its crate waits until it is done', () => {
    const { quests, deliver } = setup();
    deliver(100);
    expect(quests.claim('test_deliver')).toEqual({ ok: false, error: 'notDone' });
  });

  it('starts the quests over each new day', () => {
    const { quests, deliver, drive, tomorrow } = setup();
    deliver(2000);
    drive(9_000);
    tomorrow();
    expect(progressOf(quests)).toEqual({ test_deliver: 0, test_drive: 0, test_earn: 0 });
  });

  it('saves the day\'s counts and takes them back, without announcing again what was done', () => {
    const first = setup();
    first.deliver(1200);
    first.quests.claim('test_earn');
    const saved = first.quests.snapshot();
    expect(saved).toMatchObject({ day: 20_000, counts: { deliveries: 1, creditsEarned: 1200 }, claimed: ['test_earn'] });

    const second = setup();
    second.quests.restore({ ...saved, claimed: [...saved.claimed, 'retired_quest'] });
    expect(progressOf(second.quests)).toMatchObject({ test_deliver: 1, test_earn: 1000 });
    expect(second.quests.quests.find((quest) => quest.definition.id === 'test_earn')?.claimed).toBe(true);
    second.deliver(10);
    expect(second.done).toEqual(['test_deliver']);
  });

  it('counts the kilometres from when a company is loaded, if the day began before', () => {
    const { quests, drive, unload } = setup();
    unload();
    quests.restore({ day: null, counts: {}, distanceStartMeters: 0, claimed: [], bonusClaimed: false });
    expect(progressOf(quests)['test_drive']).toBe(0);
    drive(50_000);
    expect(progressOf(quests)['test_drive']).toBe(0);
    drive(5_000);
    expect(progressOf(quests)['test_drive']).toBe(5);
  });
});
