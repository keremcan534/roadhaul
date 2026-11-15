import { Box3, Mesh, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { HeadOfficeView } from '../../../../src/presentation/world/HeadOfficeView';
import { gpuResources, watchDisposal } from '../../../support/threeResources';

/** A 48 × 36 m site at (100, -50), its length along +X. */
const SITE = { x: 100, z: -50, headingDegrees: 90, lengthMeters: 48, widthMeters: 36 };
const NONE = (): number => 0;

function meshesOf(scene: Scene): Mesh[] {
  const meshes: Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh) {
      meshes.push(object);
    }
  });
  return meshes;
}

describe('HeadOfficeView', () => {
  it('stands the main office on the fenced site at first, in two draw calls, all within the site', () => {
    const scene = new Scene();
    const view = new HeadOfficeView(scene, SITE, 2);
    view.setLevels(NONE, 0x2f6d4a);

    expect(meshesOf(scene)).toHaveLength(2);
    expect(view.buildingVertices).toBeGreaterThan(0);
    scene.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(scene);
    // The site runs 48 m along X (its heading) and 36 m along Z, round (100, -50), from the ground at y 2.
    expect(bounds.min.x).toBeGreaterThanOrEqual(100 - 24 - 0.1);
    expect(bounds.max.x).toBeLessThanOrEqual(100 + 24 + 0.1);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-50 - 18 - 0.1);
    expect(bounds.max.z).toBeLessThanOrEqual(-50 + 18 + 0.1);
    expect(bounds.min.y).toBeCloseTo(2, 6);
  });

  it('raises a building for each facility built, bigger with each level, within the site', () => {
    const scene = new Scene();
    const view = new HeadOfficeView(scene, SITE, 0);
    view.setLevels(NONE, 0x2f6d4a);
    const alone = view.buildingVertices;

    let previous = alone;
    for (const level of [1, 2, 3]) {
      view.setLevels(() => level, 0x2f6d4a);
      expect(view.buildingVertices, `level ${level}`).toBeGreaterThan(previous);
      previous = view.buildingVertices;
    }
    scene.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(scene);
    expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(48 + 0.2);
    expect(bounds.max.z - bounds.min.z).toBeLessThanOrEqual(36 + 0.2);
    // The dispatch office's tower and its aerial stand tallest.
    expect(bounds.max.y).toBeGreaterThan(5 * 3.2);
  });

  it('builds again only when a level or the colour changes, releasing what it drew before', () => {
    const scene = new Scene();
    const view = new HeadOfficeView(scene, SITE, 0);
    view.setLevels(NONE, 0x2f6d4a);
    const buildings = meshesOf(scene).find((mesh) => mesh.name === 'head-office:buildings')!;
    const first = buildings.geometry;
    const disposed = watchDisposal([first]);

    view.setLevels(NONE, 0x2f6d4a);
    expect(buildings.geometry).toBe(first);
    view.setLevels((id) => (id === 'warehouse' ? 1 : 0), 0x2f6d4a);
    expect(buildings.geometry).not.toBe(first);
    expect(disposed.has(first)).toBe(true);
  });

  it('hides past the world tiles\' reach, and releases its GPU resources on dispose', () => {
    const scene = new Scene();
    const view = new HeadOfficeView(scene, SITE, 0);
    view.setLevels(() => 2, 0x2f6d4a);
    const root = scene.getObjectByName('head-office')!;
    view.showAround(100, 900);
    expect(root.visible).toBe(true);
    view.showAround(100, 1200);
    expect(root.visible).toBe(false);

    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);
    view.dispose();
    expect(disposed.size).toBe(resources.size);
    expect(scene.children).toHaveLength(0);
  });
});
