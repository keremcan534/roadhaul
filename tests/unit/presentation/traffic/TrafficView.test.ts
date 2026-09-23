import { Box3, Color, InstancedMesh, Matrix4, Scene, Vector3, type BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { TRAFFIC_VEHICLES } from '../../../../src/data/content/trafficVehicles';
import { TrafficSimulation } from '../../../../src/domain/traffic/TrafficSimulation';
import { createVehicleFootprint } from '../../../../src/domain/vehicles/VehicleFootprint';
import { TrafficView, vehicleGeometry } from '../../../../src/presentation/traffic/TrafficView';
import { vehicleFixture } from '../../../support/contentFixtures';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';
import { laneAt, laneGraphOf, straightStreet } from '../../../support/trafficFixtures';

const graph = laneGraphOf(straightStreet(1200));
const north = laneAt(graph, 0, 0, 0);
const truck = { x: 900, z: 900, heading: 0, speed: 0 };
const footprint = createVehicleFootprint(vehicleFixture().body);

function traffic(): TrafficSimulation {
  return new TrafficSimulation(
    graph,
    TRAFFIC_VEHICLES,
    { maxVehicles: 8, radiusMeters: 5000, minSpawnDistanceMeters: 100, autoSpawn: false },
    1,
  );
}

function meshesOf(scene: Scene): InstancedMesh[] {
  const meshes: InstancedMesh[] = [];
  scene.traverse((object) => {
    if (object instanceof InstancedMesh) meshes.push(object);
  });
  return meshes;
}

describe('TrafficView', () => {
  it('draws all traffic in one draw call per kind of vehicle', () => {
    const scene = new Scene();
    new TrafficView(scene, TRAFFIC_VEHICLES, 16);

    expect(drawCallCount(scene)).toBe(TRAFFIC_VEHICLES.length);
    for (const mesh of meshesOf(scene)) {
      expect(mesh.count).toBe(0);
      expect(mesh.frustumCulled).toBe(false);
    }
  });

  it('shapes every kind to its size, standing on the ground and facing +Z, in under 400 triangles', () => {
    for (const type of TRAFFIC_VEHICLES) {
      const geometry = vehicleGeometry(type);
      const box = new Box3().setFromBufferAttribute(geometry.getAttribute('position') as BufferAttribute);

      expect(box.min.y, type.id).toBeCloseTo(0, 1); // Tyres are 10-sided: their lowest corners sit a hair up.
      expect(box.max.y, type.id).toBeCloseTo(type.heightMeters, 1);
      expect(box.max.x - box.min.x, type.id).toBeLessThan(type.widthMeters + 0.1);
      expect(box.max.z - box.min.z, type.id).toBeLessThan(type.lengthMeters + 0.15); // Lamps stand proud of the body.
      expect(box.max.z - box.min.z, type.id).toBeGreaterThan(type.lengthMeters - 0.1);
      expect(geometry.index!.count / 3, type.id).toBeLessThan(400);
      geometry.dispose();
    }
  });

  it('puts each vehicle where the traffic is, between fixed steps, in its paint', () => {
    const scene = new Scene();
    const view = new TrafficView(scene, TRAFFIC_VEHICLES, 8);
    const sim = traffic();
    const car = sim.addVehicle(0, north, 50, 10);
    sim.addVehicle(0, north, 150, 10);
    sim.update(1 / 60, truck, footprint);

    view.update(sim, 0.5);

    const cars = meshesOf(scene).find((mesh) => mesh.name === `traffic:${TRAFFIC_VEHICLES[0]!.id}`)!;
    expect(cars.count).toBe(2);
    const matrix = new Matrix4();
    cars.getMatrixAt(0, matrix);
    const position = new Vector3().setFromMatrixPosition(matrix);
    // Instance matrices are 32-bit floats.
    expect(position.x).toBeCloseTo((sim.previousX[car]! + sim.x[car]!) / 2, 3);
    expect(position.z).toBeCloseTo((sim.previousZ[car]! + sim.z[car]!) / 2, 3);
    const paint = new Color();
    cars.getColorAt(0, paint);
    expect(paint.getHex()).toBe(new Color(sim.color[car]).getHex());
    // Other kinds have nothing to draw.
    expect(meshesOf(scene).filter((mesh) => mesh !== cars).every((mesh) => mesh.count === 0)).toBe(true);
    view.update(null, 1);
    expect(cars.count).toBe(0);
  });

  it('releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const view = new TrafficView(scene, TRAFFIC_VEHICLES, 8);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect(disposed).toEqual(resources);
    expect(scene.children).toHaveLength(0);
  });
});
