import { Mesh, MeshBasicMaterial, Scene, Vector3, type BufferAttribute, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { EnvironmentView } from '../../../../src/presentation/world/EnvironmentView';
import { ParkView } from '../../../../src/presentation/world/ParkView';
import { mapFixture } from '../../../support/contentFixtures';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const world = new DrivingWorld(
  mapFixture({
    parks: [
      { id: 'south_park', area: { x: 0, z: -100, headingDegrees: 0, lengthMeters: 60, widthMeters: 50 } },
      { id: 'turned_park', area: { x: 0, z: 100, headingDegrees: 30, lengthMeters: 50, widthMeters: 44 } },
    ],
  }),
);

function build(): { scene: Scene; view: ParkView; lawn: MeshBasicMaterial } {
  const scene = new Scene();
  const lawn = new MeshBasicMaterial();
  const view = new ParkView(scene, world.parks, { sky: new EnvironmentView(new Scene()).sky, lawnMaterial: lawn, groundSizeMeters: 1000 });
  return { scene, view, lawn };
}

function named(scene: Scene, name: string): Mesh {
  const mesh = scene.getObjectByName(name);
  expect(mesh, name).toBeInstanceOf(Mesh);
  return mesh as Mesh;
}

function points(geometry: BufferGeometry): Vector3[] {
  const position = geometry.getAttribute('position') as BufferAttribute;
  return Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position, i));
}

/** Whether every triangle of an unindexed `geometry` faces up (+y). */
function facesUp(geometry: BufferGeometry): boolean {
  const all = points(geometry);
  for (let i = 0; i < all.length; i += 3) {
    const [a, b, c] = [all[i]!, all[i + 1]!, all[i + 2]!];
    if (b.clone().sub(a).cross(c.clone().sub(a)).y <= 0) {
      return false;
    }
  }
  return true;
}

describe('ParkView', () => {
  it('draws every park in five draw calls: lawns, paths, hedges, fountains and their water', () => {
    const { scene } = build();
    expect(drawCallCount(scene)).toBe(5);
    for (const name of ['park-lawns', 'park-paths', 'park-hedges', 'park-fountains', 'park-fountain-water']) {
      named(scene, name);
    }
  });

  it('lays the lawns and the gravel flat, facing up, the gravel over the lawn and both over the ground', () => {
    const { scene, lawn } = build();
    const lawns = named(scene, 'park-lawns');
    const paths = named(scene, 'park-paths');
    expect(lawns.material).toBe(lawn);
    expect(lawn.polygonOffset).toBe(true);
    expect(facesUp(lawns.geometry)).toBe(true);
    expect(facesUp(paths.geometry)).toBe(true);
    const lawnY = Math.max(...points(lawns.geometry).map((point) => point.y));
    const gravelY = Math.min(...points(paths.geometry).map((point) => point.y));
    expect(lawnY).toBeGreaterThan(0);
    expect(gravelY).toBeGreaterThan(lawnY);
    // Everything flat stays under the roads' shoulders.
    expect(Math.max(...points(paths.geometry).map((point) => point.y))).toBeLessThan(0.01);
    // Each lawn fills its park: two parks' worth of area.
    lawns.geometry.computeBoundingBox();
    expect(lawns.geometry.boundingBox!.min.z).toBeCloseTo(-130, 6);
  });

  it('stands the hedges and fountains up, the water in the basins', () => {
    const { scene } = build();
    const hedges = points(named(scene, 'park-hedges').geometry);
    expect(Math.max(...hedges.map((point) => point.y))).toBeGreaterThan(0.9);
    const stone = points(named(scene, 'park-fountains').geometry);
    const water = points(named(scene, 'park-fountain-water').geometry);
    const waterLevel = water[0]!.y;
    expect(water.every((point) => Math.abs(point.y - waterLevel) < 1e-6)).toBe(true);
    expect(waterLevel).toBeGreaterThan(0.2);
    // The basin's rim stands over the water, the column higher still.
    expect(Math.max(...stone.map((point) => point.y))).toBeGreaterThan(1.5);
    for (const park of world.parks) {
      const inside = water.filter((point) => Math.hypot(point.x - park.fountain.x, point.z - park.fountain.z) < park.fountain.radius);
      expect(inside.length).toBeGreaterThan(10);
    }
  });

  it('carries the fountains\' ripples on as time goes by', () => {
    const { scene, view } = build();
    const water = named(scene, 'park-fountain-water').material as unknown as { uniforms: Record<string, { value: number }> };
    view.update(2);
    expect(water.uniforms['time']!.value).toBeCloseTo(2, 9);
  });

  it('draws nothing for a world without parks', () => {
    const scene = new Scene();
    new ParkView(scene, [], { sky: new EnvironmentView(new Scene()).sky, lawnMaterial: new MeshBasicMaterial(), groundSizeMeters: 1000 });
    expect(drawCallCount(scene)).toBe(0);
  });

  it('releases everything it made on dispose, and leaves the lawns\' material to its owner', () => {
    const { scene, view, lawn } = build();
    const resources = gpuResources(scene);
    resources.delete(lawn);
    const disposed = watchDisposal(resources);
    view.dispose();
    expect(disposed.size).toBe(resources.size);
    expect(scene.children).toHaveLength(0);
  });
});
