import { MeshBasicMaterial, type Material, type WebGLProperties } from 'three';
import type { RenderItem } from 'three/src/renderers/webgl/WebGLRenderLists.js';
import { describe, expect, it } from 'vitest';
import { opaqueByProgram } from '../../../src/presentation/opaqueByProgram';

/** What three.js keeps of each material: here, the program it was last drawn with. */
function propertiesOf(programs: Map<Material, number>): WebGLProperties {
  return { get: (material: Material) => ({ currentProgram: programs.has(material) ? { id: programs.get(material) } : undefined }) } as unknown as WebGLProperties;
}

function item(id: number, material: Material, z: number, renderOrder = 0, groupOrder = 0): RenderItem {
  return { id, material, z, renderOrder, groupOrder, materialVariant: 0 } as unknown as RenderItem;
}

describe('opaqueByProgram', () => {
  it('draws program by program, then material by material and near to far, after the group and render order', () => {
    const [a, b, c, d] = [new MeshBasicMaterial(), new MeshBasicMaterial(), new MeshBasicMaterial(), new MeshBasicMaterial()];
    // Made in the order a, b, c, d, but a and c share one program, b and d another.
    const sort = opaqueByProgram(propertiesOf(new Map([[a, 7], [b, 3], [c, 7], [d, 3]])));
    const items = [item(1, a, 5), item(2, b, 1), item(3, c, 2), item(4, d, 9), item(5, a, 1), item(6, c, 0, -1)];

    const order = [...items].sort(sort).map((entry) => entry.id);

    // The render order first (6), then program 3 (b, d) before program 7 (a near to far, then c).
    expect(order).toEqual([6, 2, 4, 5, 1, 3]);
  });

  it('puts what has no program yet (its first frame) first, in material order', () => {
    const [a, b] = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    const sort = opaqueByProgram(propertiesOf(new Map([[b, 4]])));
    expect([item(1, b, 0), item(2, a, 0)].sort(sort).map((entry) => entry.id)).toEqual([2, 1]);
  });
});
