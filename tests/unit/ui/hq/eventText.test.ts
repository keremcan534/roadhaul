import { describe, expect, it } from 'vitest';
import type { EventStatus } from '../../../../src/systems/events/EventService';
import { conditionText, objectiveText, rewardText, sortEvents } from '../../../../src/ui/hq/eventText';
import { stringsFor } from '../../../../src/ui/i18n';

const en = stringsFor('en');
const tr = stringsFor('tr');

function status(id: string, state: 'running' | 'locked' | 'upcoming' | 'over', remainingMs: number): EventStatus {
  return {
    definition: { id },
    run: state === 'over' ? null : { edition: 0, startMs: 0, endMs: 1 },
    running: state === 'running' || state === 'locked',
    locked: state === 'locked',
    remainingMs,
  } as unknown as EventStatus;
}

describe('event text', () => {
  it('puts the events the company can play first, soonest to end, then the rest', () => {
    const statuses = [
      status('over', 'over', 0),
      status('later', 'upcoming', 5000),
      status('locked', 'locked', 100),
      status('long', 'running', 900),
      status('soon', 'upcoming', 2000),
      status('short', 'running', 300),
    ];

    expect(sortEvents(statuses).map((event) => event.definition.id)).toEqual([
      'short',
      'long',
      'locked',
      'soon',
      'later',
      'over',
    ]);
  });

  it('spells out which deliveries count, in either language', () => {
    expect(conditionText(en, { minTimeLeft: 0.25 })).toBe('Deliver with 25% of the time to spare');
    expect(conditionText(en, { minTimeLeft: 0, maxCargoDamage: 0 })).toBe(
      'Deliver on time · Deliver the cargo without a scratch',
    );
    expect(conditionText(tr, { maxCargoDamage: 0.1, minCargoWeightTons: 8 })).toBe('Yük hasarı en fazla %10 · 8 t ve üzeri yükler');
    expect(conditionText(en, { cargoCategories: ['food', 'frozenFood'] })).toBe('Cargo: Food, Frozen food');
    expect(conditionText(en, {})).toBe('Every delivery counts');
  });

  it('counts deliveries or credits toward the objective, and names the reward', () => {
    expect(objectiveText(en, { kind: 'deliveries', target: 3 }, 1)).toBe('1 / 3 deliveries');
    expect(objectiveText(tr, { kind: 'credits', target: 15000 }, 4200)).toBe('4.200 / 15.000 kredi kazanıldı');
    expect(rewardText(en, { credits: 3000, xp: 300 })).toBe('Reward: 3,000 credits and 300 XP');
  });
});
