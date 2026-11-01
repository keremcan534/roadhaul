import { BoxGeometry, Color, Frustum, Group, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ForestBatch } from '../../../../src/presentation/world/ForestBatch';

/** A forest tile at (x, z): `count` crowns and as many shadows, in a row, their colours by index. */
function tile(x: number, z: number, count: number): Group {
  const group = new Group();
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshBasicMaterial();
  const crowns = new InstancedMesh(geometry, material, count);
  crowns.name = 'forest:crowns:pine';
  const shadows = new InstancedMesh(geometry, material, count);
  shadows.name = 'forest:shadows';
  for (let i = 0; i < count; i++) {
    const matrix = new Matrix4().makeTranslation(x + i, 0, z);
    crowns.setMatrixAt(i, matrix);
    crowns.setColorAt(i, new Color(i / count, 0.5, 0.5));
    shadows.setMatrixAt(i, matrix);
  }
  group.add(crowns, shadows);
  return group;
}

describe('ForestBatch', () => {
  it('draws the tiles shown a kind at a time, their own meshes no longer drawn', () => {
    const tiles = [tile(0, 0, 3), tile(100, 0, 2), tile(200, 0, 4)];
    const parent = new Group();
    const batch = new ForestBatch(tiles, parent);
    expect(batch.batches.map((mesh) => mesh.name).sort()).toEqual(['forest:crowns:pine:batch', 'forest:shadows:batch']);
    for (const group of tiles) {
      for (const mesh of group.children) {
        expect(mesh.layers.mask).toBe(0);
      }
    }

    tiles[1]!.visible = false;
    batch.update();
    const crowns = batch.batches.find((mesh) => mesh.name === 'forest:crowns:pine:batch')!;
    expect(crowns.count).toBe(7);
    // The first tile's then the third's, as they were.
    const at = new Matrix4();
    const position = new Vector3();
    crowns.getMatrixAt(3, at);
    expect(position.setFromMatrixPosition(at).x).toBe(200);
    const color = new Color();
    crowns.getColorAt(1, color);
    expect(color.r).toBeCloseTo(1 / 3, 6);

    // A shadow's detail hidden in one tile: only its shadows leave.
    (tiles[2]!.children[1] as InstancedMesh).visible = false;
    batch.update();
    expect(crowns.count).toBe(7);
    expect(batch.batches.find((mesh) => mesh.name === 'forest:shadows:batch')!.count).toBe(3);
  });

  it('leaves out the tiles out of the camera\'s view, and nothing when none is shown', () => {
    const tiles = [tile(0, 0, 3), tile(0, -400, 3)];
    const batch = new ForestBatch(tiles, new Group());
    const camera = new PerspectiveCamera(60, 1, 0.5, 1000);
    camera.position.set(1, 5, 30);
    camera.lookAt(1, 0, 0); // Looking at the first tile, the second far behind it out of the frame's sides? Straight on.
    camera.updateMatrixWorld(true);
    const view = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    camera.lookAt(1, 0, 60); // Turned round: neither in view.
    camera.updateMatrixWorld(true);
    const behind = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));

    batch.update(view);
    const crowns = batch.batches[0]!;
    expect(crowns.count).toBe(6);
    batch.update(behind);
    expect(crowns.count).toBe(0);
    expect(crowns.visible).toBe(false);
  });
});
