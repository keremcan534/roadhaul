import { InstancedMesh, Mesh, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { TrackView } from '../../../../src/presentation/world/TrackView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const world = new DrivingWorld(MAPS[0]!);

describe('TrackView', () => {
  it('draws the whole track in a handful of draw calls', () => {
    const scene = new Scene();
    new TrackView(scene, world);

    expect(drawCallCount(scene)).toBeLessThanOrEqual(12);
  });

  it('instances every tree and building', () => {
    const scene = new Scene();
    new TrackView(scene, world);
    const instanceCounts: number[] = [];
    scene.traverse((object) => {
      if (object instanceof InstancedMesh) {
        instanceCounts.push(object.count);
      }
    });

    expect(instanceCounts).toContain(world.trees.length);
    expect(instanceCounts).toContain(world.buildings.length);
  });

  it('turns every flat ground-level surface up toward the sky', () => {
    const scene = new Scene();
    new TrackView(scene, world);
    scene.updateMatrixWorld(true);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    let checked = 0;

    scene.traverse((object) => {
      if (!(object instanceof Mesh) || object instanceof InstancedMesh || object.geometry.index === null) {
        return;
      }
      const positions = object.geometry.getAttribute('position');
      const index = object.geometry.index;
      for (let i = 0; i < Math.min(index.count, 300); i += 3) {
        a.fromBufferAttribute(positions, index.getX(i)).applyMatrix4(object.matrixWorld);
        b.fromBufferAttribute(positions, index.getX(i + 1)).applyMatrix4(object.matrixWorld);
        c.fromBufferAttribute(positions, index.getX(i + 2)).applyMatrix4(object.matrixWorld);
        const normal = b.sub(a).cross(c.sub(a));
        expect(normal.y, 'triangle faces down and would be culled').toBeGreaterThan(0);
        checked++;
      }
    });

    expect(checked).toBeGreaterThan(100);
  });

  it('releases every GPU resource and restores the scene on dispose', () => {
    const scene = new Scene();
    const view = new TrackView(scene, world);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
  });
});
