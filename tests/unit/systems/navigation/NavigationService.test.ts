import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { bayParkingPose } from '../../../../src/domain/missions/loadingBay';
import { DrivingService } from '../../../../src/systems/driving/DrivingService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { MissionService } from '../../../../src/systems/missions/MissionService';
import { NavigationService } from '../../../../src/systems/navigation/NavigationService';
import { contentFixture, vehicleFixture } from '../../../support/contentFixtures';
import { input, STEP_SECONDS } from '../../../support/driving';
import { MemoryLogger } from '../../../support/MemoryLogger';

const LOADING_SECONDS = 1;

/**
 * The fixture map: a straight 300 m street along X, the pickup bay at
 * (-100, -17) and the delivery bay at (100, -17), in yards south of it.
 */
function setup(maxSpeedKmh = 90) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const content = ContentCatalog.create(contentFixture({ vehicles: [vehicleFixture({ maxSpeedKmh })] }));
  const driving = new DrivingService(content, events, logger);
  const missions = new MissionService(content, driving, { level: 1 }, events, { loadingSeconds: LOADING_SECONDS }, logger);
  const navigation = new NavigationService(
    driving,
    missions,
    DEFAULT_GAME_CONFIG.traffic.speedLimitsKmh,
    { etaPaceFactor: 0.8 },
    logger,
  );
  driving.start('test_truck', 'test_map');
  return { driving, missions, navigation };
}

describe('NavigationService', () => {
  it('has no route without a contract', () => {
    const { navigation } = setup();

    navigation.update(1);

    expect(navigation.hasRoute).toBe(false);
    expect(navigation.route).toBeNull();
    expect(navigation.distanceMeters).toBe(0);
  });

  it('routes to the pickup bay by road, with the distance, the arrival time and a point ahead to aim at', () => {
    const { driving, missions, navigation } = setup();
    missions.accept('test_mission');
    missions.update(STEP_SECONDS);
    driving.placeTruck(50, -2.5, -Math.PI / 2); // In the lane heading -X (its right-hand side is -Z), towards the pickup.

    navigation.refresh();

    expect(navigation.hasRoute).toBe(true);
    // About 150 m along the street, then 17 m into the yard.
    expect(navigation.distanceMeters).toBeGreaterThan(160);
    expect(navigation.distanceMeters).toBeLessThan(175);
    // The street's 45 km/h limit at the pace factor (10 m/s); walking pace in the yard.
    expect(navigation.etaSeconds).toBeGreaterThan(150 / 10);
    expect(navigation.etaSeconds).toBeLessThan(150 / 10 + 20 / 4 + 1);
    expect(navigation.aimX).toBeCloseTo(50 - 40, -1);
    expect(navigation.aimZ).toBeCloseTo(0, 6); // Road samples lie on the centreline.
    expect(navigation.manoeuvre.kind).toBe('arrive');
  });

  it('times the route at the truck\'s own top speed where that is below the limit', () => {
    const slow = setup(30);
    const fast = setup(90);
    for (const { driving, missions, navigation } of [slow, fast]) {
      missions.accept('test_mission');
      missions.update(STEP_SECONDS);
      driving.placeTruck(50, -2.5, -Math.PI / 2);
      navigation.refresh();
    }

    expect(slow.navigation.etaSeconds).toBeGreaterThan(fast.navigation.etaSeconds * 1.3);
  });

  it('asks the driver to turn round when the truck faces away from the bay on the road', () => {
    const { driving, missions, navigation } = setup();
    missions.accept('test_mission');
    missions.update(STEP_SECONDS);
    driving.placeTruck(50, 2.5, Math.PI / 2); // In the lane heading +X, away from the pickup in the west.

    navigation.refresh();

    expect(navigation.manoeuvre).toEqual({ kind: 'turnAround', distanceMeters: 0 });
  });

  it('routes to the delivery bay once loaded, and forgets the route when the contract ends', () => {
    const { driving, missions, navigation } = setup();
    missions.accept('test_mission');
    missions.update(STEP_SECONDS);
    const pose = bayParkingPose(missions.target!.depot.bay, driving.definition.body);
    driving.placeTruck(pose.x, pose.z, pose.heading);
    for (let elapsed = 0; elapsed < LOADING_SECONDS + 0.2; elapsed += STEP_SECONDS) {
      driving.step(STEP_SECONDS, input());
      missions.update(STEP_SECONDS);
    }
    expect(missions.target?.kind).toBe('delivery');

    navigation.refresh();
    expect(navigation.distanceMeters).toBeGreaterThan(200); // From the pickup bay to the delivery bay.
    const revision = navigation.revision;

    missions.abandon();
    navigation.refresh();
    expect(navigation.hasRoute).toBe(false);
    expect(navigation.revision).toBe(revision + 1);
  });

  it('works the route out ten times a second, however often it is called', () => {
    const { missions, navigation } = setup();
    missions.accept('test_mission');
    missions.update(STEP_SECONDS);
    const revision = navigation.revision;

    for (let step = 0; step < 60; step++) {
      navigation.update(STEP_SECONDS);
    }

    expect(navigation.revision - revision).toBe(10);
  });
});
