import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { RIVALS } from '../../../../src/data/content/rivals';
import { PLAYER_COMPANY_ID } from '../../../../src/data/definitions/RivalCompanyDefinition';
import type { CrateTier } from '../../../../src/data/definitions/CrateTier';
import { CompanyPerks } from '../../../../src/systems/company/CompanyPerks';
import { EconomyService } from '../../../../src/systems/economy/EconomyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { WeeklyCupService } from '../../../../src/systems/rivals/WeeklyCupService';
import { MemoryLogger } from '../../../support/MemoryLogger';
import { deliver, newCompany } from '../../../support/game';

const CUP = DEFAULT_GAME_CONFIG.weeklyCup;
const DAY_MS = 86_400_000;
/** Monday 2 November 2026, 00:00 UTC. */
const MONDAY_MS = Date.UTC(2026, 10, 2);

/** A cup on its own: a clock that can be moved, rivals of `trucks` trucks each, crates counted. */
function cup(trucks = 3) {
  let now = MONDAY_MS + DAY_MS / 2;
  const events = new EventBus<GameEvents>(new MemoryLogger());
  const economy = new EconomyService(events, DEFAULT_GAME_CONFIG.economy, new MemoryLogger(), new CompanyPerks());
  const crates: CrateTier[] = [];
  const rivals = RIVALS.map((definition) => ({ definition, trucks, acquired: false }));
  const service = new WeeklyCupService(
    { statuses: () => rivals },
    economy,
    { grant: (tier) => crates.push(tier) },
    { now: () => now },
    0,
    CUP,
    events,
    new MemoryLogger(),
  );
  service.update();
  const delivered = (total: number) =>
    events.emit('MissionCompleted', { reward: { total } } as unknown as GameEvents['MissionCompleted']);
  return { service, events, economy, crates, rivals, delivered, setNow: (ms: number) => (now = ms) };
}

describe('WeeklyCupService', () => {
  it('scores the company\'s own deliveries by their pay, at least a few points each, and its drivers\' by their profit', async () => {
    const game = await newCompany(1, 5000);
    let total = 0;
    game.events.on('MissionCompleted', ({ reward }) => (total = reward.total));
    game.weeklyCup.update();

    deliver(game, 'first_package');
    expect(game.weeklyCup.playerPoints).toBe(Math.max(CUP.leastDeliveryPoints, Math.round(total / CUP.creditsPerPoint)));

    const { service, delivered, events } = cup();
    delivered(120);
    expect(service.playerPoints).toBe(CUP.leastDeliveryPoints);
    events.emit('FleetJobCompleted', { profit: 2000 } as unknown as GameEvents['FleetJobCompleted']);
    expect(service.playerPoints).toBe(CUP.leastDeliveryPoints + 2000 / CUP.fleetCreditsPerPoint);
  });

  it('lets the rivals earn theirs through the week by their size and manner, the bought-out ones out of it', () => {
    const { service, rivals, setNow } = cup(4);
    const noon = service.standings();
    setNow(MONDAY_MS + 3.5 * DAY_MS);
    const midweek = service.standings();
    expect(midweek).toHaveLength(RIVALS.length + 1);
    for (const rival of RIVALS) {
      const early = noon.find((entry) => entry.companyId === rival.id)!.points;
      const later = midweek.find((entry) => entry.companyId === rival.id)!.points;
      expect(later).toBeGreaterThan(early);
      // Half the week gone: about half its week's points, its luck and manner within their bounds.
      const most = (4 * CUP.rivalPointsPerTruck * CUP.mannerFactors[rival.personality] * CUP.rivalLuck[1]) / 2;
      const least = (4 * CUP.rivalPointsPerTruck * CUP.mannerFactors[rival.personality] * CUP.rivalLuck[0]) / 2;
      expect(later).toBeGreaterThanOrEqual(Math.floor(least) - 1);
      expect(later).toBeLessThanOrEqual(Math.ceil(most));
    }
    // The most points first.
    expect(midweek.map((entry) => entry.points)).toEqual([...midweek.map((entry) => entry.points)].sort((a, b) => b - a));

    rivals[0]!.acquired = true;
    expect(service.standings().some((entry) => entry.companyId === RIVALS[0]!.id)).toBe(false);
  });

  it('pays the week\'s top three when the next week starts, and starts the points again', () => {
    const { service, economy, crates, events, delivered, setNow } = cup(1);
    const ended: GameEvents['WeeklyCupEnded'][] = [];
    events.on('WeeklyCupEnded', (result) => ended.push(result));
    // Far ahead of rivals with one truck each.
    for (let i = 0; i < 20; i++) {
      delivered(5000);
    }
    expect(service.standings()[0]!.companyId).toBe(PLAYER_COMPANY_ID);
    const paid = economy.credits; // The deliveries' pay (the economy hears them too).

    setNow(MONDAY_MS + 7 * DAY_MS + 60_000);
    service.update();

    const first = CUP.rewards[0]!;
    expect(ended).toEqual([{ week: service.currentWeek - 1, rank: 1, credits: first.credits, crate: first.crate }]);
    expect(economy.credits).toBe(paid + first.credits);
    expect(crates).toEqual([first.crate]);
    expect(service.lastResult).toEqual(ended[0]);
    expect(service.playerPoints).toBe(0);
    service.update();
    expect(ended).toHaveLength(1);
  });

  it('pays nothing below third, nor for a week with no points', () => {
    const { service, economy, events, delivered, setNow } = cup(6);
    const ended: GameEvents['WeeklyCupEnded'][] = [];
    events.on('WeeklyCupEnded', (result) => ended.push(result));
    setNow(MONDAY_MS + 7 * DAY_MS + 1);
    service.update();
    expect(ended).toEqual([]);

    delivered(100); // A few points against rivals with six trucks each.
    const paid = economy.credits;
    setNow(MONDAY_MS + 14 * DAY_MS + 1);
    service.update();
    expect(ended[0]!.rank).toBe(RIVALS.length + 1);
    expect(ended[0]!.credits).toBe(0);
    expect(economy.credits).toBe(paid);
  });

  it('ends each cup at Monday midnight on the player\'s calendar', () => {
    const { service, setNow } = cup();
    setNow(MONDAY_MS + 6 * DAY_MS);
    expect(service.endsInMs).toBe(DAY_MS);
    setNow(MONDAY_MS + 7 * DAY_MS);
    expect(service.endsInMs).toBe(7 * DAY_MS);
  });

  it('keeps the week\'s points and the last result in the save', () => {
    const first = cup();
    first.delivered(900);
    const saved = first.service.snapshot();
    expect(saved).toEqual({ week: first.service.currentWeek, points: 9, last: null });

    const second = cup();
    second.service.restore(saved);
    expect(second.service.playerPoints).toBe(9);
  });
});
