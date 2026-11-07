import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import type { ProductId } from '../../../../src/data/config/products';
import { PAINTS } from '../../../../src/data/content/paints';
import type { CrateTier } from '../../../../src/data/definitions/CrateTier';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { GAME_CONTENT } from '../../../../src/data/content';
import { CompanyPerks } from '../../../../src/systems/company/CompanyPerks';
import { EconomyService } from '../../../../src/systems/economy/EconomyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { RoadPassService } from '../../../../src/systems/rewards/RoadPassService';
import { MemoryLogger } from '../../../support/MemoryLogger';
import { deliver, newCompany } from '../../../support/game';

const PASS = DEFAULT_GAME_CONFIG.roadPass;
const DAY_MS = 86_400_000;
/** The first season's first day, at noon. */
const SEASON_START_MS = PASS.firstSeasonDay * DAY_MS + DAY_MS / 2;

/** A pass on its own: a clock that can be moved, Plus owned or not, what it gives counted. */
async function pass() {
  let now = SEASON_START_MS;
  let plus = false;
  const events = new EventBus<GameEvents>(new MemoryLogger());
  const economy = new EconomyService(events, DEFAULT_GAME_CONFIG.economy, new MemoryLogger(), new CompanyPerks());
  const crates: CrateTier[] = [];
  const supplies: (string | number)[] = [];
  const content = ContentCatalog.create(GAME_CONTENT);
  const service = new RoadPassService(
    content,
    economy,
    { grant: (tier) => crates.push(tier) },
    { add: (parts, booster) => supplies.push(booster ?? parts) },
    { owns: (id: ProductId) => plus && id === 'road_pass' },
    { now: () => now },
    0,
    PASS,
    events,
    new MemoryLogger(),
  );
  service.update();
  const delivered = (total: number) => events.emit('MissionCompleted', { reward: { total } } as unknown as GameEvents['MissionCompleted']);
  return { service, events, economy, crates, supplies, delivered, setNow: (ms: number) => (now = ms), setPlus: (owned: boolean) => (plus = owned) };
}

describe('RoadPassService', () => {
  it('climbs the tiers with the company\'s deliveries, by their pay, and the quests done', async () => {
    const game = await newCompany(1, 5000);
    let total = 0;
    game.events.on('MissionCompleted', ({ reward }) => (total = reward.total));
    game.roadPass.update();
    deliver(game, 'first_package');
    expect(game.roadPass.seasonPoints).toBe(Math.max(PASS.leastDeliveryPoints, Math.round(total / PASS.creditsPerPoint)));

    const { service, events, delivered } = await pass();
    const reached: number[] = [];
    events.on('RoadPassTierReached', ({ tier }) => reached.push(tier));
    delivered(PASS.pointsPerTier * PASS.creditsPerPoint - 100);
    expect(service.tierReached).toBe(0);
    events.emit('QuestCompleted', {} as GameEvents['QuestCompleted']);
    expect(service.seasonPoints).toBe(PASS.pointsPerTier - 1 + PASS.questPoints);
    expect(service.tierReached).toBe(1);
    expect(reached).toEqual([1]);
  });

  it('gives each tier\'s free reward once, when reached', async () => {
    const { service, economy, crates, supplies, delivered } = await pass();
    expect(service.claimFree(1)).toEqual({ ok: false, error: 'notReached' });
    delivered(PASS.pointsPerTier * PASS.creditsPerPoint * 20); // Every tier.
    const credits = economy.credits;

    for (let tier = 1; tier <= PASS.freeRewards.length; tier++) {
      expect(service.claimFree(tier)).toEqual({ ok: true, value: PASS.freeRewards[tier - 1] });
    }
    expect(service.claimFree(1)).toEqual({ ok: false, error: 'claimed' });
    expect(service.claimFree(99)).toEqual({ ok: false, error: 'unknownTier' });
    const paid = PASS.freeRewards.reduce((sum, reward) => sum + (reward.kind === 'credits' ? reward.amount : 0), 0);
    expect(economy.credits).toBe(credits + paid);
    expect(crates).toEqual(PASS.freeRewards.filter((reward) => reward.kind === 'crate').map((reward) => (reward.kind === 'crate' ? reward.tier : null)));
    expect(supplies).toHaveLength(PASS.freeRewards.filter((reward) => reward.kind === 'parts' || reward.kind === 'booster').length);
    expect(service.claimable).toBe(0);
  });

  it('gives the season\'s colours on Plus\'s tiers only with Road Pass Plus, and they stay the company\'s', async () => {
    const { service, delivered, setPlus, setNow } = await pass();
    delivered(PASS.pointsPerTier * PASS.creditsPerPoint * 4);
    const tier = PASS.premiumTiers[0]!;
    const colour = service.tiers()[tier - 1]!.premium!;
    expect(colour.pass).toBe(0); // The first season's group.
    expect(service.claimPremium(tier)).toEqual({ ok: false, error: 'noPass' });
    expect(service.claimPremium(1)).toEqual({ ok: false, error: 'noReward' });
    expect(service.claimable).toBe(4); // The free tiers: Plus's wait for Plus.

    setPlus(true);
    expect(service.claimable).toBe(5);
    expect(service.claimPremium(tier)).toEqual({ ok: true, value: colour });
    expect(service.ownsPassPaint(colour.id)).toBe(true);
    expect(service.claimPremium(PASS.premiumTiers[1]!)).toEqual({ ok: false, error: 'notReached' });

    // The next season: the other group's colours, the points and tiers anew, the colour kept.
    setNow(SEASON_START_MS + PASS.seasonDays * DAY_MS);
    service.update();
    expect(service.currentSeason).toBe(1);
    expect(service.seasonPoints).toBe(0);
    expect(service.tiers()[tier - 1]!.premium!.pass).toBe(1);
    expect(service.ownsPassPaint(colour.id)).toBe(true);
  });

  it('ends each season after its days', async () => {
    const { service, setNow } = await pass();
    expect(service.endsInMs).toBe(PASS.seasonDays * DAY_MS - DAY_MS / 2);
    setNow(SEASON_START_MS + (PASS.seasonDays - 1) * DAY_MS);
    expect(service.endsInMs).toBe(DAY_MS / 2);
  });

  it('keeps the season\'s points, the tiers collected and the colours in the save', async () => {
    const first = await pass();
    first.setPlus(true);
    first.delivered(PASS.pointsPerTier * PASS.creditsPerPoint * 5);
    first.service.claimFree(2);
    first.service.claimPremium(4);
    const saved = first.service.snapshot();
    expect(saved).toEqual({ season: 0, points: 300, freeClaimed: [2], premiumClaimed: [4], paints: [first.service.tiers()[3]!.premium!.id] });

    const second = await pass();
    second.service.restore({ ...saved, paints: [...saved.paints, 'no_such_colour', 'signal_red'] });
    expect(second.service.snapshot()).toEqual(saved);
  });

  it('locks the pass colours in the garage until collected', async () => {
    const game = await newCompany(1, 5000);
    const colour = PAINTS.find((paint) => paint.pass !== undefined)!;
    const offer = () => game.garage.paintShop().find((candidate) => candidate.paint.id === colour.id)!;
    expect(offer()).toMatchObject({ pass: true, locked: true });
    expect(game.garage.paint('truck_001', colour.id)).toEqual({ ok: false, error: 'locked' });

    game.roadPass.restore({ season: null, points: 0, freeClaimed: [], premiumClaimed: [], paints: [colour.id] });
    expect(offer().locked).toBe(false);
    expect(game.garage.paint('truck_001', colour.id).ok).toBe(true);
  });
});
