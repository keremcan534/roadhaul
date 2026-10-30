import { Matrix4, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { rectangleContains } from '../../../../src/data/definitions/MapDefinition';
import type { Field } from '../../../../src/domain/world/DrivingWorld';
import type { FieldWork } from '../../../../src/domain/world/fieldWork';
import { FieldWorkView } from '../../../../src/presentation/world/FieldWorkView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const FIELDS: Field[] = Array.from({ length: 10 }, (_, i) => ({
  area: { x: i * 200, z: 0, headingDegrees: 0, lengthMeters: 120, widthMeters: 50 },
  crop: 'ploughed',
}));
const WORKS: FieldWork[] = FIELDS.map((_, field) => ({ field, startMeters: field * 10, speed: 3 }));

describe('FieldWorkView', () => {
  it('draws the nearest tractors at work, each in its field, in one draw call', () => {
    const scene = new Scene();
    const view = new FieldWorkView(scene, FIELDS, WORKS);
    view.update(10, 0, 0, true);

    expect(drawCallCount(scene)).toBe(1);
    expect(view.mesh.count).toBe(5); // Within 900 m: the fields at 0 to 800.
    const matrix = new Matrix4();
    const place = new Vector3();
    for (let i = 0; i < view.mesh.count; i++) {
      view.mesh.getMatrixAt(i, matrix);
      place.setFromMatrixPosition(matrix);
      expect(FIELDS.some((field) => rectangleContains(field.area, place.x, place.z))).toBe(true);
    }
    // They move on.
    view.mesh.getMatrixAt(0, matrix);
    const before = new Vector3().setFromMatrixPosition(matrix);
    view.update(2, 0, 0, true);
    view.mesh.getMatrixAt(0, matrix);
    expect(new Vector3().setFromMatrixPosition(matrix).distanceTo(before)).toBeGreaterThan(5);
  });

  it('hides them at night, in the rain and the winter, and far from any field worked', () => {
    const scene = new Scene();
    const view = new FieldWorkView(scene, FIELDS, WORKS);
    view.update(1, 0, 0, false);
    expect(view.mesh.visible).toBe(false);
    view.update(1, 0, 5000, true);
    expect(view.mesh.count).toBe(0);
  });

  it('releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const view = new FieldWorkView(scene, FIELDS, WORKS);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);
    view.dispose();
    expect(disposed).toEqual(resources);
    expect(scene.children).toHaveLength(0);
  });
});
