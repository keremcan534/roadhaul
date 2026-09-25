import { InstancedMesh, Matrix4, MeshBasicMaterial, Points, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
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

  it('lights the lenses at night, with glows and pools of light on the road', () => {
    const scene = new Scene();
    const view = new StreetLampView(scene, LAMPS);
    const lens = meshes(scene)[1]!.material as MeshBasicMaterial;
    const dayLens = lens.color.clone();

    view.setLamps(1);

    expect(shownDrawCalls(scene)).toBe(4);
    expect(lens.color.r + lens.color.g + lens.color.b).toBeGreaterThan(dayLens.r + dayLens.g + dayLens.b + 0.5);
    expect(glowsOf(scene).geometry.drawRange.count).toBe(LAMPS.length);
    const pools = scene.getObjectByName('street-lamp-pools') as InstancedMesh;
    expect((pools.material as MeshBasicMaterial).opacity).toBeGreaterThan(0.3);

    view.setLamps(0);
    expect(shownDrawCalls(scene)).toBe(2);
    expect(lens.color.equals(dayLens)).toBe(true);
  });

  it('leaves the glows and pools out when the quality preset does', () => {
    const scene = new Scene();
    const view = new StreetLampView(scene, LAMPS, { lampGlows: false });

    view.setLamps(1);

    expect(drawCallCount(scene)).toBe(2);
    expect(shownDrawCalls(scene)).toBe(2);
  });

  it('casts the posts\' real-time shadows when asked, never the lenses\' or the pools\'', () => {
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
