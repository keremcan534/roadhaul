import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import type { GameContent } from '../../../../src/data/GameContent';
import type { RectangleDefinition } from '../../../../src/data/definitions/MapDefinition';
import { bayParkingPose } from '../../../../src/domain/missions/loadingBay';
import { createRouteGuidance } from '../../../../src/domain/world/roadRoute';
import { DrivingService } from '../../../../src/systems/driving/DrivingService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { MissionService } from '../../../../src/systems/missions/MissionService';
import {
  cargoFixture,
  cityFixture,
  contentFixture,
  mapFixture,
  missionFixture,
  vehicleFixture,
} from '../../../support/contentFixtures';
import { input, STEP_SECONDS } from '../../../support/driving';
import { MemoryLogger } from '../../../support/MemoryLogger';

const LOADING_SECONDS = 1;
/** Fixture truck: 8000 kg empty; the fixture mission carries 5 t. */
const EMPTY_MASS = 8000;

/**
 * The fixture map: a straight road along X, the origin depot's bay at
 * (-100, -17) and the destination's at (100, -17), both running along X.
 */
function setup(overrides: Partial<GameContent> = {}) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const content = ContentCatalog.create(contentFixture(overrides));
  const driving = new DrivingService(content, events, logger);
  const company = { level: 1 };
  const missions = new MissionService(content, driving, company, events, { loadingSeconds: LOADING_SECONDS }, logger);
  const log: string[] = [];
  events.on('MissionStateChanged', ({ previous, current }) => log.push(`${previous} -> ${current}`));
  events.on('MissionFailed', ({ reason }) => log.push(`failed: ${reason}`));
  const completed: GameEvents['MissionCompleted'][] = [];
  events.on('MissionCompleted', (event) => completed.push(event));
  driving.start(content.vehicles.all[0]!.id, 'test_map');
  return { events, driving, missions, company, log, completed };
}

/** Parks the truck with its body centred in `bay`, facing along it. */
function parkIn(driving: DrivingService, bay: RectangleDefinition): void {
  const pose = bayParkingPose(bay, driving.definition.body);
  driving.placeTruck(pose.x, pose.z, pose.heading);
}

/** Runs fixed steps: the truck first, then the missions, like the game loop. */
function run(driving: DrivingService, missions: MissionService, seconds: number, throttle = 0): void {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += STEP_SECONDS) {
    driving.step(STEP_SECONDS, input({ throttle }));
    missions.update(STEP_SECONDS);
  }
}

/** Accepts the fixture mission and loads it at the origin bay. */
function acceptAndLoad(context: ReturnType<typeof setup>) {
  const { driving, missions } = context;
  missions.accept('test_mission');
  missions.update(STEP_SECONDS);
  parkIn(driving, missions.target!.depot.bay);
  run(driving, missions, LOADING_SECONDS + 0.1);
}

describe('MissionService', () => {
  it('offers the contracts of the map, with their base pay and road distance', () => {
    const { missions } = setup();

    const [offer, ...others] = missions.jobBoard();

    expect(others).toEqual([]);
    expect(offer).toMatchObject({
      mission: { id: 'test_mission' },
      cargo: { id: 'test_cargo' },
      basePay: 1000,
      blockedBy: null,
      suitableVehicles: [{ id: 'test_truck' }],
    });
    expect(offer!.originDepot.id).toBe('test_origin_depot');
    expect(offer!.destinationDepot.id).toBe('test_destination_depot');
    // 200 m along the road, plus 17 m from each bay to it.
    expect(offer!.distanceMeters).toBeGreaterThan(225);
    expect(offer!.distanceMeters).toBeLessThan(245);
  });

  it('lists contracts that need another body or more payload as blocked by the truck, naming the trucks that can', () => {
    const { missions } = setup({
      vehicles: [vehicleFixture(), vehicleFixture({ id: 'reefer', bodyType: 'refrigerated', maxPayloadTons: 30 })],
      cargo: [cargoFixture(), cargoFixture({ id: 'ice_cream', temperature: 'frozen', requiredBody: 'refrigerated' })],
      missions: [
        missionFixture(),
        missionFixture({ id: 'frozen_run', cargoId: 'ice_cream' }),
        missionFixture({ id: 'too_heavy', cargoWeightTons: 20 }),
      ],
    });

    // The box truck is driven (the first vehicle).
    const board = missions.jobBoard();
    expect(board.map((offer) => [offer.mission.id, offer.blockedBy])).toEqual([
      ['test_mission', null],
      ['frozen_run', 'truck'],
      ['too_heavy', 'truck'],
    ]);
    expect(board[1]!.suitableVehicles.map((vehicle) => vehicle.id)).toEqual(['reefer']);
    expect(board[2]!.suitableVehicles.map((vehicle) => vehicle.id)).toEqual(['reefer']);
    expect(missions.accept('frozen_run')).toEqual({ ok: false, error: 'needsAnotherTruck' });
    expect(missions.active).toBeNull();
  });

  it('leaves out contracts between cities without a depot on this map', () => {
    const { missions } = setup({
      cities: [
        cityFixture(),
        cityFixture({ id: 'test_destination', specialization: 'industrial' }),
        cityFixture({ id: 'far_away', specialization: 'agricultural' }),
      ],
      maps: [
        mapFixture(),
        mapFixture({
          id: 'other_map',
          depots: [{ ...mapFixture().depots[0]!, id: 'far_depot', cityId: 'far_away' }],
        }),
      ],
      missions: [missionFixture(), missionFixture({ id: 'elsewhere', destinationCityId: 'far_away' })],
    });

    expect(missions.jobBoard().map((offer) => offer.mission.id)).toEqual(['test_mission']);
    expect(missions.accept('elsewhere')).toEqual({ ok: false, error: 'notOffered' });
  });

  it('accepts one contract at a time and refuses unknown ones', () => {
    const { missions, log } = setup();

    const accepted = missions.accept('test_mission');

    expect(accepted.ok).toBe(true);
    expect(missions.active).toMatchObject({ missionId: 'test_mission', state: 'accepted' });
    expect(missions.activeDefinition?.id).toBe('test_mission');
    expect(missions.accept('test_mission')).toEqual({ ok: false, error: 'missionInProgress' });
    expect(log).toEqual(['null -> accepted']);
    expect(setup().missions.accept('ghost_mission')).toEqual({ ok: false, error: 'notOffered' });
  });

  it('sends the truck to the pickup bay once driving starts', () => {
    const { missions, log } = setup();
    missions.accept('test_mission');

    missions.update(STEP_SECONDS);

    expect(missions.active?.state).toBe('travellingToPickup');
    expect(missions.target).toMatchObject({ kind: 'pickup', depot: { id: 'test_origin_depot' } });
    expect(log).toEqual(['null -> accepted', 'accepted -> travellingToPickup']);
  });

  it('loads the cargo after the truck stands in the pickup bay for the loading time', () => {
    const { driving, missions } = setup();
    missions.accept('test_mission');
    missions.update(STEP_SECONDS);
    parkIn(driving, missions.target!.depot.bay);

    run(driving, missions, LOADING_SECONDS / 2);
    expect(missions.handlingProgress).toBeCloseTo(0.5, 1);
    expect(missions.active?.state).toBe('travellingToPickup');

    run(driving, missions, LOADING_SECONDS / 2 + 0.05);
    expect(missions.active?.state).toBe('loaded');
    expect(missions.handlingProgress).toBe(0);
    expect(driving.totalMassKg).toBe(EMPTY_MASS + 5000);
    expect(missions.target).toMatchObject({ kind: 'delivery', depot: { id: 'test_destination_depot' } });
  });

  it('restarts loading when the truck leaves the bay too early', () => {
    const { driving, missions } = setup();
    missions.accept('test_mission');
    missions.update(STEP_SECONDS);
    const bay = missions.target!.depot.bay;
    parkIn(driving, bay);
    run(driving, missions, LOADING_SECONDS * 0.8);

    driving.placeTruck(0, 0, Math.PI / 2); // On the road, out of the bay.
    run(driving, missions, STEP_SECONDS);
    expect(missions.handlingProgress).toBe(0);

    parkIn(driving, bay);
    run(driving, missions, LOADING_SECONDS * 0.8);
    expect(missions.active?.state).toBe('travellingToPickup');
  });

  it('does not load at the delivery bay, or while rolling through the pickup bay', () => {
    const { driving, missions } = setup();
    missions.accept('test_mission');
    missions.update(STEP_SECONDS);

    parkIn(driving, driving.world.depotOf('test_destination')!.bay);
    run(driving, missions, LOADING_SECONDS * 2);
    expect(missions.active?.state).toBe('travellingToPickup');

    parkIn(driving, missions.target!.depot.bay);
    run(driving, missions, LOADING_SECONDS * 2, 1);
    expect(missions.active?.state).toBe('travellingToPickup');
  });

  it('starts the delivery clock at loading and delivers at the destination bay', () => {
    const context = setup();
    const { driving, missions, log, completed } = context;
    acceptAndLoad(context);

    run(driving, missions, 2, 1); // Drive off.
    expect(missions.active?.state).toBe('delivering');
    parkIn(driving, missions.target!.depot.bay);
    run(driving, missions, LOADING_SECONDS + 0.1);

    expect(log).toEqual([
      'null -> accepted',
      'accepted -> travellingToPickup',
      'travellingToPickup -> loaded',
      'loaded -> delivering',
      'delivering -> completed',
    ]);
    expect(completed).toHaveLength(1);
    const [delivery] = completed;
    // The clock ran for the 0.1 s still spent in the bay after loading, 2 s of driving and the unloading.
    expect(delivery!.deliverySeconds).toBeCloseTo(0.1 + 2 + LOADING_SECONDS, 1);
    expect(delivery!.reward).toMatchObject({ basePay: 1000, timeBonus: 200, conditionBonus: 200, total: 1400 });
    expect(missions.active).toBeNull();
    expect(missions.target).toBeNull();
    expect(driving.totalMassKg).toBe(EMPTY_MASS);
  });

  it('pays less for a late delivery', () => {
    const context = setup();
    const { driving, missions, completed } = context;
    acceptAndLoad(context);
    run(driving, missions, 1, 1);

    missions.update(700); // The fixture mission's limit is 600 s.
    parkIn(driving, missions.target!.depot.bay);
    run(driving, missions, LOADING_SECONDS + 0.1);

    expect(completed[0]!.reward.onTime).toBe(false);
    expect(completed[0]!.reward.latePenalty).toBeGreaterThan(0);
  });

  it('damages cargo on board in collisions and fails the contract beyond its tolerance', () => {
    const context = setup();
    const { events, missions, log } = context;
    const damage: number[] = [];
    events.on('CargoDamaged', ({ cargoDamage }) => damage.push(cargoDamage));
    missions.accept('test_mission');
    missions.update(STEP_SECONDS);

    events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 10 }); // Nothing on board yet.
    expect(damage).toEqual([]);

    acceptAndLoad(context);
    // Sensitivity 0.5: 5 m/s does 0.5 × (5/14)² ≈ 0.064, under the 0.2 tolerance.
    events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 5 });
    expect(damage[0]).toBeCloseTo(0.5 * (5 / 14) ** 2, 9);
    expect(missions.active?.state).toBe('loaded');

    events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 9 });
    expect(missions.active).toBeNull();
    expect(log.slice(-2)).toEqual(['loaded -> failed', 'failed: cargoDamaged']);
    expect(context.driving.totalMassKg).toBe(EMPTY_MASS);
  });

  it('keeps part of every hit away from the cargo with a protecting suspension', () => {
    const context = setup();
    const { events, missions } = context;
    const damage: number[] = [];
    events.on('CargoDamaged', ({ addedDamage }) => damage.push(addedDamage));
    acceptAndLoad(context);

    missions.setCargoProtection(0.3);
    events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 5 });
    missions.setCargoProtection(Number.NaN); // Unusable: no protection.
    events.emit('VehicleCollided', { impactSpeedMetersPerSecond: 5 });

    expect(damage[0]).toBeCloseTo(0.7 * 0.5 * (5 / 14) ** 2, 9);
    expect(damage[1]).toBeCloseTo(0.5 * (5 / 14) ** 2, 9);
  });

  it('fails an abandoned contract and frees the truck for the next one', () => {
    const context = setup();
    const { missions, log } = context;
    acceptAndLoad(context);

    missions.abandon();

    expect(log.slice(-2)).toEqual(['loaded -> failed', 'failed: abandoned']);
    expect(missions.active).toBeNull();
    expect(context.driving.totalMassKg).toBe(EMPTY_MASS);
    expect(missions.accept('test_mission').ok).toBe(true);
    expect(() => setup().missions.abandon()).not.toThrow();
  });

  it('guides the truck to its target by road', () => {
    const { driving, missions } = setup();
    const guidance = createRouteGuidance();
    expect(missions.guide(guidance)).toBe(false);

    missions.accept('test_mission');
    missions.update(STEP_SECONDS);
    driving.placeTruck(100, 0, Math.PI / 2); // At the east end, facing away from the pickup.

    expect(missions.guide(guidance)).toBe(true);
    expect(guidance.distanceMeters).toBeGreaterThan(200);
    expect(guidance.aimX).toBeLessThan(100); // Back west, along the road.
    expect(guidance.aimZ).toBeCloseTo(0, 6);
  });

  it('waits while nothing is being driven, and stops listening when disposed', () => {
    const { events, driving, missions } = setup();
    missions.accept('test_mission');
    driving.stop();

    missions.update(STEP_SECONDS);
    expect(missions.active?.state).toBe('accepted');

    missions.dispose();
    expect(missions.active).toBeNull();
    expect(events.listenerCount('VehicleCollided')).toBe(0);
  });

  it('lists contracts above the company level as locked and refuses them', () => {
    const { missions, company } = setup({ missions: [missionFixture({ requiredCompanyLevel: 3 })] });

    expect(missions.jobBoard()[0]).toMatchObject({ requiredCompanyLevel: 3, blockedBy: 'companyLevel' });
    expect(missions.accept('test_mission')).toEqual({ ok: false, error: 'locked' });

    company.level = 3;
    expect(missions.jobBoard()[0]!.blockedBy).toBeNull();
    expect(missions.accept('test_mission').ok).toBe(true);
  });

  it('names the company level first when a contract also needs another truck', () => {
    const { missions } = setup({
      vehicles: [vehicleFixture(), vehicleFixture({ id: 'big_truck', maxPayloadTons: 40 })],
      missions: [missionFixture({ requiredCompanyLevel: 2, cargoWeightTons: 40 })],
    });

    expect(missions.jobBoard()[0]!.blockedBy).toBe('companyLevel');
  });

  it('awards XP and reputation with a delivery, and takes reputation for a failure', () => {
    const context = setup();
    const { driving, missions, completed, events } = context;
    const failures: GameEvents['MissionFailed'][] = [];
    events.on('MissionFailed', (failure) => failures.push(failure));
    acceptAndLoad(context);
    run(driving, missions, 1, 1);
    parkIn(driving, missions.target!.depot.bay);
    run(driving, missions, LOADING_SECONDS + 0.1);

    // Easy, 1400 credits, on time and pristine: 112 XP and the full 10 reputation.
    expect(completed[0]).toMatchObject({ xp: 112, reputation: 10 });

    missions.accept('test_mission');
    missions.abandon();
    expect(failures).toEqual([{ missionId: 'test_mission', reason: 'abandoned', reputationLost: 3 }]);
  });

  it('saves the contract under way and resumes it, cargo and all', () => {
    const context = setup();
    acceptAndLoad(context);
    run(context.driving, context.missions, 1, 1);
    const saved = context.missions.snapshot();
    expect(saved).toMatchObject({ missionId: 'test_mission', state: 'delivering' });

    const resumed = setup();
    resumed.missions.restore(saved);

    expect(resumed.missions.active).toEqual(saved);
    expect(resumed.missions.active).not.toBe(saved);
    expect(resumed.missions.target).toMatchObject({ kind: 'delivery', depot: { id: 'test_destination_depot' } });
    expect(resumed.driving.totalMassKg).toBe(EMPTY_MASS + 5000);

    resumed.missions.restore(null);
    expect(resumed.missions.active).toBeNull();
    expect(resumed.missions.target).toBeNull();
    expect(resumed.driving.totalMassKg).toBe(EMPTY_MASS);
    expect(resumed.missions.snapshot()).toBeNull();
  });

  it('keeps a truck held on the brake in the bay while it loads, instead of reversing out', () => {
    const { driving, missions } = setup();
    missions.accept('test_mission');
    missions.update(STEP_SECONDS);
    parkIn(driving, missions.target!.depot.bay);

    // Holding the brake at a standstill would engage reverse after 0.3 s anywhere else.
    for (let elapsed = 0; elapsed < LOADING_SECONDS + 0.2; elapsed += STEP_SECONDS) {
      driving.step(STEP_SECONDS, input({ brake: 1 }));
      missions.update(STEP_SECONDS);
    }

    expect(missions.active?.state).toBe('loaded');
    expect(driving.vehicle.gear).toBe(1);

    // Loaded: the brake reverses again.
    for (let elapsed = 0; elapsed < 1; elapsed += STEP_SECONDS) {
      driving.step(STEP_SECONDS, input({ brake: 1 }));
      missions.update(STEP_SECONDS);
    }
    expect(driving.vehicle.gear).toBe(-1);
  });

  it('loads for exactly the configured time', () => {
    const logger = new MemoryLogger();
    const events = new EventBus<GameEvents>(logger);
    const content = ContentCatalog.create(contentFixture());
    const driving = new DrivingService(content, events, logger);
    const missions = new MissionService(content, driving, { level: 1 }, events, { loadingSeconds: 2.5 }, logger);
    driving.start('test_truck', 'test_map');
    missions.accept('test_mission');
    missions.update(STEP_SECONDS);
    parkIn(driving, missions.target!.depot.bay);

    run(driving, missions, 2.4);
    expect(missions.active?.state).toBe('travellingToPickup');
    run(driving, missions, 0.15);
    expect(missions.active?.state).toBe('loaded');
    expect(DEFAULT_GAME_CONFIG.missions.loadingSeconds).toBe(3);
  });
});
