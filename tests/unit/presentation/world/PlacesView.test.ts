import { Box3, Mesh, Scene, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { PLACE_KINDS, rectangleContains, type PlaceDefinition } from '../../../../src/data/definitions/MapDefinition';
import { placeParts, PlacesView } from '../../../../src/presentation/world/PlacesView';

/** A lot 44 m along +X and 30 m across, round (200, 80): its back (+1) is toward −Z (the left of +X). */
const LOT = { x: 200, z: 80, headingDegrees: 90, lengthMeters: 44, widthMeters: 30 };
const place = (kind: PlaceDefinition['kind']): PlaceDefinition => ({ id: `test_${kind}`, kind, lot: LOT });

function meshesOf(scene: Scene): Mesh[] {
  const meshes: Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh) {
      meshes.push(object);
    }
  });
  return meshes;
}

function bounds(parts: readonly BufferGeometry[]): Box3 {
  const box = new Box3();
  for (const part of parts) {
    part.computeBoundingBox();
    box.union(part.boundingBox!);
  }
  return box;
}

describe('PlacesView', () => {
  it('draws every place in two draw calls, hidden until the truck is near one', () => {
    const scene = new Scene();
    const world = { places: PLACE_KINDS.map((kind, index) => ({ ...place(kind), lot: { ...LOT, z: LOT.z + index * 200 } })), roads: [] };
    const view = new PlacesView(scene, world);
    const root = scene.getObjectByName('places')!;

    expect(meshesOf(scene)).toHaveLength(2);
    expect(root.visible).toBe(false);
    view.showAround(LOT.x + 900, LOT.z);
    expect(root.visible).toBe(true);
    view.showAround(LOT.x + 3000, LOT.z);
    expect(root.visible).toBe(false);
    view.dispose();
    expect(scene.getObjectByName('places')).toBeUndefined();
  });

  it.each(PLACE_KINDS)('stands a %s within its lot, its back half built on and the front clear for the truck', (kind) => {
    const parts = placeParts(place(kind), 1);
    const box = bounds(parts);

    expect(parts.length).toBeGreaterThan(3);
    // Within the lot (the sign's cup reaches a little over), off the ground no lower than it.
    expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
    for (const corner of [new Vector3(box.min.x, 0, box.min.z), new Vector3(box.max.x, 0, box.max.z)]) {
      expect(rectangleContains(LOT, corner.x, corner.z, 1)).toBe(true);
    }
    // A truck stopped in the middle of the lot, 3 m either side of its line, meets nothing but the wash's portal.
    if (kind !== 'truckWash') {
      for (const part of parts) {
        part.computeBoundingBox();
        const { min, max } = part.boundingBox!;
        const reachesStrip = min.z < LOT.z + 3 && max.z > LOT.z - 3 && min.x < LOT.x + 10 && max.x > LOT.x - 10 && min.y < 4;
        expect(reachesStrip).toBe(false);
      }
    }
  });

  it('builds on the side away from the road', () => {
    const towardMinusZ = bounds(placeParts(place('diner'), 1));
    const towardPlusZ = bounds(placeParts(place('diner'), -1));

    // The diner's walls stand on the back half; the other way round, on the other.
    expect((towardMinusZ.min.z + towardMinusZ.max.z) / 2).toBeLessThan(LOT.z);
    expect((towardPlusZ.min.z + towardPlusZ.max.z) / 2).toBeGreaterThan(LOT.z);
  });
});
