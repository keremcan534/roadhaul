import { Mesh, MeshBasicMaterial, Scene, ShaderMaterial, Vector3, type BufferAttribute, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import type { RiverDefinition } from '../../../../src/data/definitions/MapDefinition';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { RIVER_WATER_DEPTH_METERS } from '../../../../src/domain/world/RiverPath';
import { EnvironmentView } from '../../../../src/presentation/world/EnvironmentView';
import { RiverView } from '../../../../src/presentation/world/RiverView';
import { mapFixture } from '../../../support/contentFixtures';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

/** A river 20 m wide flowing south along x = 40, under the fixture's east-west road. */
const river: RiverDefinition = {
  id: 'test_river',
  widthMeters: 20,
  points: [
    [40, 200],
    [40, 0],
    [40, -200],
  ],
};
const world = new DrivingWorld(mapFixture({ rivers: [river] }));

function build(target: DrivingWorld): { scene: Scene; view: RiverView; bank: MeshBasicMaterial } {
  const scene = new Scene();
  const environment = new EnvironmentView(new Scene());
  const bank = new MeshBasicMaterial();
  const view = new RiverView(scene, target, { sky: environment.sky, bankMaterial: bank, groundSizeMeters: 1000 });
  return { scene, view, bank };
}

function meshes(scene: Scene, name: string): Mesh[] {
  const found: Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh && object.name === name) {
      found.push(object);
    }
  });
  return found;
}

function positions(geometry: BufferGeometry): Vector3[] {
  const position = geometry.getAttribute('position') as BufferAttribute;
  return Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position, i));
}

/** Whether every triangle of `geometry` faces up (+y), as seen from above. */
function facesUp(geometry: BufferGeometry): boolean {
  const points = positions(geometry);
  const index = geometry.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [points[index.getX(i)]!, points[index.getX(i + 1)]!, points[index.getX(i + 2)]!];
    if (b.clone().sub(a).cross(c.clone().sub(a)).y <= 0) {
      return false;
    }
  }
  return true;
}

describe('RiverView', () => {
  it('lays each stretch of the channel in two draw calls, and all the bridges in one', () => {
    const region = new DrivingWorld(MAPS[0]!);
    const { scene } = build(region);
    const banks = meshes(scene, 'river-banks');

    expect(banks.length).toBeGreaterThan(1);
    expect(meshes(scene, 'river-water')).toHaveLength(banks.length);
    expect(meshes(scene, 'bridges')).toHaveLength(1);
    expect(drawCallCount(scene)).toBe(banks.length * 2 + 1);
  });

  it('sinks the water below the fields, between banks that slope up to them', () => {
    const { scene, bank } = build(world);
    const opening = world.rivers[0]!.openingHalfWidthMeters;
    for (const water of meshes(scene, 'river-water')) {
      expect(facesUp(water.geometry)).toBe(true);
      for (const point of positions(water.geometry)) {
        expect(point.y).toBeCloseTo(-RIVER_WATER_DEPTH_METERS, 6);
        expect(Math.abs(point.x - 40)).toBeLessThan(river.widthMeters / 2 + 1);
      }
    }
    for (const banks of meshes(scene, 'river-banks')) {
      expect(banks.material).toBe(bank);
      expect(facesUp(banks.geometry)).toBe(true);
      for (const point of positions(banks.geometry)) {
        expect(point.y).toBeLessThanOrEqual(0);
        expect(point.y).toBeGreaterThanOrEqual(-RIVER_WATER_DEPTH_METERS - 1e-6);
        // Level with the fields only at the rim.
        if (point.y > -1e-6) {
          expect(Math.abs(point.x - 40)).toBeCloseTo(opening, 6);
        }
      }
    }
  });

  it('stands the bridge\'s parapets along its deck\'s edges, and its sides down into the channel', () => {
    const { scene } = build(world);
    const [bridges] = meshes(scene, 'bridges');
    bridges!.geometry.computeBoundingBox();
    const box = bridges!.geometry.boundingBox!;
    const bridge = world.bridges[0]!;

    // The road runs east along z = 0 over the river at x = 40.
    expect(box.max.y).toBeGreaterThan(0.9);
    expect(box.max.y).toBeLessThan(1.1);
    expect(box.min.y).toBeLessThan(-0.5);
    expect(box.min.y).toBeGreaterThanOrEqual(-RIVER_WATER_DEPTH_METERS);
    expect(box.max.z).toBeCloseTo(bridge.halfWidthMeters + 0.15, 1);
    expect(box.min.z).toBeCloseTo(-bridge.halfWidthMeters - 0.15, 1);
    expect(box.min.x).toBeCloseTo(-150 + bridge.fromMeters, 1);
    expect(box.max.x).toBeCloseTo(-150 + bridge.toMeters, 1);
  });

  it('carries the ripples downstream as time goes by', () => {
    const { scene, view } = build(world);
    const [water] = meshes(scene, 'river-water');
    const time = (water!.material as ShaderMaterial).uniforms['time'] as { value: number };
    view.update(1.5);
    expect(time.value).toBeCloseTo(1.5, 9);
    view.update(3600);
    expect(time.value).toBeCloseTo(1.5, 6);
  });

  it('releases everything it made on dispose, and leaves the ground\'s material to its owner', () => {
    const { scene, view, bank } = build(new DrivingWorld(MAPS[0]!));
    const resources = gpuResources(scene);
    resources.delete(bank);
    const disposed = watchDisposal(resources);
    let bankDisposed = false;
    bank.addEventListener('dispose', () => {
      bankDisposed = true;
    });
    view.dispose();

    expect(disposed.size).toBe(resources.size);
    expect(bankDisposed).toBe(false);
    expect(scene.children).toHaveLength(0);
  });
});
