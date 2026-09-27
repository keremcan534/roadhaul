import { InstancedMesh, Matrix4, MeshBasicMaterial, Points, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DebrisSimulation } from '../../../../src/domain/crash/DebrisSimulation';
import { KNOCKABLES, knockableCode } from '../../../../src/domain/crash/knockables';
import type { StreetLamp } from '../../../../src/domain/world/DrivingWorld';
import { STREET_LAMP_REACH_METERS, StreetLampView } from '../../../../src/presentation/world/StreetLampView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

/** Two lamps either side of a road along the X axis, their arms reaching over it. */
const LAMPS: readonly StreetLamp[] = [
  { x: 10, z: 6.8, heading: Math.PI, radius: 0.18 },
  { x: 36, z: -6.8, heading: 0, radius: 0.18 },
];

function meshes(scene: Scene): InstancedMesh[] {
  const found: InstancedMesh[] = [];
  scene.traverse((object) => {
    if (object instanceof InstancedMesh) found.push(object);
  });
  return found;
}

function glowsOf(scene: Scene): Points {
  let glows: Points | undefined;
  scene.traverse((object) => {
    if (object instanceof Points) glows = object;
  });
  return glows!;
}

/** What is drawn now: visible meshes and points whose parents are shown too. */
function shownDrawCalls(scene: Scene): number {
  let count = 0;
  scene.traverseVisible((object) => {
    if (object instanceof InstancedMesh || object instanceof Points) count++;
  });
  return count;
}

describe('StreetLampView', () => {
  it('draws every lamp in two draw calls by day', () => {
    const scene = new Scene();
    new StreetLampView(scene, LAMPS);

    expect(shownDrawCalls(scene)).toBe(2);
    expect(meshes(scene).every((mesh) => mesh.count === LAMPS.length)).toBe(true);
  });

  it('stands each post at its lamp, the head hanging over the road', () => {
    const scene = new Scene();
    new StreetLampView(scene, LAMPS);
    const [posts] = meshes(scene);
    const matrix = new Matrix4();
    const foot = new Vector3();
    const head = new Vector3();

    LAMPS.forEach((lamp, index) => {
      posts!.getMatrixAt(index, matrix);
      foot.set(0, 0, 0).applyMatrix4(matrix);
      head.set(0, 0, STREET_LAMP_REACH_METERS).applyMatrix4(matrix);
      expect(foot.x).toBeCloseTo(lamp.x, 6);
      expect(foot.z).toBeCloseTo(lamp.z, 6);
      // Toward the road's centreline (z = 0).
      expect(Math.abs(head.z)).toBeCloseTo(Math.abs(lamp.z) - STREET_LAMP_REACH_METERS, 6);
      expect(head.x).toBeCloseTo(lamp.x, 6);
    });
  });

  it('lights the lenses at night, with glows', () => {
    const scene = new Scene();
    const view = new StreetLampView(scene, LAMPS);
    const lens = meshes(scene)[1]!.material as MeshBasicMaterial;
    const dayLens = lens.color.clone();

    view.setLamps(1);

    expect(shownDrawCalls(scene)).toBe(3);
    expect(lens.color.r + lens.color.g + lens.color.b).toBeGreaterThan(dayLens.r + dayLens.g + dayLens.b + 0.5);
    expect(glowsOf(scene).geometry.drawRange.count).toBe(LAMPS.length);

    view.setLamps(0);
    expect(shownDrawCalls(scene)).toBe(2);
    expect(lens.color.equals(dayLens)).toBe(true);
  });

  it('says where each lamp\'s light comes from (under its head, over the road, where its glow is) and the way it faces', () => {
    const scene = new Scene();
    const view = new StreetLampView(scene, LAMPS);
    const glows = glowsOf(scene).geometry.getAttribute('position');

    const lights = view.lampLights();

    expect(lights).toHaveLength(LAMPS.length);
    lights.forEach(({ x, y, z, facingX, facingZ }, index) => {
      const lamp = LAMPS[index]!;
      expect(x).toBeCloseTo(lamp.x, 6);
      // Toward the road's centreline (z = 0), high over it, facing it.
      expect(Math.abs(z)).toBeCloseTo(Math.abs(lamp.z) - STREET_LAMP_REACH_METERS, 6);
      expect(y).toBeGreaterThan(6);
      expect(facingX).toBeCloseTo(0, 9);
      expect(facingZ).toBeCloseTo(-Math.sign(lamp.z), 9);
      expect(glows.getX(index)).toBeCloseTo(x, 5);
      expect(glows.getY(index)).toBeCloseTo(y, 5);
      expect(glows.getZ(index)).toBeCloseTo(z, 5);
    });
    // Without glows (the low preset) the lamps still light the road.
    expect(new StreetLampView(new Scene(), LAMPS, { lampGlows: false }).lampLights()).toEqual(lights);
  });

  it('leaves the glows out when the quality preset does', () => {
    const scene = new Scene();
    const view = new StreetLampView(scene, LAMPS, { lampGlows: false });

    view.setLamps(1);

    expect(drawCallCount(scene)).toBe(2);
    expect(shownDrawCalls(scene)).toBe(2);
  });

  it('casts the posts\' real-time shadows when asked, never the lenses\'', () => {
    const casting = (options: { castShadows?: boolean }): string[] => {
      const scene = new Scene();
      new StreetLampView(scene, LAMPS, options);
      const names: string[] = [];
      scene.traverse((object) => {
        if (object instanceof InstancedMesh && object.castShadow) names.push(object.name);
      });
      return names;
    };

    expect(casting({})).toEqual([]);
    expect(casting({ castShadows: true })).toHaveLength(1);
  });

  it('takes a lamp knocked over out of its place, its glow and its light, and puts it back once it stands', () => {
    const scene = new Scene();
    // The lamps' circles in the world: 5 and 9.
    const view = new StreetLampView(scene, LAMPS, { circles: [5, 9], debrisCapacity: 4 });
    view.setLamps(1);
    const [posts] = meshes(scene).filter((mesh) => mesh.name !== 'street-lamps:fallen');
    const knocked = new Uint8Array(12);
    const matrix = new Matrix4();
    const standing = new Matrix4();
    posts!.getMatrixAt(1, standing);

    knocked[9] = 1;
    view.showKnocked(knocked, 1);
    posts!.getMatrixAt(1, matrix);
    expect(new Vector3().setFromMatrixScale(matrix).length()).toBe(0);
    expect(Array.from(view.dark)).toEqual([0, 1]);
    // Only a change of the world's knocks is looked at.
    knocked[9] = 0;
    view.showKnocked(knocked, 1);
    expect(Array.from(view.dark)).toEqual([0, 1]);
    view.showKnocked(knocked, 2);
    posts!.getMatrixAt(1, matrix);
    expect(matrix.equals(standing)).toBe(true);
    expect(Array.from(view.dark)).toEqual([0, 0]);
  });

  it('draws the lamps lying about among the debris, and nothing else of it', () => {
    const scene = new Scene();
    const view = new StreetLampView(scene, LAMPS, { circles: [5, 9], debrisCapacity: 4 });
    const fallen = scene.getObjectByName('street-lamps:fallen') as InstancedMesh;
    const debris = new DebrisSimulation(4);
    const shape = KNOCKABLES.lamp.shape;
    const body = { ref: 9, shape, x: 36, y: shape.halfY, z: -6.8, heading: 0, vx: 0, vy: 0, vz: 0, spinX: 0, spinY: 0, spinZ: 0 };
    debris.launch({ ...body, kind: knockableCode('lamp') });
    debris.launch({ ...body, kind: knockableCode('bin') });

    view.drawDebris(debris, 1);
    expect(fallen.visible).toBe(true);
    expect(fallen.count).toBe(1);
    view.drawDebris(null, 1);
    expect(fallen.visible).toBe(false);
    // Without the lamps' circles nothing is ever knocked over.
    const plain = new Scene();
    new StreetLampView(plain, LAMPS);
    expect(plain.getObjectByName('street-lamps:fallen')).toBeUndefined();
  });

  it('draws nothing where no road is lit', () => {
    const scene = new Scene();
    const view = new StreetLampView(scene, []);
    view.setLamps(1);

    expect(drawCallCount(scene)).toBe(0);
  });

  it('releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const view = new StreetLampView(scene, LAMPS);
    view.setLamps(1);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
