import { BoxGeometry, BufferAttribute, Frustum, Matrix4, MeshLambertMaterial, OrthographicCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { TileBatch } from '../../../../src/presentation/world/TileBatch';
import { batchTiles, drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

/** A box 10 m wide standing at (x, z), in the world's coordinates as a tile's merged geometry is. */
function tileAt(x: number, z: number): BoxGeometry {
  return new BoxGeometry(10, 4, 10).translate(x, 2, z);
}

describe('TileBatch', () => {
  it('holds every tile once, in one draw, each where its vertices were', () => {
    const scene = new Scene();
    const tiles = [tileAt(0, 0), tileAt(600, 0), tileAt(0, 600)];
    const positions = tiles.map((tile) => Float32Array.from(tile.getAttribute('position').array));
    const batch = new TileBatch(tiles, new MeshLambertMaterial(), 'test:tiles');
    scene.add(batch.mesh);

    expect(batch.size).toBe(3);
    expect(drawCallCount(scene)).toBe(1);
    expect(batch.mesh.name).toBe('test:tiles');
    tiles.forEach((tile, index) => {
      const start = batch.vertexStartOf(index);
      const count = tile.getAttribute('position').count;
      expect(Array.from(batch.positions.array.slice(start * 3, (start + count) * 3))).toEqual(Array.from(positions[index]!));
    });
    // Nothing is waiting to go to the GPU again but the whole buffers on the first draw.
    for (const attribute of Object.values(batch.mesh.geometry.attributes)) {
      expect((attribute as BufferAttribute).updateRanges).toHaveLength(0);
    }
    expect(batch.mesh.geometry.index!.updateRanges).toHaveLength(0);
  });

  it('draws the tiles within reach of the camera, and in its view when given, and nothing when none is', () => {
    const batch = new TileBatch([tileAt(0, 0), tileAt(600, 0), tileAt(-600, 0)], new MeshLambertMaterial(), 'test:tiles', 400);
    const shown = (): boolean[] => batchTiles(batch.mesh).map((tile) => tile.visible);

    batch.update(0, 0);
    expect(shown()).toEqual([true, false, false]);
    expect(batch.mesh.visible).toBe(true);
    batch.update(300, 0);
    expect(shown()).toEqual([true, true, false]);

    // A camera at (300, 0) looking along +x sees the tile ahead, not the one behind.
    const camera = new OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
    camera.position.set(300, 2, 0);
    camera.lookAt(1000, 2, 0);
    camera.updateMatrixWorld(true);
    const view = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    batch.update(300, 0, view);
    expect(shown()).toEqual([false, true, false]);

    batch.update(5000, 5000);
    expect(shown()).toEqual([false, false, false]);
    expect(batch.mesh.visible).toBe(false);
  });

  it('frees its buffers', () => {
    const scene = new Scene();
    const batch = new TileBatch([tileAt(0, 0)], new MeshLambertMaterial(), 'test:tiles');
    scene.add(batch.mesh);
    const disposed = watchDisposal([batch.mesh.geometry]);
    expect(gpuResources(scene).has(batch.mesh.geometry)).toBe(true);
    batch.dispose();
    expect(scene.children).toHaveLength(0);
    expect(disposed.size).toBe(1);
  });
});
