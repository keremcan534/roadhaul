import { Box3, Mesh, MeshLambertMaterial, Scene, Vector3, type BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import type { CitySign } from '../../../../src/domain/world/DrivingWorld';
import { CitySignView } from '../../../../src/presentation/world/CitySignView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

/** Boards either side of a road along the X axis: one facing west, one facing east. Two share a city. */
const SIGNS: readonly CitySign[] = [
  { cityId: 'city_a', x: -130, z: 9.6, heading: -Math.PI / 2 },
  { cityId: 'city_b', x: 140, z: -9.6, heading: Math.PI / 2 },
  { cityId: 'city_a', x: 0, z: 40, heading: 0 },
];
const NAMES: Readonly<Record<string, string>> = { city_a: 'Yeniliman', city_b: 'Demirkent' };
const nameOf = (cityId: string): string => NAMES[cityId]!;

function faceMesh(scene: Scene): Mesh {
  let face: Mesh | undefined;
  scene.traverse((object) => {
    if (object instanceof Mesh && (object.material as MeshLambertMaterial).map !== null) face = object;
  });
  return face!;
}

describe('CitySignView', () => {
  it('draws every board in two draw calls: frames, and faces sharing one texture', () => {
    const scene = new Scene();
    new CitySignView(scene, SIGNS, nameOf);

    expect(drawCallCount(scene)).toBe(2);
    // One row per name: two cities.
    const texture = (faceMesh(scene).material as MeshLambertMaterial).map!;
    expect((texture.image as { height: number }).height).toBe(2 * 160);
  });

  it('stands each board on its sign, above head height, its face turned the way the sign faces', () => {
    const scene = new Scene();
    new CitySignView(scene, SIGNS.slice(0, 1), nameOf);
    const face = faceMesh(scene).geometry;
    const box = new Box3().setFromBufferAttribute(face.getAttribute('position') as BufferAttribute);
    const [sign] = SIGNS;

    expect(box.min.y).toBeGreaterThan(2.1);
    expect(box.getCenter(new Vector3()).z).toBeCloseTo(sign!.z, 6);
    // Facing west: the face is a plane across X, just west of the board's middle, spanning Z.
    expect(box.max.x - box.min.x).toBeLessThan(0.01);
    expect(box.min.x).toBeLessThan(sign!.x);
    expect(box.max.z - box.min.z).toBeGreaterThan(5.5);
    const normal = face.getAttribute('normal');
    expect(normal.getX(0)).toBeCloseTo(-1, 6);
  });

  it('maps each face onto its city\'s row of the texture', () => {
    const scene = new Scene();
    new CitySignView(scene, SIGNS, nameOf);
    const uv = faceMesh(scene).geometry.getAttribute('uv');
    // Four corners per face, in the order of the signs: A, B, A.
    const rows = [0, 1, 2].map((sign) => {
      const vs = [0, 1, 2, 3].map((corner) => uv.getY(sign * 4 + corner));
      return [Math.min(...vs), Math.max(...vs)];
    });

    expect(rows).toEqual([
      [0, 0.5],
      [0.5, 1],
      [0, 0.5],
    ]);
  });

  it('lights the faces at night, as if in the headlights', () => {
    const scene = new Scene();
    const view = new CitySignView(scene, SIGNS, nameOf);
    const material = faceMesh(scene).material as MeshLambertMaterial;

    const byDay = material.emissiveIntensity;
    view.setLamps(1);
    expect(material.emissiveIntensity).toBeGreaterThan(byDay + 0.2);
    view.setLamps(0);
    expect(material.emissiveIntensity).toBe(byDay);
  });

  it('draws nothing on a map without boards', () => {
    const scene = new Scene();
    new CitySignView(scene, [], nameOf).setLamps(1);

    expect(drawCallCount(scene)).toBe(0);
  });

  it('releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const view = new CitySignView(scene, SIGNS, nameOf);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
