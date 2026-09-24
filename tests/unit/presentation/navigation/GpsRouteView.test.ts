import { Mesh, Scene, type BufferAttribute, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { GpsRouteView } from '../../../../src/presentation/navigation/GpsRouteView';
import { DrivingService } from '../../../../src/systems/driving/DrivingService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { MissionService } from '../../../../src/systems/missions/MissionService';
import { NavigationService } from '../../../../src/systems/navigation/NavigationService';
import { contentFixture } from '../../../support/contentFixtures';
import { STEP_SECONDS } from '../../../support/driving';
import { MemoryLogger } from '../../../support/MemoryLogger';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

/** The fixture map: a street along X, the pickup bay at (-100, -17) in a yard south of it. */
function setup() {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const content = ContentCatalog.create(contentFixture());
  const driving = new DrivingService(content, events, logger);
  const missions = new MissionService(content, driving, { level: 1 }, events, { loadingSeconds: 1 }, logger);
  const navigation = new NavigationService(
    driving,
    missions,
    DEFAULT_GAME_CONFIG.traffic.speedLimitsKmh,
    DEFAULT_GAME_CONFIG.navigation,
    logger,
  );
  driving.start('test_truck', 'test_map');
  const scene = new Scene();
  const view = new GpsRouteView(scene, navigation);
  const band = scene.getObjectByName('gps-route') as Mesh;
  const draw = (): void => {
    const truck = driving.vehicle;
    view.update(truck.x, truck.z, truck.heading, driving.world.roads);
  };
  return { driving, missions, navigation, scene, view, band, draw };
}

/** The band's drawn vertices as [x, y, z]. */
function drawnVertices(geometry: BufferGeometry): [number, number, number][] {
  const positions = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  const used = new Set<number>();
  for (let i = geometry.drawRange.start; i < geometry.drawRange.start + geometry.drawRange.count; i++) {
    used.add(index.getX(i));
  }
  return [...used].map((vertex) => [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)]);
}

describe('GpsRouteView', () => {
  it('draws the route in one draw call, and nothing without a contract', () => {
    const { navigation, scene, band, draw } = setup();

    navigation.refresh();
    draw();

    expect(drawCallCount(scene)).toBe(1);
    expect(band.visible).toBe(false);
  });

  it('lays the band down the right-hand lane ahead and into the yard to the bay', () => {
    const { driving, missions, navigation, band, draw } = setup();
    missions.accept('test_mission');
    missions.update(STEP_SECONDS);
    driving.placeTruck(80, -2.5, -Math.PI / 2); // Heading -X towards the pickup: the right-hand lane is -Z.

    navigation.refresh();
    draw();

    expect(band.visible).toBe(true);
    const vertices = drawnVertices(band.geometry);
    const onRoad = vertices.filter(([x]) => x > -90);
    expect(onRoad.length).toBeGreaterThan(20);
    for (const [x, y, z] of onRoad) {
      expect(y).toBeCloseTo(0.1, 6);
      expect(x).toBeLessThan(82); // Nothing behind the truck.
      expect(z, `(${x.toFixed(1)}, ${z.toFixed(1)})`).toBeLessThan(-1.7);
      expect(z).toBeGreaterThan(-3.3);
    }
    // It ends at the bay, off the road.
    const deepest = Math.min(...vertices.map(([, , z]) => z));
    expect(deepest).toBeLessThan(-15);
  });

  it('rewrites the band only when the route has been worked out again', () => {
    const { driving, missions, navigation, band, draw } = setup();
    missions.accept('test_mission');
    missions.update(STEP_SECONDS);
    navigation.refresh();
    draw();
    const positions = band.geometry.getAttribute('position') as BufferAttribute;
    const version = positions.version;

    draw();
    expect(positions.version).toBe(version);

    driving.placeTruck(40, -2.5, -Math.PI / 2);
    navigation.refresh();
    draw();
    expect(positions.version).toBeGreaterThan(version);
  });

  it('releases its GPU resources on dispose', () => {
    const { scene, view } = setup();
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect(disposed).toEqual(resources);
    expect(scene.children).toHaveLength(0);
  });
});
