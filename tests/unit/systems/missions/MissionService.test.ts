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
  contentFixture,
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
  const missions = new MissionService(content, driving, events, { loadingSeconds: LOADING_SECONDS }, logger);
  const log: string[] = [];
  events.on('MissionStateChanged', ({ previous, current }) => log.push(`${previous} -> ${current}`));
  events.on('MissionFailed', ({ reason }) => log.push(`failed: ${reason}`));
  const completed: GameEvents['MissionCompleted'][] = [];
  events.on('MissionCompleted', (event) => completed.push(event));
  driving.start(content.vehicles.all[0]!.id, 'test_map');
  return { events, driving, missions, log, completed };
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
  it('offers the contracts the truck can haul, with their base pay and road distance', () => {
    const { missions } = setup();

    const [offer, ...others] = missions.jobBoard();

    expect(others).toEqual([]);
    expect(offer).toMatchObject({ mission: { id: 'test_mission' }, cargo: { id: 'test_cargo' }, basePay: 1000 });
    expect(offer!.originDepot.id).toBe('test_origin_depot');
    expect(offer!.destinationDepot.id).toBe('test_destination_depot');
    // 200 m along the road, plus 17 m from each bay to it.
    expect(offer!.distanceMeters).toBeGreaterThan(225);
    expect(offer!.distanceMeters).toBeLessThan(245);
  });

  it('leaves out contracts that need another body or more payload', () => {
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
    expect(missions.jobBoard().map((offer) => offer.mission.id)).toEqual(['test_mission']);
    expect(missions.accept('frozen_run')).toEqual({ ok: false, error: 'notOffered' });
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

  it('uses the configured loading time', () => {
    expect(DEFAULT_GAME_CONFIG.missions.loadingSeconds).toBeGreaterThan(0);
  });
});
