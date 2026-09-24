import { Color, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { rectangleContains } from '../../../../src/data/definitions/MapDefinition';
import type { Field, HayBale } from '../../../../src/domain/world/DrivingWorld';
import { FarmlandView } from '../../../../src/presentation/world/FarmlandView';
import { PrelitMaterials } from '../../../../src/presentation/world/lighting';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const FIELDS: readonly Field[] = [
  { area: { x: 0, z: 0, headingDegrees: 0, lengthMeters: 100, widthMeters: 60 }, crop: 'wheat' },
  { area: { x: 120, z: 30, headingDegrees: 30, lengthMeters: 80, widthMeters: 50 }, crop: 'ploughed' },
];
const BALES: readonly HayBale[] = [
  { x: 5, z: 6, heading: 0.2, radius: 0.8 },
  { x: -9, z: 20, heading: -0.1, radius: 0.8 },
];

function fieldMesh(scene: Scene): Mesh {
  let fields: Mesh | undefined;
  scene.traverse((object) => {
    if (object instanceof Mesh && !(object instanceof InstancedMesh)) fields = object;
  });
  return fields!;
}

describe('FarmlandView', () => {
  it('draws every field in one draw call and every bale in another', () => {
    const scene = new Scene();
    new FarmlandView(scene, FIELDS, BALES);

    expect(drawCallCount(scene)).toBe(2);
    expect((scene.getObjectByName('hay-bales') as InstancedMesh).count).toBe(BALES.length);
  });

  it('lays each field flat on its area, tinted with its crop', () => {
    const scene = new Scene();
    new FarmlandView(scene, FIELDS, []);
    const geometry = fieldMesh(scene).geometry;
    const positions = geometry.getAttribute('position');
    const colors = geometry.getAttribute('color');
    const tints = new Set<string>();

    for (let i = 0; i < positions.count; i++) {
      expect(positions.getY(i)).toBeLessThan(0.01);
      const inField = FIELDS.findIndex(({ area }) => rectangleContains(area, positions.getX(i), positions.getZ(i), 0.01));
      expect(inField).toBeGreaterThanOrEqual(0);
      tints.add(`${inField}:${new Color(colors.getX(i), colors.getY(i), colors.getZ(i)).getHexString()}`);
    }
    // One colour per field, and the wheat is more golden than the ploughed earth is.
    expect(tints.size).toBe(2);
    const [wheat, ploughed] = [0, 1].map((field) => new Color(`#${[...tints].find((tint) => tint.startsWith(`${field}:`))!.slice(2)}`));
    expect(wheat!.g).toBeGreaterThan(ploughed!.g);
  });

  it('lights the fields like the rest of the pre-lit ground', () => {
    const scene = new Scene();
    const prelit = new PrelitMaterials();
    new FarmlandView(scene, FIELDS, [], { prelit });
    const material = fieldMesh(scene).material as MeshBasicMaterial;
    const day = material.color.clone();

    prelit.setLight(new Color(0.3, 0.3, 0.4), 0.1);

    expect(material.color.r).toBeCloseTo(day.r * 0.3, 6);
  });

  it('stands each bale on the ground where it lies', () => {
    const scene = new Scene();
    new FarmlandView(scene, [], BALES);
    const bales = scene.getObjectByName('hay-bales') as InstancedMesh;
    const matrix = new Matrix4();
    const at = new Vector3();

    BALES.forEach((bale, index) => {
      bales.getMatrixAt(index, matrix);
      at.setFromMatrixPosition(matrix);
      expect(at.x).toBeCloseTo(bale.x, 6);
      expect(at.y).toBe(0);
      expect(at.z).toBeCloseTo(bale.z, 6);
    });
  });

  it('releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const view = new FarmlandView(scene, FIELDS, BALES);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
