import { Matrix4, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { BirdsView } from '../../../../src/presentation/world/BirdsView';
import { mapFixture } from '../../../support/contentFixtures';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const region = new DrivingWorld(MAPS[0]!);

function positionsOf(view: BirdsView): Vector3[] {
  const matrix = new Matrix4();
  return Array.from({ length: view.mesh.count }, (_, i) => {
    view.mesh.getMatrixAt(i, matrix);
    return new Vector3().setFromMatrixPosition(matrix);
  });
}

describe('BirdsView', () => {
  it('flies flocks over the fields and gulls over the harbour, high up, in one draw call', () => {
    const scene = new Scene();
    const view = new BirdsView(scene, region);
    view.update(0.1, 0, 0);

    expect(view.mesh.count).toBe(4 * 7 + 8);
    expect(drawCallCount(scene)).toBe(1);
    for (const bird of positionsOf(view)) {
      expect(bird.y).toBeGreaterThan(9);
      expect(bird.y).toBeLessThan(30);
    }
    // The gulls (the last flock) circle over the water off the quay.
    const gulls = positionsOf(view).slice(-8);
    for (const gull of gulls) {
      expect(region.isWater(gull.x, gull.z, 0) || Math.abs(gull.x + 2180) < 60).toBe(true);
    }
  });

  it('keeps them flying round their flocks as time goes by', () => {
    const view = new BirdsView(new Scene(), region);
    view.update(0.1, 0, 0);
    const before = positionsOf(view);
    view.update(1, 0, 0);
    const after = positionsOf(view);

    before.forEach((bird, i) => {
      const moved = bird.distanceTo(after[i]!);
      expect(moved).toBeGreaterThan(1);
      expect(moved).toBeLessThan(20);
    });
  });

  it('sends them to roost at night and in the rain', () => {
    const view = new BirdsView(new Scene(), region);

    view.update(0.1, 0, 0);
    expect(view.mesh.visible).toBe(true);
    view.update(0.1, 1, 0);
    expect(view.mesh.visible).toBe(false);
    view.update(0.1, 0, 1);
    expect(view.mesh.visible).toBe(false);
  });

  it('has no birds where there are no fields or sea', () => {
    const view = new BirdsView(new Scene(), new DrivingWorld(mapFixture()));
    view.update(0.1, 0, 0);

    expect(view.mesh.count).toBe(0);
    expect(view.mesh.visible).toBe(false);
  });

  it('releases every GPU resource and leaves the scene on dispose', () => {
    const scene = new Scene();
    const view = new BirdsView(scene, region);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
