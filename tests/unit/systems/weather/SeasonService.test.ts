import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { SeasonService } from '../../../../src/systems/weather/SeasonService';
import { MemoryLogger } from '../../../support/MemoryLogger';

const DAY_MS = 24 * 3600 * 1000;

function setup(date: string) {
  let now = Date.parse(`${date}T12:00:00Z`);
  const events = new EventBus<GameEvents>(new MemoryLogger());
  const changes: GameEvents['SeasonChanged'][] = [];
  events.on('SeasonChanged', (event) => changes.push(event));
  const seasons = new SeasonService({ now: () => now }, events);
  return { seasons, changes, advanceDays: (days: number) => (now += days * DAY_MS) };
}

describe('SeasonService', () => {
  it('follows the calendar, and says when the season turns over', () => {
    const { seasons, changes, advanceDays } = setup('2026-11-29');
    expect(seasons.season).toBe('autumn');
    expect(seasons.held).toBeNull();
    expect(seasons.groundSnow).toBe(0);

    advanceDays(3);
    // It looks at the calendar every few seconds, not every step.
    seasons.update(1);
    expect(seasons.season).toBe('autumn');
    seasons.update(10);
    expect(seasons.season).toBe('winter');
    expect(seasons.groundSnow).toBeGreaterThan(0.3);
    expect(changes).toEqual([{ season: 'winter', previous: 'autumn' }]);
  });

  it('holds the season the player picks, whatever the calendar says, and lets it go', () => {
    const { seasons, changes, advanceDays } = setup('2026-07-10');

    seasons.hold('winter');
    expect(seasons.season).toBe('winter');
    expect(seasons.held).toBe('winter');
    advanceDays(90);
    seasons.update(20);
    expect(seasons.season).toBe('winter');

    seasons.hold(null);
    expect(seasons.season).toBe('autumn');
    // Holding the season it already is changes nothing.
    seasons.hold('autumn');
    expect(changes).toEqual([
      { season: 'winter', previous: 'summer' },
      { season: 'autumn', previous: 'winter' },
    ]);
  });
});
