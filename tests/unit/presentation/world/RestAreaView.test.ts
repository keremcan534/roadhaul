import { Box3, Mesh, MeshLambertMaterial, Scene, Vector3, type BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { rectangleContains } from '../../../../src/data/definitions/MapDefinition';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { RestAreaView } from '../../../../src/presentation/world/RestAreaView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const world = new DrivingWorld(MAPS[0]!);
const [restArea] = world.restAreas;

/** The fuel station's structures: the only lit mesh. */
function stationOf(scene: Scene): Mesh {
  let station: Mesh | undefined;
  scene.traverse((object) => {
    if (object instanceof Mesh && object.material instanceof MeshLambertMaterial) {
      station = object;
    }
  });
  return station!;
}

describe('RestAreaView', () => {
  it('draws every rest area in three draw calls', () => {
    const scene = new Scene();
    new RestAreaView(scene, world);

    expect(drawCallCount(scene)).toBe(3);
  });

  it('keeps the canopy, pumps and sign on the lot, in its back half, clear of a truck parked in the middle', () => {
    const scene = new Scene();
    new RestAreaView(scene, world);
    const positions = stationOf(scene).geometry.getAttribute('position');
    const lot = restArea!.lot;
    const heading = (lot.headingDegrees * Math.PI) / 180;
    const point = new Vector3();
    const acrossOffsets: number[] = [];

    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      expect(rectangleContains(lot, point.x, point.z, 0.2)).toBe(true);
      if (point.y < 6) {
        // Below the canopy roof: posts, pumps, the sign.
        acrossOffsets.push((point.x - lot.x) * Math.cos(heading) - (point.z - lot.z) * Math.sin(heading));
      }
    }
    // The roof is high above any truck; everything under it stands at least 4 m from the lot's centre line,
    // where a parked truck (2.6 m wide) sits.
    const box = new Box3().setFromBufferAttribute(positions as BufferAttribute);
    expect(box.max.y).toBeGreaterThan(6);
    expect(acrossOffsets.filter((offset) => Math.abs(offset) < 4)).toEqual([]);
  });

  it('releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const view = new RestAreaView(scene, world);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
