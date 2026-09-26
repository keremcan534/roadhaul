import { Box3, Color, InstancedMesh, Matrix4, Points, Quaternion, Scene, Vector3, type BufferAttribute, type MeshBasicMaterial } from 'three';
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

function shadowsOf(scene: Scene): InstancedMesh {
  return scene.getObjectByName('traffic:shadows') as InstancedMesh;
}

function glowsOf(scene: Scene): Points {
  let glows: Points | null = null;
  scene.traverse((object) => {
    if (object instanceof Points) glows = object;
  });
  return glows!;
}

describe('TrafficView', () => {
  it('draws all traffic in one draw call per kind of vehicle, one for all their lamps, one for their shadows and one for their glow at night', () => {
    const scene = new Scene();
    new TrafficView(scene, TRAFFIC_VEHICLES, 16);

    expect(drawCallCount(scene)).toBe(TRAFFIC_VEHICLES.length + 3);
    expect(glowsOf(scene).visible).toBe(false);
    for (const mesh of meshesOf(scene)) {
      expect(mesh.count).toBe(0);
      expect(mesh.frustumCulled).toBe(false);
    }
  });

  it('shapes every kind to its size, standing on the ground and facing +Z, rounded, in under 1100 triangles', () => {
    for (const type of TRAFFIC_VEHICLES) {
      const geometry = vehicleGeometry(type);
      const position = geometry.getAttribute('position') as BufferAttribute;
      const box = new Box3().setFromBufferAttribute(position);

      expect(box.min.y, type.id).toBeCloseTo(0, 1); // Tyres are 12-sided: their lowest corners sit a hair up.
      expect(box.max.y, type.id).toBeCloseTo(type.heightMeters, 1);
      // As wide as it is, but for the mirrors standing out of its sides up by the windscreen.
      expect(box.max.x - box.min.x, type.id).toBeLessThan(type.widthMeters + 0.55);
      for (let i = 0; i < position.count; i++) {
        if (position.getY(i) < 0.9) {
          expect(Math.abs(position.getX(i)), type.id).toBeLessThan(type.widthMeters / 2 + 0.03);
        }
      }
      expect(box.max.z - box.min.z, type.id).toBeLessThan(type.lengthMeters + 0.05);
      expect(box.max.z - box.min.z, type.id).toBeGreaterThan(type.lengthMeters - 0.1);
      expect(geometry.index!.count / 3, type.id).toBeLessThan(1100);
      // Every part mirrors the sky as much as it shines: glossy paint and glass, dull tyres.
      const shine = geometry.getAttribute('shine');
      expect(shine.count, type.id).toBe(geometry.getAttribute('position').count);
      const shines = new Set(Array.from(shine.array as Float32Array));
      expect([...shines].sort(), type.id).toEqual(expect.arrayContaining([0, 1]));
      geometry.dispose();
    }
  });

  it('glazes every kind: a windscreen up ahead, windows down both sides', () => {
    for (const type of TRAFFIC_VEHICLES) {
      const geometry = vehicleGeometry(type);
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const shine = geometry.getAttribute('shine');
      let ahead = 0;
      let left = 0;
      let right = 0;
      for (let i = 0; i < position.count; i++) {
        // Glass mirrors the sky fully.
        if (shine.getX(i) !== 1 || position.getY(i) < 0.8) {
          continue;
        }
        ahead += position.getZ(i) > 0 && normal.getZ(i) > 0.3 ? 1 : 0;
        left += position.getX(i) > type.widthMeters * 0.4 && normal.getX(i) > 0.9 ? 1 : 0;
        right += position.getX(i) < -type.widthMeters * 0.4 && normal.getX(i) < -0.9 ? 1 : 0;
      }
      expect(ahead, type.id).toBeGreaterThan(0);
      expect(left, type.id).toBeGreaterThan(0);
      expect(right, type.id).toBeGreaterThan(0);
      geometry.dispose();
    }
  });

  it("paints only the painted parts, and lights the buses' and minibuses' windows, the route signs and the lorries' markers at night", () => {
    for (const type of TRAFFIC_VEHICLES) {
      const geometry = vehicleGeometry(type);
      const paint = geometry.getAttribute('paint');
      const glow = geometry.getAttribute('glow');
      const color = geometry.getAttribute('color');
      expect(paint.count, type.id).toBe(geometry.getAttribute('position').count);
      let glowing = 0;
      let orange = 0;
      for (let i = 0; i < paint.count; i++) {
        // White takes the vehicle's paint; glass, tyres and trim keep their own colour.
        const white = color.getX(i) > 0.99 && color.getY(i) > 0.99 && color.getZ(i) > 0.99;
        expect(paint.getX(i), type.id).toBe(white ? 1 : 0);
        glowing += glow.getX(i) + glow.getY(i) + glow.getZ(i) > 0 ? 1 : 0;
        orange += glow.getX(i) > glow.getZ(i) * 4 ? 1 : 0;
      }
      // The bus's and the minibus's windows glow, lit from inside; the bus's route sign and the lorry's markers orange.
      expect(glowing > 0, type.id).toBe(type.kind !== 'car');
      expect(orange > 0, type.id).toBe(type.kind === 'bus' || type.kind === 'truck');
      geometry.dispose();
    }

    const scene = new Scene();
    const view = new TrafficView(scene, TRAFFIC_VEHICLES, 8);
    const material = meshesOf(scene)[0]!.material as MeshBasicMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <color_vertex>',
      fragmentShader: '#include <common>\n#include <emissivemap_fragment>',
    };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('mix( vec3( 1.0 ), instanceColor.rgb, paint )');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += vGlow * nightLights;');
    view.setLamps(0.7);
    expect(shader.uniforms['nightLights']!.value).toBe(0.7);
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
    const others = meshesOf(scene).filter((mesh) => mesh !== cars && mesh !== lampsOf(scene) && mesh !== shadowsOf(scene));
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

  it('sets every vehicle on a soft shadow a little larger than itself, turned with it', () => {
    const scene = new Scene();
    const view = new TrafficView(scene, TRAFFIC_VEHICLES, 8);
    const sim = traffic();
    const car = sim.addVehicle(0, north, 50, 10);
    sim.addVehicle(0, north, 150, 10);
    sim.update(1 / 60, truck, footprint);
    const shadows = shadowsOf(scene);
    expect((shadows.material as MeshBasicMaterial).transparent).toBe(true);
    expect((shadows.material as MeshBasicMaterial).depthWrite).toBe(false);

    view.update(sim, 1);

    expect(shadows.count).toBe(2);
    const matrix = new Matrix4();
    shadows.getMatrixAt(0, matrix);
    const position = new Vector3();
    const scale = new Vector3();
    matrix.decompose(position, new Quaternion(), scale);
    expect(position.x).toBeCloseTo(sim.x[car]!, 3);
    expect(position.z).toBeCloseTo(sim.z[car]!, 3);
    const type = TRAFFIC_VEHICLES[0]!;
    expect(scale.x).toBeGreaterThan(type.widthMeters);
    expect(scale.z).toBeGreaterThan(type.lengthMeters);
    view.update(null, 1);
    expect(shadows.count).toBe(0);
  });

  it('casts the sun\'s real-time shadows only when asked, never from the lamps or the soft shadows', () => {
    const plain = new Scene();
    const shadowed = new Scene();
    new TrafficView(plain, TRAFFIC_VEHICLES, 8);
    new TrafficView(shadowed, TRAFFIC_VEHICLES, 8, { castShadows: true });

    expect(meshesOf(plain).some((mesh) => mesh.castShadow)).toBe(false);
    const casting = meshesOf(shadowed).filter((mesh) => mesh.castShadow).map((mesh) => mesh.name);
    expect(casting).toEqual(TRAFFIC_VEHICLES.map((type) => `traffic:${type.id}`));
  });

  it('says where the headlamps of the vehicles nearest a point are, nearest first, fading out rather than popping', () => {
    const view = new TrafficView(new Scene(), TRAFFIC_VEHICLES, 8);
    const sim = traffic();
    const near = sim.addVehicle(0, north, 50, 10);
    const middle = sim.addVehicle(0, north, 150, 10);
    const far = sim.addVehicle(0, north, 160, 10);
    sim.update(1 / 60, truck, footprint);
    view.update(sim, 1);
    const lamps = Array.from({ length: 4 }, () => new Vector3());
    const forwards = Array.from({ length: 2 }, () => new Vector3());
    const strengths = [0, 0];
    const from = { x: sim.x[near]!, z: sim.z[near]! };
    const distance = (vehicle: number): number => Math.hypot(sim.x[vehicle]! - from.x, sim.z[vehicle]! - from.z);

    const found = view.headlampsNear(from.x, from.z, 160, lamps, forwards, strengths);

    expect(found).toBe(2);
    // The nearest first: its front lamps, just ahead of it, left (+X, facing +Z) then right, at the lamps' height.
    const forwardX = Math.sin(sim.heading[near]!);
    const forwardZ = Math.cos(sim.heading[near]!);
    expect(forwards[0]!.x).toBeCloseTo(forwardX, 6);
    expect(forwards[0]!.y).toBe(0);
    expect(forwards[0]!.z).toBeCloseTo(forwardZ, 6);
    const [frontLeft, frontRight] = vehicleLamps(TRAFFIC_VEHICLES[0]!);
    for (const [index, lamp] of [frontLeft!, frontRight!].entries()) {
      const at = lamps[index]!;
      const aheadMeters = (at.x - from.x) * forwardX + (at.z - from.z) * forwardZ;
      const leftMeters = (at.x - from.x) * forwardZ - (at.z - from.z) * forwardX;
      expect(aheadMeters).toBeCloseTo(lamp.glow[2], 4);
      expect(leftMeters).toBeCloseTo(lamp.glow[0], 4);
      expect(at.y).toBeCloseTo(lamp.glow[1], 6);
    }
    expect(strengths[0]).toBe(1);
    // The farthest shown makes way for the next one out as it comes as near: half-way there, 10 m of 20 apart.
    const second = lamps[2]!.clone().add(lamps[3]!).multiplyScalar(0.5);
    expect(Math.hypot(second.x - sim.x[middle]!, second.z - sim.z[middle]!)).toBeLessThan(TRAFFIC_VEHICLES[0]!.lengthMeters);
    expect(strengths[1]).toBeCloseTo(Math.min(1, (distance(far) - distance(middle)) / 20), 4);
    expect(strengths[1]).toBeGreaterThan(0);
    expect(strengths[1]).toBeLessThan(1);

    // Only those within reach, fading toward it.
    expect(view.headlampsNear(from.x, from.z, distance(middle) + 5, lamps, forwards, strengths)).toBe(2);
    expect(strengths[1]).toBeCloseTo(5 / 20, 4);
    expect(view.headlampsNear(from.x, from.z, 20, lamps, forwards, strengths)).toBe(1);
    expect(strengths[0]).toBeCloseTo(1, 4);
    // As many as asked for; none without traffic.
    expect(view.headlampsNear(from.x, from.z, 500, lamps.slice(0, 2), forwards.slice(0, 1), [0])).toBe(1);
    view.update(null, 1);
    expect(view.headlampsNear(from.x, from.z, 500, lamps, forwards, strengths)).toBe(0);
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
