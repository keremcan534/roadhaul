import { Box3, InstancedMesh, Matrix4, Mesh, Scene, Vector3, type BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { createRoadPoint } from '../../../../src/domain/world/RoadPath';
import { RoadFurnitureView } from '../../../../src/presentation/world/RoadFurnitureView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const world = new DrivingWorld(MAPS[0]!);

/** Where each instance of `mesh` stands. */
function placesOf(mesh: InstancedMesh): Vector3[] {
  const matrix = new Matrix4();
  return Array.from({ length: mesh.count }, (_, index) => {
    mesh.getMatrixAt(index, matrix);
    return new Vector3().setFromMatrixPosition(matrix);
  });
}

/** How far (x, z) is from the asphalt's edge of the nearest road, and that road. */
function nearestEdge(x: number, z: number): { meters: number; kind: string } {
  let best = { meters: Infinity, kind: '' };
  for (const road of world.roads) {
    const meters = road.distanceTo(x, z) - road.widthMeters / 2;
    if (meters < best.meters) {
      best = { meters, kind: road.kind };
    }
  }
  return best;
}

function nearestJunction(x: number, z: number): number {
  return Math.min(...world.network.junctions.map((junction) => Math.hypot(junction.x - x, junction.z - z)));
}

function railsOf(scene: Scene): Mesh[] {
  const rails: Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh && object.name.startsWith('road-furniture:rails:')) {
      rails.push(object);
    }
  });
  return rails;
}

describe('RoadFurnitureView', () => {
  it('stands reflector posts along both sides of rural roads and highways, on the verge, clear of junctions', () => {
    const scene = new Scene();
    const view = new RoadFurnitureView(scene, world, { postDrawMeters: Infinity });
    view.update(0, 0, 0);
    const posts = placesOf(scene.getObjectByName('road-furniture:posts') as InstancedMesh);

    expect(view.counts.posts).toBe(posts.length);
    expect(posts.length).toBeGreaterThan(100);
    for (const post of posts) {
      const edge = nearestEdge(post.x, post.z);
      expect(['rural', 'highway']).toContain(edge.kind);
      expect(edge.meters).toBeCloseTo(1.9, 1);
      expect(world.surfaceAt(post.x, post.z).name).toBe('grass');
      expect(world.isWater(post.x, post.z)).toBe(false);
      expect(nearestJunction(post.x, post.z)).toBeGreaterThan(18);
    }
    // None in town: every city street is left without.
    const streets = world.roads.filter((road) => road.kind === 'street');
    expect(streets.length).toBeGreaterThan(0);
    for (const post of posts) {
      for (const street of streets) {
        expect(street.distanceTo(post.x, post.z) - street.widthMeters / 2).toBeGreaterThan(1.5);
      }
    }
  });

  it('puts a reflector on both faces of every post, facing the traffic along the road either way', () => {
    const scene = new Scene();
    new RoadFurnitureView(scene, world, { postDrawMeters: Infinity }).update(0, 0, 0);
    const posts = scene.getObjectByName('road-furniture:posts') as InstancedMesh;
    const reflectors = scene.getObjectByName('road-furniture:reflectors') as InstancedMesh;
    expect(reflectors.count).toBe(posts.count * 2);

    const post = placesOf(posts);
    const reflector = placesOf(reflectors);
    const point = createRoadPoint();
    for (let index = 0; index < post.length; index += 17) {
      const a = reflector[index * 2]!;
      const b = reflector[index * 2 + 1]!;
      // Near the top of the post, one either side of it along the road.
      expect(a.y).toBeCloseTo(0.86, 6);
      expect(Math.hypot(a.x - post[index]!.x, a.z - post[index]!.z)).toBeLessThan(0.1);
      const road = world.roads.reduce((best, candidate) =>
        candidate.distanceTo(a.x, a.z) < best.distanceTo(a.x, a.z) ? candidate : best,
      );
      road.pointAt(road.distances[road.nearestSampleIndex(a.x, a.z)]!, point);
      const along = (b.x - a.x) * point.directionX + (b.z - a.z) * point.directionZ;
      expect(Math.abs(along)).toBeCloseTo(0.14, 2);
    }
  });

  it('draws only the posts near the truck, gathering them again as it drives on', () => {
    const scene = new Scene();
    const view = new RoadFurnitureView(scene, world);
    const posts = scene.getObjectByName('road-furniture:posts') as InstancedMesh;
    const reflectors = scene.getObjectByName('road-furniture:reflectors') as InstancedMesh;
    expect(posts.visible).toBe(false);

    const road = world.roads.find((candidate) => candidate.kind === 'rural')!;
    const point = createRoadPoint();
    road.pointAt(600, point);
    view.update(point.x, point.z, 0);
    const near = placesOf(posts);
    expect(near.length).toBeGreaterThan(8);
    expect(near.length).toBeLessThan(view.counts.posts / 3);
    expect(view.counts.drawnPosts).toBe(near.length);
    expect(reflectors.count).toBe(near.length * 2);
    for (const post of near) {
      expect(Math.hypot(post.x - point.x, post.z - point.z)).toBeLessThanOrEqual(300);
    }
    // A few meters on: the same posts; a kilometer on, others.
    view.update(point.x + 5, point.z, 1);
    expect(placesOf(posts)).toEqual(near);
    road.pointAt(1600, point);
    view.update(point.x, point.z, 0);
    for (const post of placesOf(posts)) {
      expect(Math.hypot(post.x - point.x, post.z - point.z)).toBeLessThanOrEqual(300);
    }
    expect(placesOf(posts)).not.toEqual(near);
  });

  it('lights the reflectors up in the headlights, dead ahead of the truck, and only when its lamps are on', () => {
    const scene = new Scene();
    const view = new RoadFurnitureView(scene, world);
    const material = (scene.getObjectByName('road-furniture:reflectors') as InstancedMesh).material as Mesh['material'] &
      { onBeforeCompile(shader: unknown, renderer: unknown): void; customProgramCacheKey(): string };
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <opaque_fragment>',
    };
    material.onBeforeCompile(shader, undefined);
    expect(shader.vertexShader).toContain('instanceMatrix');
    expect(shader.fragmentShader).toContain('caught');
    expect(material.customProgramCacheKey()).toBe('road-furniture-reflector');

    view.update(120, -40, Math.PI / 2);
    view.setLamps(0.8);
    const truck = shader.uniforms['truck']!.value as Vector3;
    const forward = shader.uniforms['forward']!.value as Vector3;
    expect(truck.x).toBe(120);
    expect(truck.z).toBe(-40);
    // Heading π/2 faces +x.
    expect(forward.x).toBeCloseTo(1, 9);
    expect(forward.z).toBeCloseTo(0, 9);
    expect(shader.uniforms['lamps']!.value).toBe(0.8);
  });

  it("draws the world's guard rails in steel, merged per tile, and keeps the reflector posts off them", () => {
    const scene = new Scene();
    const view = new RoadFurnitureView(scene, world, { postDrawMeters: Infinity });
    view.update(0, 0, 0);
    const rails = railsOf(scene);
    const railPosts = world.guardRails.flatMap((rail) => rail.points);

    expect(railPosts.length).toBeGreaterThan(0);
    expect(rails.length).toBe(view.counts.railTiles);
    expect(rails.length).toBeGreaterThan(0);
    let vertices = 0;
    for (const rail of rails) {
      const position = rail.geometry.getAttribute('position') as BufferAttribute;
      vertices += position.count;
      // Every tile is one mesh, within its 600 m square (and the few meters its last piece reaches out).
      const box = new Box3().setFromBufferAttribute(position);
      expect(box.max.x - box.min.x).toBeLessThan(610);
      expect(box.max.z - box.min.z).toBeLessThan(610);
      expect(box.min.y).toBeGreaterThanOrEqual(0);
      expect(box.max.y).toBeLessThan(0.9);
      // Beams, posts and the bent ends: all along the rails.
      for (let index = 0; index < position.count; index += 7) {
        const x = position.getX(index);
        const z = position.getZ(index);
        const nearest = Math.min(...railPosts.map(([railX, railZ]) => Math.hypot(railX - x, railZ - z)));
        expect(nearest).toBeLessThan(2.6);
      }
    }
    // Two faces of a folded beam per piece, a post and a spacer at each post.
    expect(vertices).toBeGreaterThan(railPosts.length * 3 * 16);
    for (const post of placesOf(scene.getObjectByName('road-furniture:posts') as InstancedMesh)) {
      expect(Math.min(...railPosts.map(([x, z]) => Math.hypot(x - post.x, z - post.z)))).toBeGreaterThan(3);
    }
  });

  it('costs two draw calls and one per rail tile, casts shadows only when asked, and frees what it made', () => {
    const plainScene = new Scene();
    new RoadFurnitureView(plainScene, world);
    expect((plainScene.getObjectByName('road-furniture:posts') as InstancedMesh).castShadow).toBe(false);

    const scene = new Scene();
    const view = new RoadFurnitureView(scene, world, { castShadows: true });
    expect(drawCallCount(scene)).toBe(2 + view.counts.railTiles);
    expect((scene.getObjectByName('road-furniture:posts') as InstancedMesh).castShadow).toBe(true);
    expect((scene.getObjectByName('road-furniture:reflectors') as InstancedMesh).castShadow).toBe(false);
    for (const rail of railsOf(scene)) {
      expect(rail.castShadow).toBe(true);
    }

    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);
    view.dispose();
    expect(scene.children).toHaveLength(0);
    expect(disposed.size).toBe(resources.size);
  });
});
