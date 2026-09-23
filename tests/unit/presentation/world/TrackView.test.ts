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

    expect(drawCallCount(scene)).toBeLessThanOrEqual(16);
  });

  it('instances every tree, with its trunk and its shadow', () => {
    const scene = new Scene();
    new TrackView(scene, world);
    const instanceCounts: number[] = [];
    let crowns = 0;
    scene.traverse((object) => {
      if (object instanceof InstancedMesh) {
        instanceCounts.push(object.count);
      }
    });
    scene.traverse((object) => {
      // Crowns are the flat-shaded, low-poly instanced meshes.
      if (object instanceof InstancedMesh && (object.material as { flatShading?: boolean }).flatShading === true) {
        crowns += object.count;
      }
    });

    expect(instanceCounts.filter((count) => count === world.trees.length)).toHaveLength(2); // Trunks and shadows.
    expect(crowns).toBe(world.trees.length); // Pines and broadleaves together.
  });

  it('draws four textured walls and a roof for every building', () => {
    const scene = new Scene();
    new TrackView(scene, world);
    let wallVertices = 0;
    scene.traverse((object) => {
      if (object instanceof Mesh && !(object instanceof InstancedMesh) && object.geometry.getAttribute('color') !== undefined) {
        const positions = object.geometry.getAttribute('position');
        let vertical = 0;
        for (let i = 0; i < positions.count; i += 4) {
          vertical += positions.getY(i + 2) - positions.getY(i) > 1 ? 4 : 0;
        }
        wallVertices += vertical;
      }
    });

    expect(wallVertices).toBe(world.buildings.length * 16);
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
      for (let i = 0; i < Math.min(index.count, 600); i += 3) {
        a.fromBufferAttribute(positions, index.getX(i)).applyMatrix4(object.matrixWorld);
        b.fromBufferAttribute(positions, index.getX(i + 1)).applyMatrix4(object.matrixWorld);
        c.fromBufferAttribute(positions, index.getX(i + 2)).applyMatrix4(object.matrixWorld);
        if (Math.max(a.y, b.y, c.y) > 0.2) {
          continue; // Walls and roofs: not lying on the ground.
        }
        const normal = b.sub(a).cross(c.sub(a));
        expect(normal.y, 'triangle faces down and would be culled').toBeGreaterThan(0);
        checked++;
      }
    });

    expect(checked).toBeGreaterThan(100);
  });

  it('gives buildings outward-facing walls', () => {
    const scene = new Scene();
    new TrackView(scene, world);
    const building = world.buildings[0]!;
    const centre = new Vector3((building.minX + building.maxX) / 2, 0, (building.minZ + building.maxZ) / 2);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    let walls = 0;

    scene.traverse((object) => {
      if (!(object instanceof Mesh) || object instanceof InstancedMesh || object.geometry.getAttribute('color') === undefined) {
        return;
      }
      const positions = object.geometry.getAttribute('position');
      const index = object.geometry.index!;
      for (let i = 0; i < index.count; i += 3) {
        a.fromBufferAttribute(positions, index.getX(i));
        b.fromBufferAttribute(positions, index.getX(i + 1));
        c.fromBufferAttribute(positions, index.getX(i + 2));
        const inside = (point: Vector3): boolean =>
          point.x >= building.minX - 1e-6 && point.x <= building.maxX + 1e-6 && point.z >= building.minZ - 1e-6 && point.z <= building.maxZ + 1e-6;
        if (!inside(a) || !inside(b) || !inside(c)) {
          continue;
        }
        const middle = a.clone().add(b).add(c).divideScalar(3);
        const outward = middle.sub(centre).setY(0);
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        expect(normal.dot(outward)).toBeGreaterThan(0);
        walls++;
      }
    });

    expect(walls).toBe(8); // Four walls, two triangles each.
  });

  it('releases every GPU resource, textures included, on dispose', () => {
    const scene = new Scene();
    const view = new TrackView(scene, world);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
