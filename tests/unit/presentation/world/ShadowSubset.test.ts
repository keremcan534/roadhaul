import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshLambertMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { ShadowSubset } from '../../../../src/presentation/world/ShadowSubset';

/** Five posts 10 m apart along X, the first painted, casting shadows. */
function posts(): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(), new MeshLambertMaterial(), 5);
  mesh.name = 'posts';
  mesh.castShadow = true;
  for (let i = 0; i < 5; i++) mesh.setMatrixAt(i, new Matrix4().makeTranslation(i * 10, 0, 0));
  mesh.setColorAt(0, new Color(1, 0, 0));
  return mesh;
}

describe('ShadowSubset', () => {
  it('draws into the shadow map only the instances gathered, and nothing in the colour pass', () => {
    const source = posts();
    const subset = new ShadowSubset(source, 3);
    // The source casts nothing itself; the subset draws with its geometry, material and colours (the same shader).
    expect(source.castShadow).toBe(false);
    expect(subset.mesh.castShadow).toBe(true);
    expect(subset.mesh.name).toBe('posts:shadow');
    expect(subset.mesh.geometry).toBe(source.geometry);
    expect(subset.mesh.material).toBe(source.material);
    expect(subset.mesh.instanceColor).toBe(source.instanceColor);

    subset.begin();
    subset.copy(4);
    subset.copy(1);
    subset.end();
    expect(subset.count).toBe(2);
    const xOf = (index: number): number => {
      const matrix = new Matrix4();
      subset.mesh.getMatrixAt(index, matrix);
      return matrix.elements[12]!;
    };
    expect([xOf(0), xOf(1)]).toEqual([40, 10]);
    // Only those go to the GPU.
    expect(subset.mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 32 }]);

    // None in the colour pass: an instanced draw of none is skipped. Both while the shadow map is drawn.
    expect(subset.mesh.count).toBe(0);
    (subset.mesh.onBeforeShadow as () => void)();
    expect(subset.mesh.count).toBe(2);
    (subset.mesh.onAfterShadow as () => void)();
    expect(subset.mesh.count).toBe(0);
  });

  it("gathers no more than it holds, and frees itself without the source's colours", () => {
    const source = posts();
    const subset = new ShadowSubset(source, 3);
    subset.begin();
    for (let i = 0; i < 5; i++) subset.copy(i);
    subset.end();
    expect(subset.count).toBe(3);

    const colours = source.instanceColor;
    subset.dispose();
    expect(source.instanceColor).toBe(colours);
    expect(subset.mesh.instanceColor).toBeNull();
  });
});
