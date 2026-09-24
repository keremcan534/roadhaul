import { Box3, Mesh, Points, Scene, Vector3, type BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { HarbourView } from '../../../../src/presentation/world/HarbourView';
import { PrelitMaterials } from '../../../../src/presentation/world/lighting';
import { mapFixture, seaFixture } from '../../../support/contentFixtures';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const world = new DrivingWorld(
  mapFixture({
    sea: seaFixture({
      boats: [
        { kind: 'coaster', x: -200, z: -90, headingDegrees: 0 },
        { kind: 'tug', x: -195, z: 0, headingDegrees: 180 },
        { kind: 'fishing', x: -230, z: 100, headingDegrees: 90 },
      ],
    }),
    scenery: { seed: 3, treesPerKilometer: 0 },
  }),
);
const sea = world.sea!;

function named(scene: Scene, name: string): Mesh {
  const mesh = scene.getObjectByName(name);
  expect(mesh, name).toBeInstanceOf(Mesh);
  return mesh as Mesh;
}

function glowsOf(scene: Scene): Points | undefined {
  let glows: Points | undefined;
  scene.traverse((object) => {
    if (object instanceof Points) glows = object;
  });
  return glows;
}

describe('HarbourView', () => {
  it('paves the quay from the water\'s edge back to its width, facing up and pre-lit', () => {
    const scene = new Scene();
    const prelit = new PrelitMaterials();
    new HarbourView(scene, sea, { prelit });
    const quays = named(scene, 'quays');
    quays.geometry.computeBoundingBox();
    const box = quays.geometry.boundingBox!;

    expect(box.min.x).toBeCloseTo(-180, 6);
    expect(box.max.x).toBeCloseTo(-155, 6);
    expect(box.min.z).toBeCloseTo(-30, 6);
    expect(box.max.z).toBeCloseTo(30, 6);
    const position = quays.geometry.getAttribute('position') as BufferAttribute;
    const index = quays.geometry.getIndex()!;
    const [a, b, c] = [0, 1, 2].map((i) => new Vector3().fromBufferAttribute(position, index.getX(i)));
    expect(b!.clone().sub(a!).cross(c!.clone().sub(a!)).y).toBeGreaterThan(0);
  });

  it('stands the cranes where their legs are solid, the jib out over the water', () => {
    const scene = new Scene();
    new HarbourView(scene, sea);
    const cranes = named(scene, 'cranes');
    cranes.geometry.computeBoundingBox();
    const box = cranes.geometry.boundingBox!;
    const crane = sea.cranes[0]!;

    // The crane at (-172, 10) faces west: its legs stand 4 m either side in x, 3.2 m either side in z.
    for (const [x, z] of [
      [-176, 6.8],
      [-168, 13.2],
    ]) {
      expect(box.containsPoint(new Vector3(x, 1, z))).toBe(true);
    }
    // The jib reaches well out over the water, high above it.
    expect(box.min.x).toBeLessThan(crane.x - 20);
    expect(box.min.x).toBeLessThan(-180);
    expect(box.max.y).toBeGreaterThan(20);
  });

  it('moors each boat where it lies, bow to its heading, and rocks it gently', () => {
    const scene = new Scene();
    const view = new HarbourView(scene, sea);

    for (const boat of sea.boats) {
      const mesh = named(scene, `boat-${boat.kind}`);
      expect(mesh.position.x).toBe(boat.x);
      expect(mesh.position.z).toBe(boat.z);
      expect(mesh.rotation.y).toBeCloseTo(boat.heading, 12);
      // Bow toward +Z in its own frame: the hull is longer than it is wide.
      mesh.geometry.computeBoundingBox();
      const size = mesh.geometry.boundingBox!.getSize(new Vector3());
      expect(size.z).toBeGreaterThan(size.x * 2);
      // It floats: part of the hull is under the water.
      expect(mesh.geometry.boundingBox!.min.y).toBeLessThan(0);
    }
    const tug = named(scene, 'boat-tug');
    const moves = new Set<string>();
    for (let i = 0; i < 20; i++) {
      view.update(0.3);
      moves.add(`${tug.position.y.toFixed(4)} ${tug.rotation.z.toFixed(4)}`);
      expect(Math.abs(tug.position.y)).toBeLessThan(0.3);
      expect(Math.abs(tug.rotation.z)).toBeLessThan(0.1);
    }
    expect(moves.size).toBeGreaterThan(10);
  });

  it('lights the masts and the jibs\' tips at night, not by day, and leaves the glow out on weaker devices', () => {
    const scene = new Scene();
    const view = new HarbourView(scene, sea);
    const glows = glowsOf(scene)!;
    // Two on the coaster, one on each other boat, one on each crane.
    expect(glows.geometry.drawRange.count).toBe(2 + 1 + 1 + sea.cranes.length);

    view.setLamps(0);
    expect(glows.visible).toBe(false);
    view.setLamps(1);
    expect(glows.visible).toBe(true);

    const plain = new Scene();
    new HarbourView(plain, sea, { lampGlows: false });
    expect(glowsOf(plain)).toBeUndefined();
  });

  it('costs a draw call for the quays, the kerbs, the cranes and each boat, and one for the glows', () => {
    const scene = new Scene();
    new HarbourView(scene, sea);

    expect(drawCallCount(scene)).toBe(3 + sea.boats.length + 1);
    const bounds = new Box3().setFromObject(named(scene, 'quay-kerbs'));
    expect(bounds.max.y).toBeLessThan(1);
  });

  it('releases every GPU resource and leaves the scene on dispose', () => {
    const scene = new Scene();
    const view = new HarbourView(scene, sea);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
