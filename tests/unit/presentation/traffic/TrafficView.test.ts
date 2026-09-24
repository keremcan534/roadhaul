import { Box3, Color, InstancedMesh, Matrix4, Points, Scene, Vector3, type BufferAttribute, type MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { TRAFFIC_VEHICLES } from '../../../../src/data/content/trafficVehicles';
import { TrafficSimulation } from '../../../../src/domain/traffic/TrafficSimulation';
import { createVehicleFootprint } from '../../../../src/domain/vehicles/VehicleFootprint';
import { TrafficView, vehicleGeometry, vehicleLamps } from '../../../../src/presentation/traffic/TrafficView';
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

function lampsOf(scene: Scene): InstancedMesh {
  return scene.getObjectByName('traffic:lamps') as InstancedMesh;
}

function glowsOf(scene: Scene): Points {
  let glows: Points | null = null;
  scene.traverse((object) => {
    if (object instanceof Points) glows = object;
  });
  return glows!;
}

describe('TrafficView', () => {
  it('draws all traffic in one draw call per kind of vehicle, one for all their lamps and one for their glow at night', () => {
    const scene = new Scene();
    new TrafficView(scene, TRAFFIC_VEHICLES, 16);

    expect(drawCallCount(scene)).toBe(TRAFFIC_VEHICLES.length + 2);
    expect(glowsOf(scene).visible).toBe(false);
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
      expect(box.max.z - box.min.z, type.id).toBeLessThan(type.lengthMeters + 0.05);
      expect(box.max.z - box.min.z, type.id).toBeGreaterThan(type.lengthMeters - 0.1);
      expect(geometry.index!.count / 3, type.id).toBeLessThan(400);
      geometry.dispose();
    }
  });

  it('puts two headlights on the front of every kind and two tail lights on the back, the glows just outside', () => {
    for (const type of TRAFFIC_VEHICLES) {
      const lamps = vehicleLamps(type);
      expect(lamps, type.id).toHaveLength(4);
      const centres = lamps.map(({ box }) => new Vector3().setFromMatrixPosition(box));
      // Front left, front right, rear left, rear right (left is +X, facing +Z).
      expect(centres.map((centre) => Math.sign(centre.x)), type.id).toEqual([1, -1, 1, -1]);
      expect(centres.map((centre) => Math.sign(centre.z)), type.id).toEqual([1, 1, -1, -1]);
      for (const [index, centre] of centres.entries()) {
        expect(Math.abs(centre.z), type.id).toBeCloseTo(type.lengthMeters / 2 + 0.02, 6);
        expect(Math.abs(centre.x), type.id).toBeLessThan(type.widthMeters / 2);
        expect(centre.y, type.id).toBeGreaterThan(0.3);
        expect(centre.y, type.id).toBeLessThan(type.heightMeters / 2);
        const [x, y, z] = lamps[index]!.glow;
        expect([x, y], type.id).toEqual([centre.x, centre.y]);
        expect(Math.abs(z), type.id).toBeGreaterThan(Math.abs(centre.z));
      }
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
    const others = meshesOf(scene).filter((mesh) => mesh !== cars && mesh !== lampsOf(scene));
    expect(others.every((mesh) => mesh.count === 0)).toBe(true);
    view.update(null, 1);
    expect(cars.count).toBe(0);
  });

  it('lights every vehicle\'s lamps, and makes them glow at night', () => {
    const scene = new Scene();
    const view = new TrafficView(scene, TRAFFIC_VEHICLES, 8);
    const sim = traffic();
    const car = sim.addVehicle(0, north, 50, 10);
    sim.addVehicle(0, north, 150, 10);
    sim.update(1 / 60, truck, footprint);
    const lamps = lampsOf(scene);
    const glows = glowsOf(scene);
    const material = lamps.material as MeshBasicMaterial;

    view.update(sim, 1);

    expect(lamps.count).toBe(8);
    expect(glows.visible).toBe(false);
    // The first lamp is the first car's front-left headlight: ahead of the car, to its left.
    const matrix = new Matrix4();
    lamps.getMatrixAt(0, matrix);
    const lamp = new Vector3().setFromMatrixPosition(matrix);
    const forwardX = Math.sin(sim.heading[car]!);
    const forwardZ = Math.cos(sim.heading[car]!);
    const aheadMeters = (lamp.x - sim.x[car]!) * forwardX + (lamp.z - sim.z[car]!) * forwardZ;
    const leftMeters = (lamp.x - sim.x[car]!) * forwardZ - (lamp.z - sim.z[car]!) * forwardX;
    expect(aheadMeters).toBeCloseTo(TRAFFIC_VEHICLES[0]!.lengthMeters / 2 + 0.02, 3);
    expect(leftMeters).toBeGreaterThan(0.3);
    const colour = new Color();
    lamps.getColorAt(0, colour);
    expect(colour.getHex()).toBe(0xfff4d6);
    lamps.getColorAt(2, colour);
    expect(colour.getHex()).toBe(0xff3322);
    const dayBrightness = material.color.r;

    view.setLamps(1);
    view.update(sim, 1);

    expect(material.color.r).toBeGreaterThan(dayBrightness * 2);
    expect(glows.visible).toBe(true);
    expect(glows.geometry.drawRange.count).toBe(8);
    const glow = new Vector3().fromBufferAttribute(glows.geometry.getAttribute('position') as BufferAttribute, 0);
    expect(glow.distanceTo(lamp)).toBeLessThan(0.2);

    view.setLamps(0);
    view.update(sim, 1);
    expect(glows.visible).toBe(false);
    expect(material.color.r).toBe(dayBrightness);
  });

  it('lights the lamps without glows on weaker devices', () => {
    const scene = new Scene();
    const view = new TrafficView(scene, TRAFFIC_VEHICLES, 8, { lampGlows: false });
    const sim = traffic();
    sim.addVehicle(0, north, 50, 10);
    sim.update(1 / 60, truck, footprint);

    view.setLamps(1);
    view.update(sim, 1);

    expect(lampsOf(scene).count).toBe(4);
    expect(glowsOf(scene).visible).toBe(false);
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
