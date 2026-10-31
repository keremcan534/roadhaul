import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { MemoryStorage } from '../../../../src/core/storage/KeyValueStorage';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { ReviewService } from '../../../../src/systems/review/ReviewService';
import { MemoryLogger } from '../../../support/MemoryLogger';

const RULES = { firstAfterDeliveries: 2, maxCargoDamage: 0.1, daysBetween: 60, maxAsks: 3 };

function setup(storage = new MemoryStorage()) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const nowMs = 1_000_000;
  const review = new ReviewService(RULES, { now: () => nowMs }, storage, events, logger);
  let requests = 0;
  review.attach({ enabled: true, request: () => Promise.resolve(void (requests += 1)) });
  const deliver = (cargoDamage: number): void =>
    events.emit('MissionCompleted', { cargoDamage } as unknown as GameEvents['MissionCompleted']);
  return { review, deliver, storage, requests: () => requests };
}

describe('ReviewService', () => {
  it('asks once enough deliveries arrived in good order, and not again right after', async () => {
    const { review, deliver, requests } = setup();
    deliver(0);
    await review.askIfDue();
    expect(requests()).toBe(0);
    deliver(0.5);
    deliver(0.05);
    await review.askIfDue();
    expect(requests()).toBe(1);
    deliver(0);
    deliver(0);
    await review.askIfDue();
    expect(requests()).toBe(1);
  });

  it('remembers on the phone across starts', async () => {
    const storage = new MemoryStorage();
    const first = setup(storage);
    first.deliver(0);
    first.deliver(0);
    await first.review.askIfDue();
    expect(first.requests()).toBe(1);

    const second = setup(storage);
    second.deliver(0);
    second.deliver(0);
    await second.review.askIfDue();
    expect(second.requests()).toBe(0);
  });

  it('asks nothing where there is no store', async () => {
    const logger = new MemoryLogger();
    const events = new EventBus<GameEvents>(logger);
    const review = new ReviewService(RULES, { now: () => 0 }, new MemoryStorage(), events, logger);
    events.emit('MissionCompleted', { cargoDamage: 0 } as unknown as GameEvents['MissionCompleted']);
    events.emit('MissionCompleted', { cargoDamage: 0 } as unknown as GameEvents['MissionCompleted']);
    await expect(review.askIfDue()).resolves.toBeUndefined();
  });
});
