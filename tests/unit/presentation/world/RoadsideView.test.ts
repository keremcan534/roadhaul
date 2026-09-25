import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { rectangleContains } from '../../../../src/data/definitions/MapDefinition';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { PrelitMaterials } from '../../../../src/presentation/world/lighting';
import { ROADSIDE_KINDS, RoadsideView } from '../../../../src/presentation/world/RoadsideView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const world = new DrivingWorld(MAPS[0]!);
const spawn = world.spawn;

/** Draw calls of what is shown now (hidden meshes cost none). */
function shownDrawCalls(scene: Scene): number {
  let count = 0;
  scene.traverseVisible((object) => {
    if (object instanceof InstancedMesh) count++;
  });
  return count;
}

function meshOf(scene: Scene, kind: string): InstancedMesh {
  return scene.getObjectByName(`roadside:${kind}`) as InstancedMesh;
}

/** Where each drawn plant of `kind` stands. */
function drawnPlants(scene: Scene, kind: string): Vector3[] {
  const mesh = meshOf(scene, kind);
  const matrix = new Matrix4();
  return Array.from({ length: mesh.count }, (_, index) => {
    mesh.getMatrixAt(index, matrix);
    return new Vector3().setFromMatrixPosition(matrix);
  });
}

describe('RoadsideView', () => {
  it('grows grass, flowers and bushes along the roads, on the grass only', () => {
    const scene = new Scene();
    const view = new RoadsideView(scene, world);
    view.update(spawn.x, spawn.z, 0);

    for (const kind of ROADSIDE_KINDS) {
      const { grown, drawn } = view.plants(kind);
      expect(grown, kind).toBeGreaterThan(20);
      expect(drawn, kind).toBeGreaterThan(0);
      for (const plant of drawnPlants(scene, kind)) {
        expect(world.surfaceAt(plant.x, plant.z).name, kind).toBe('grass');
        expect(world.isWater(plant.x, plant.z), kind).toBe(false);
        expect(world.fields.some((field) => rectangleContains(field.area, plant.x, plant.z)), kind).toBe(false);
        expect(
          world.buildings.some((b) => plant.x > b.minX && plant.x < b.maxX && plant.z > b.minZ && plant.z < b.maxZ),
          kind,
        ).toBe(false);
        // By a road: within its verge.
        const nearest = Math.min(...world.roads.map((road) => road.distanceTo(plant.x, plant.z) - road.widthMeters / 2));
        expect(nearest, kind).toBeLessThan(14);
      }
    }
    // Most are grass; flowers and bushes are fewer.
    expect(view.plants('tuft').grown).toBeGreaterThan(view.plants('flower').grown);
    expect(view.plants('flower').grown).toBeGreaterThan(view.plants('bush').grown);
  });

  it('draws only the plants near the camera, in three draw calls, gathering them again as it moves on', () => {
    const scene = new Scene();
    const view = new RoadsideView(scene, world);
    expect(drawCallCount(scene)).toBe(3);
    expect(shownDrawCalls(scene)).toBe(0);

    view.update(spawn.x, spawn.z, 0);
    expect(shownDrawCalls(scene)).toBe(3);
    for (const plant of drawnPlants(scene, 'tuft')) {
      expect(Math.hypot(plant.x - spawn.x, plant.z - spawn.z)).toBeLessThan(120 + 40 * 1.5);
    }
    const before = drawnPlants(scene, 'tuft')[0]!.clone();

    // A few meters on: nothing to gather; far away: other plants.
    view.update(spawn.x + 5, spawn.z, 0);
    expect(drawnPlants(scene, 'tuft')[0]!.equals(before)).toBe(true);
    const far = world.roads[world.roads.length - 1]!;
    const x = far.x(0);
    const z = far.z(0);
    view.update(x, z, 0);
    for (const plant of drawnPlants(scene, 'tuft')) {
      expect(Math.hypot(plant.x - x, plant.z - z)).toBeLessThan(120 + 40 * 1.5);
    }
  });

  it('grows the same plants whichever way the map is explored, fewer and nearer on weaker devices', () => {
    const fullScene = new Scene();
    const againScene = new Scene();
    const full = new RoadsideView(fullScene, world);
    const again = new RoadsideView(againScene, world);
    const thin = new RoadsideView(new Scene(), world, { density: 0.45 });
    const far = world.roads[world.roads.length - 1]!;

    full.update(spawn.x, spawn.z, 0);
    // Somewhere else first, then the spawn: the spawn's plants are the same.
    again.update(far.x(0), far.z(0), 0);
    again.update(spawn.x, spawn.z, 0);
    thin.update(spawn.x, spawn.z, 0);

    const sorted = (scene: Scene): string[] =>
      drawnPlants(scene, 'tuft')
        .map((plant) => `${plant.x.toFixed(2)},${plant.z.toFixed(2)}`)
        .sort();
    expect(sorted(againScene)).toEqual(sorted(fullScene));
    expect(thin.plants('tuft').drawn).toBeLessThan(full.plants('tuft').drawn * 0.6);
  });

  it('grows the plants only where the camera comes', () => {
    const view = new RoadsideView(new Scene(), world);
    expect(view.plants('tuft').grown).toBe(0);

    view.update(spawn.x, spawn.z, 0);
    const nearSpawn = view.plants('tuft').grown;
    expect(nearSpawn).toBeGreaterThan(0);
    // Back again: nothing new grows.
    const far = world.roads[world.roads.length - 1]!;
    view.update(far.x(0), far.z(0), 0);
    const both = view.plants('tuft').grown;
    view.update(spawn.x, spawn.z, 0);
    expect(view.plants('tuft').grown).toBe(both);
  });

  it('is lit like the ground and sways in the wind, the tips the most', () => {
    const scene = new Scene();
    const prelit = new PrelitMaterials();
    const view = new RoadsideView(scene, world, { prelit });
    const material = meshOf(scene, 'tuft').material as MeshBasicMaterial;
    const shader = { uniforms: {} as Record<string, { value: number }>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '' };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('position.y * position.y');
    // Grass bends more than bushes, through a uniform: every kind shares one program.
    const bush = { uniforms: {} as Record<string, { value: number }>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '' };
    (meshOf(scene, 'bush').material as MeshBasicMaterial).onBeforeCompile(bush as never, undefined as never);
    expect(shader.uniforms['windBend']!.value).toBeGreaterThan(bush.uniforms['windBend']!.value);
    const programs = new Set(ROADSIDE_KINDS.map((kind) => (meshOf(scene, kind).material as MeshBasicMaterial).customProgramCacheKey()));
    expect(programs.size).toBe(1);

    view.update(spawn.x, spawn.z, 2);
    view.update(spawn.x, spawn.z, 0.5);
    expect(shader.uniforms['windTime']!.value).toBeCloseTo(2.5, 9);
    // Registered with the ground's light: it darkens with it.
    prelit.setLight(new Color(0.5, 0.5, 0.5), 1);
    expect(material.color.r).toBeCloseTo(0.5, 6);
  });

  it('releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const view = new RoadsideView(scene, world);
    view.update(spawn.x, spawn.z, 0);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect(disposed).toEqual(resources);
    expect(scene.children).toHaveLength(0);
  });
});
