import { Box3, DoubleSide, InstancedMesh, Matrix4, Mesh, Scene, ShaderMaterial, type BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { KERB_HEIGHT_METERS } from '../../../../src/domain/world/townscape';
import { SceneryView } from '../../../../src/presentation/world/SceneryView';
import { mapFixture } from '../../../support/contentFixtures';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const world = new DrivingWorld(MAPS[0]!);

/** The view's meshes whose names start with `prefix`. */
function meshes(scene: Scene, prefix: string): Mesh[] {
  const found: Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh && object.name.startsWith(prefix)) {
      found.push(object);
    }
  });
  return found;
}

/** The matrices of an instanced mesh's instances, flattened. */
function matricesOf(mesh: InstancedMesh): number[] {
  return Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16));
}

describe('SceneryView', () => {
  it('merges what keeps still per 600 m tile, each within its square and the few meters a long piece reaches out', () => {
    const scene = new Scene();
    const view = new SceneryView(scene, world);
    const tiles = meshes(scene, 'scenery:').filter((mesh) => /^scenery:(pavement:)?-?\d+,-?\d+$/.test(mesh.name));

    expect(view.counts.tiles).toBe(tiles.filter((mesh) => !mesh.name.startsWith('scenery:pavement')).length);
    expect(view.counts.tiles).toBeGreaterThan(8);
    expect(tiles.some((mesh) => mesh.name.startsWith('scenery:pavement:'))).toBe(true);
    for (const mesh of tiles) {
      const [column, row] = mesh.name.split(':').at(-1)!.split(',').map(Number);
      const box = new Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as BufferAttribute);
      // A fence's rail, a wall's stretch or a piece of pavement is filed where its middle is.
      const reach = 60;
      expect(box.min.x).toBeGreaterThan(column! * 600 - reach);
      expect(box.max.x).toBeLessThan((column! + 1) * 600 + reach);
      expect(box.min.z).toBeGreaterThan(row! * 600 - reach);
      expect(box.max.z).toBeLessThan((row! + 1) * 600 + reach);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.5);
      expect(box.max.y).toBeLessThan(9);
    }
  });

  it("lays the pavements' flagstones level with the kerbs' tops", () => {
    const scene = new Scene();
    new SceneryView(scene, world);

    for (const mesh of meshes(scene, 'scenery:pavement:')) {
      const position = mesh.geometry.getAttribute('position') as BufferAttribute;
      for (let index = 0; index < position.count; index += 11) {
        expect(position.getY(index)).toBeCloseTo(0.03 + KERB_HEIGHT_METERS, 6);
      }
    }
  });

  it('hangs the wires between neighbouring poles, sagging, a pixel wide at least, in one draw', () => {
    const scene = new Scene();
    const view = new SceneryView(scene, world);
    const [wires] = meshes(scene, 'scenery:wires');
    const spans = world.powerLines.reduce((sum, line) => sum + line.poles.length - 1, 0);

    // Three wires a span, eight pieces each, four corners a piece.
    const position = wires!.geometry.getAttribute('position') as BufferAttribute;
    expect(position.count).toBe(spans * 3 * 8 * 4);
    expect(wires!.frustumCulled).toBe(false);
    let lowest = Infinity;
    let highest = -Infinity;
    for (let index = 0; index < position.count; index++) {
      lowest = Math.min(lowest, position.getY(index));
      highest = Math.max(highest, position.getY(index));
    }
    // From the insulators' tops, sagging less than a meter.
    expect(highest).toBeCloseTo(7.9 + 0.06 + 0.16, 5);
    expect(highest - lowest).toBeGreaterThan(0.3);
    expect(highest - lowest).toBeLessThan(1);

    const material = wires!.material as ShaderMaterial;
    expect(material.transparent).toBe(true);
    expect(material.side).toBe(DoubleSide);
    expect(material.fog).toBe(true);
    view.setViewport(1280, 720);
    expect(material.uniforms['resolution']!.value.toArray()).toEqual([1280, 720]);
    view.setViewport(0, 0);
    expect(material.uniforms['resolution']!.value.toArray()).toEqual([1, 1]);
  });

  it('puts every animal out to graze, and moves only their heads', () => {
    const scene = new Scene();
    const view = new SceneryView(scene, world);
    const sheep = world.grazers.filter((grazer) => grazer.kind === 'sheep').length;
    const cows = world.grazers.length - sheep;
    const bodies = scene.getObjectByName('scenery:sheep') as InstancedMesh;
    const heads = scene.getObjectByName('scenery:sheep-heads') as InstancedMesh;

    expect(view.counts.animals).toBe(world.grazers.length);
    expect(bodies.count).toBe(sheep);
    expect((scene.getObjectByName('scenery:cow') as InstancedMesh).count).toBe(cows);
    // Each body where its animal stands.
    const matrix = new Matrix4();
    bodies.getMatrixAt(0, matrix);
    const first = world.grazers.find((grazer) => grazer.kind === 'sheep')!;
    expect(matrix.elements[12]).toBeCloseTo(first.x, 4);
    expect(matrix.elements[14]).toBeCloseTo(first.z, 4);

    const still = { bodies: matricesOf(bodies), heads: matricesOf(heads) };
    view.update(0);
    expect(matricesOf(heads)).toEqual(still.heads);
    view.update(0.8);
    expect(matricesOf(heads)).not.toEqual(still.heads);
    expect(matricesOf(bodies)).toEqual(still.bodies);
  });

  it('costs a draw a tile, one for the wires and two a kind of animal, and casts shadows only when asked', () => {
    const scene = new Scene();
    const view = new SceneryView(scene, world, { castShadows: true });
    const pavements = meshes(scene, 'scenery:pavement:').length;

    expect(drawCallCount(scene)).toBe(view.counts.tiles + pavements + 1 + 2 * 2);
    expect(meshes(scene, 'scenery:').filter((mesh) => !mesh.name.includes('pavement') && mesh.name !== 'scenery:wires').every((mesh) => mesh.castShadow)).toBe(true);
    const plain = new Scene();
    new SceneryView(plain, world);
    expect(meshes(plain, 'scenery:').some((mesh) => mesh.castShadow)).toBe(false);
  });

  it('draws nothing for a map without the scenery, and lets it be', () => {
    const scene = new Scene();
    const view = new SceneryView(scene, new DrivingWorld(mapFixture()));

    expect(view.counts).toEqual({ tiles: 0, animals: 0 });
    expect(drawCallCount(scene)).toBe(0);
    view.update(1);
    view.dispose();
  });

  it('frees everything it made', () => {
    const scene = new Scene();
    const view = new SceneryView(scene, world);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect(scene.children).toHaveLength(0);
    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
  });
});
