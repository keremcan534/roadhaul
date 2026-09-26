import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../../src/core/storage/KeyValueStorage';
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../../../../src/data/config/GameConfig';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { STEP_SECONDS } from '../../../support/driving';
import { bootGame, deliver, newCompany, parkInTargetBay, play, reachLevel, type Game } from '../../../support/game';

const RIVALS = DEFAULT_GAME_CONFIG.rivals;

function listen<K extends keyof GameEvents>(game: Game, name: K): GameEvents[K][] {
  const heard: GameEvents[K][] = [];
  game.events.on(name, (event) => heard.push(event));
  return heard;
}

/** Runs the rivals alone for `seconds` of game time, a second at a time. */
function runRivals(game: Game, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 1) {
    game.rivals.update(1);
  }
}

/** A new company with `credits`, in a game whose rivals start with `startingHomePoints` at home. */
async function companyWith(credits: number, rivals: Partial<GameConfig['rivals']> = {}): Promise<Game> {
  const config = { ...DEFAULT_GAME_CONFIG, rivals: { ...RIVALS, ...rivals } };
  const game = await bootGame(new MemoryStorage(), 1_000, config);
  game.session.startNewGame('Kuzey Lojistik');
  reachLevel(game, 1);
  game.economy.restore(credits);
  return game;
}

/** Each company's points in `cityId`. */
function standingIn(game: Game, cityId: string): Record<string, number> {
  return Object.fromEntries(
    game.rivals
      .snapshot()
      .standing.filter((entry) => entry.cityId === cityId)
      .map((entry) => [entry.companyId, entry.points]),
  );
}

describe('RivalService', () => {
  it('stands still until a game is loaded: behind the main menu nothing moves, and no tender comes', async () => {
    const game = await bootGame();
    const posted = listen(game, 'TenderPosted');
    runRivals(game, RIVALS.firstTenderSeconds + 60);
    game.rivals.catchUp(3600);
    expect(posted).toEqual([]);
    expect(game.rivals.snapshot().jobsPlanned).toBe(0);
    expect(game.rivals.updateMarkers()).toBe(0);
    expect(game.rivals.definitions.map((rival) => rival.id)).toEqual(['rival_yeniliman', 'rival_basakova', 'rival_demirkent']);
  });

  it('starts each rival at home with its trucks and money, leading its city, and the company last in the league', async () => {
    const game = await newCompany(1, 5000);

    expect(game.rivals.statuses().map((rival) => [rival.definition.id, rival.trucks, rival.credits, rival.cities, rival.acquired])).toEqual([
      ['rival_yeniliman', 2, 3000, 1, false],
      ['rival_basakova', 2, 4000, 1, false],
      ['rival_demirkent', 2, 6000, 1, false],
    ]);
    expect(['city_a', 'city_b', 'city_c'].map((cityId) => game.rivals.leaderOf(cityId))).toEqual([
      'rival_yeniliman',
      'rival_demirkent',
      'rival_basakova',
    ]);
    expect(game.rivals.league().map((entry) => [entry.companyId, entry.value, entry.trucks, entry.cities])).toEqual([
      ['rival_demirkent', 6000 + 2 * 38_000, 2, 1],
      ['rival_basakova', 4000 + 2 * 22_000, 2, 1],
      ['rival_yeniliman', 3000 + 2 * 12_000, 2, 1],
      ['player', 5000 + 12_000, 1, 0],
    ]);
    const yeniliman = game.rivals.cities().find((city) => city.cityId === 'city_a')!;
    expect(yeniliman).toEqual({
      cityId: 'city_a',
      shares: [
        { companyId: 'player', share: 0 },
        { companyId: 'rival_yeniliman', share: 1 },
        { companyId: 'rival_basakova', share: 0 },
        { companyId: 'rival_demirkent', share: 0 },
      ],
      leaderId: 'rival_yeniliman',
      campaignSecondsLeft: 0,
    });
    expect(game.rivals.colorOf('rival_basakova')).toBe(0x2f9e44);
    expect(game.rivals.colorOf('player')).toBeNull();
    // The first truck waits at home, the second at the next rival's: they do not set off together.
    expect(game.rivals.snapshot().companies.map((company) => company.trucks.map((truck) => truck.cityId))).toEqual([
      ['city_a', 'city_c'],
      ['city_c', 'city_b'],
      ['city_b', 'city_a'],
    ]);
  });

  it('runs the rivals\' trucks on contracts: they earn, win standing in the cities they serve, and grow', async () => {
    const game = await newCompany(1, 5000);
    const bought = listen(game, 'RivalTruckBought');
    runRivals(game, 60 * 60);

    const snapshot = game.rivals.snapshot();
    expect(snapshot.jobsPlanned).toBeGreaterThan(50);
    for (const rival of game.rivals.statuses()) {
      // Each serves more than its home city.
      const cities = snapshot.standing.filter((entry) => entry.companyId === rival.definition.id).map((entry) => entry.cityId);
      expect(new Set(cities).size, rival.definition.id).toBeGreaterThan(1);
    }
    expect(bought.length).toBeGreaterThan(0);
    expect(bought.every((event) => !event.away)).toBe(true);
    const grown = game.rivals.statuses().filter((rival) => rival.trucks > 2);
    expect(grown.map((rival) => rival.definition.id).sort()).toEqual([...new Set(bought.map((event) => event.rivalId))].sort());
    expect(game.rivals.news.some((item) => item.kind === 'truck')).toBe(true);
  });

  it('wins the company standing with its deliveries and its fleet\'s, where they start and end', async () => {
    const game = await newCompany(1, 5000);
    deliver(game, 'first_package'); // Havenport (city_a) to Ironford (city_b).
    expect(standingIn(game, 'city_a')['player']).toBeCloseTo(RIVALS.deliveryPoints, 0);
    expect(standingIn(game, 'city_b')['player']).toBeCloseTo(RIVALS.deliveryPoints, 0);
    expect(standingIn(game, 'city_c')['player']).toBeUndefined();

    game.events.emit('FleetJobCompleted', {
      driverId: 'driver_kemal',
      instanceId: 'truck_002',
      originCityId: 'city_c',
      destinationCityId: 'city_a',
      cargoId: 'farm_produce',
      pay: 1000,
      driverShare: 200,
      fuelCost: 100,
      profit: 700,
      incident: false,
      away: false,
    });
    expect(standingIn(game, 'city_c')['player']).toBeCloseTo(RIVALS.fleetJobPoints, 6);
    expect(standingIn(game, 'city_a')['player']).toBeCloseTo(RIVALS.deliveryPoints + RIVALS.fleetJobPoints, 0);
  });

  it('runs a campaign in a city for its price, once in a while there, and it can win the company the city', async () => {
    const game = await companyWith(15_000, { startingHomePoints: 10 });
    const leaders = listen(game, 'CityLeaderChanged');
    const campaigns = listen(game, 'CampaignRun');

    expect(game.rivals.runCampaign('city_a')).toEqual({ ok: true, value: undefined });
    expect(game.economy.credits).toBe(15_000 - RIVALS.campaignCost);
    expect(standingIn(game, 'city_a')['player']).toBe(RIVALS.campaignPoints);
    expect(campaigns).toEqual([{ companyId: 'player', cityId: 'city_a', away: false }]);
    // 40 points against Havenport's 10: the city is the company's.
    expect(leaders).toEqual([{ cityId: 'city_a', previousId: 'rival_yeniliman', leaderId: 'player', away: false }]);
    expect(game.rivals.leaderOf('city_a')).toBe('player');
    expect(game.rivals.league().find((entry) => entry.companyId === 'player')!.cities).toBe(1);

    expect(game.rivals.runCampaign('city_a')).toEqual({ ok: false, error: 'coolingDown' });
    expect(game.rivals.cities().find((city) => city.cityId === 'city_a')!.campaignSecondsLeft).toBe(RIVALS.campaignCooldownSeconds);
    expect(game.rivals.runCampaign('city_b')).toEqual({ ok: true, value: undefined });
    expect(game.rivals.runCampaign('city_c')).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(game.rivals.runCampaign('atlantis')).toEqual({ ok: false, error: 'unknownCity' });

    game.economy.restore(20_000);
    runRivals(game, RIVALS.campaignCooldownSeconds);
    expect(game.rivals.runCampaign('city_a')).toEqual({ ok: true, value: undefined });
  });

  it('pays the leader\'s bonus on top of a contract from a city the company leads', async () => {
    const game = await companyWith(20_000, { startingHomePoints: 10 });
    const bonuses = listen(game, 'LeaderBonusPaid');
    const completed = listen(game, 'MissionCompleted');
    deliver(game, 'first_package');
    expect(bonuses).toEqual([]); // Havenport still led the city.

    game.rivals.runCampaign('city_a');
    const before = game.economy.credits;
    deliver(game, 'first_package');
    const pay = completed[1]!.reward.total;
    const bonus = Math.round(pay * RIVALS.leaderBonus);
    expect(bonuses).toEqual([{ missionId: 'first_package', cityId: 'city_a', bonus }]);
    expect(game.economy.credits).toBe(before + pay + bonus);
  });

  it('puts a tender up on the job board, raced by a rival; delivered first, it pays the prize and wins standing', async () => {
    const game = await newCompany(1, 5000);
    const posted = listen(game, 'TenderPosted');
    runRivals(game, RIVALS.firstTenderSeconds - 1);
    expect(posted).toEqual([]);
    runRivals(game, 1);

    const tender = game.rivals.tender!;
    expect(posted).toEqual([{ missionId: tender.contract.id, rivalId: tender.rivalId, prize: tender.prize }]);
    const offer = game.missions.jobBoard().find((candidate) => candidate.mission.id === tender.contract.id)!;
    expect(offer).toMatchObject({ daily: true, blockedBy: null });
    expect(game.rivals.tenderFor(tender.contract.id)).toBe(tender);
    expect(game.rivals.raceStatus()).toBeNull();

    const decided = listen(game, 'TenderDecided');
    const completed = listen(game, 'MissionCompleted');
    const before = game.economy.credits;
    const { originCityId, destinationCityId } = tender.contract;
    const rivalBefore = standingIn(game, originCityId)[tender.rivalId] ?? 0;
    deliver(game, tender.contract.id);

    expect(decided).toEqual([{ missionId: tender.contract.id, rivalId: tender.rivalId, won: true, prize: tender.prize }]);
    expect(game.economy.credits).toBe(before + completed[0]!.reward.total + tender.prize);
    expect(standingIn(game, originCityId)['player']).toBeCloseTo(RIVALS.deliveryPoints + RIVALS.tenderPoints, 0);
    expect(standingIn(game, destinationCityId)['player']).toBeCloseTo(RIVALS.deliveryPoints + RIVALS.tenderPoints, 0);
    expect(standingIn(game, originCityId)[tender.rivalId] ?? 0).toBeLessThanOrEqual(rivalBefore + 2 * RIVALS.fleetJobPoints);
    // Taken, it left the board; the next comes in its time.
    expect(game.rivals.tender).toBeNull();
    expect(game.missions.jobBoard().some((candidate) => candidate.mission.id === tender.contract.id)).toBe(false);
    expect(game.rivals.news[0]).toMatchObject({ kind: 'tender', companyId: tender.rivalId, won: true });
  });

  it('races the rival from loading: once it has unloaded, the tender is lost, and the rival takes the prize and the standing', async () => {
    const game = await newCompany(1, 5000);
    runRivals(game, RIVALS.firstTenderSeconds);
    const tender = game.rivals.tender!;
    expect(game.missions.accept(tender.contract.id).ok).toBe(true);
    play(game, STEP_SECONDS);
    expect(game.rivals.raceStatus()).toMatchObject({ started: false, rivalProgress: 0, rivalSecondsLeft: tender.rivalSeconds });

    parkInTargetBay(game);
    play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
    expect(game.rivals.raceStatus()).toMatchObject({ started: true });
    const arrived = listen(game, 'TenderRivalArrived');
    play(game, tender.rivalSeconds / 2);
    expect(game.rivals.raceStatus()!.rivalProgress).toBeCloseTo(0.5, 1);
    expect(arrived).toEqual([]);
    play(game, tender.rivalSeconds / 2 + 1);
    expect(arrived).toEqual([{ missionId: tender.contract.id, rivalId: tender.rivalId }]);
    expect(game.rivals.raceStatus()).toMatchObject({ rivalProgress: 1, rivalSecondsLeft: 0 });

    const decided = listen(game, 'TenderDecided');
    const rivalCredits = game.rivals.statuses().find((rival) => rival.definition.id === tender.rivalId)!.credits;
    play(game, 1, 1);
    parkInTargetBay(game);
    play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
    expect(decided).toEqual([{ missionId: tender.contract.id, rivalId: tender.rivalId, won: false, prize: tender.prize }]);
    expect(game.rivals.statuses().find((rival) => rival.definition.id === tender.rivalId)!.credits).toBeGreaterThanOrEqual(
      rivalCredits + tender.prize,
    );
    expect(arrived).toHaveLength(1);
    expect(game.rivals.raceStatus()).toBeNull();
  });

  it('loses a tender that is given up', async () => {
    const game = await newCompany(1, 5000);
    runRivals(game, RIVALS.firstTenderSeconds);
    const tender = game.rivals.tender!;
    const decided = listen(game, 'TenderDecided');
    game.missions.accept(tender.contract.id);
    game.missions.abandon();
    expect(decided).toEqual([{ missionId: tender.contract.id, rivalId: tender.rivalId, won: false, prize: tender.prize }]);
  });

  it('buys a rival out once the company is worth more: its trucks leave the roads, and its standing is the company\'s', async () => {
    const game = await newCompany(1, 5000);
    expect(game.rivals.acquire('rival_yeniliman')).toEqual({ ok: false, error: 'tooStrong' });
    game.economy.restore(20_000); // Worth 32,000 with its truck against Havenport's 27,000, but short of its price.
    const yeniliman = game.rivals.statuses().find((rival) => rival.definition.id === 'rival_yeniliman')!;
    expect(yeniliman).toMatchObject({ value: 27_000, price: 33_800, withinReach: true });
    expect(game.rivals.acquire('rival_yeniliman')).toEqual({ ok: false, error: 'insufficientFunds' });

    game.economy.restore(100_000);
    const acquired = listen(game, 'RivalAcquired');
    const leaders = listen(game, 'CityLeaderChanged');
    expect(game.rivals.acquire('rival_yeniliman')).toEqual({ ok: true, value: undefined });
    expect(game.economy.credits).toBe(100_000 - 33_800);
    expect(acquired).toEqual([{ rivalId: 'rival_yeniliman', price: 33_800 }]);
    expect(leaders).toEqual([{ cityId: 'city_a', previousId: 'rival_yeniliman', leaderId: 'player', away: false }]);
    expect(game.rivals.statuses().find((rival) => rival.definition.id === 'rival_yeniliman')).toMatchObject({
      acquired: true,
      trucks: 0,
      value: 0,
      withinReach: false,
    });
    expect(game.rivals.league().map((entry) => entry.companyId)).not.toContain('rival_yeniliman');
    expect(game.rivals.cities()[0]!.shares.map((share) => share.companyId)).toEqual(['player', 'rival_basakova', 'rival_demirkent']);
    expect(game.rivals.acquire('rival_yeniliman')).toEqual({ ok: false, error: 'acquired' });
    expect(game.rivals.acquire('rival_nobody')).toEqual({ ok: false, error: 'unknownRival' });

    // Gone for good: no trucks, no tenders.
    runRivals(game, 30 * 60);
    expect(game.rivals.statuses().find((rival) => rival.definition.id === 'rival_yeniliman')!.trucks).toBe(0);
    expect(game.rivals.snapshot().standing.some((entry) => entry.companyId === 'rival_yeniliman')).toBe(false);
  });

  it('shows where each rival truck is, and the one racing the company', async () => {
    const game = await newCompany(1, 5000);
    runRivals(game, 30);
    const count = game.rivals.updateMarkers();
    expect(count).toBe(6);
    const half = game.driving.world.halfSizeMeters;
    for (const marker of game.rivals.markers.slice(0, count)) {
      expect(Math.abs(marker.x)).toBeLessThan(half);
      expect(Math.abs(marker.z)).toBeLessThan(half);
      expect(marker.racing).toBe(false);
      expect(marker.color).toBe(game.rivals.colorOf(marker.rivalId));
      expect(marker.key).toMatch(new RegExp(`^${marker.rivalId}:[01]$`));
      expect(game.driving.world.depotOf(marker.destinationCityId)).toBeDefined();
    }
    expect(new Set(game.rivals.markers.slice(0, count).map((marker) => marker.key)).size).toBe(count);
    const markers = game.rivals.markers;
    runRivals(game, RIVALS.firstTenderSeconds);
    const tender = game.rivals.tender!;
    game.missions.accept(tender.contract.id);
    expect(game.rivals.updateMarkers()).toBe(7);
    expect(game.rivals.markers).toBe(markers);
    // The rival racing the company for the tender: only the maps show it.
    expect(game.rivals.markers[6]).toMatchObject({
      racing: true,
      moving: false,
      key: '',
      destinationCityId: tender.contract.destinationCityId,
    });
  });

  it('keeps the rivals, the standing, the timers and a race going across a save', async () => {
    const first = await newCompany(1, 50_000);
    runRivals(first, RIVALS.firstTenderSeconds + 600);
    first.rivals.runCampaign('city_c');
    const tender = first.rivals.tender!;
    first.missions.accept(tender.contract.id);
    play(first, STEP_SECONDS);
    parkInTargetBay(first);
    play(first, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 0.1);
    first.session.save();
    const saved = first.rivals.snapshot();
    expect(saved.race?.contract.id).toBe(tender.contract.id);
    expect(saved.campaignCooldowns).toEqual([{ cityId: 'city_c', seconds: expect.any(Number) }]);

    const second = await bootGame(first.storage, 1_000);
    expect(second.session.continueGame().ok).toBe(true);
    expect(second.rivals.snapshot()).toEqual(saved);
    expect(second.rivals.raceStatus()).toMatchObject({ started: true, tender: { rivalId: tender.rivalId } });
    expect(['city_a', 'city_b', 'city_c'].map((cityId) => second.rivals.leaderOf(cityId))).toEqual(
      ['city_a', 'city_b', 'city_c'].map((cityId) => first.rivals.leaderOf(cityId)),
    );
  });

  it('lets the rivals work on while the game is closed, for at most as long as the fleet', async () => {
    const game = await newCompany(1, 5000);
    const bought = listen(game, 'RivalTruckBought');
    const before = game.rivals.snapshot();
    game.rivals.catchUp(10 * 3600);
    const after = game.rivals.snapshot();
    expect(after.jobsPlanned).toBeGreaterThan(before.jobsPlanned + 50);
    expect(bought.length).toBeGreaterThan(0);
    expect(bought.every((event) => event.away)).toBe(true);

    // Capped: ten hours away comes to the same as two.
    const twoHours = await newCompany(1, 5000);
    twoHours.rivals.catchUp(DEFAULT_GAME_CONFIG.fleet.awayHours * 3600);
    expect(twoHours.rivals.snapshot()).toEqual(after);
    game.rivals.catchUp(0);
    game.rivals.catchUp(-5);
    expect(game.rivals.snapshot()).toEqual(after);
  });

  it('works a long update through in steps: ten minutes at once (the debug fast-forward) come to the same as in short steps, and save', async () => {
    const once = await newCompany(1, 5000);
    once.rivals.update(600);
    const stepped = await newCompany(1, 5000);
    for (let step = 0; step < 60; step++) {
      stepped.rivals.update(10);
    }
    const saved = once.rivals.snapshot();
    expect(saved).toEqual(stepped.rivals.snapshot());
    expect(saved.tendersPosted).toBe(1);
    expect(saved.companies.every((company) => company.decisionSeconds > 0)).toBe(true);
    expect(once.session.save().ok).toBe(true);
  });
});
