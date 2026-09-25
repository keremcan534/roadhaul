import {
  Color,
  Frustum,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  type Object3D,
  ShaderLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { TrackView } from '../../../../src/presentation/world/TrackView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const world = new DrivingWorld(MAPS[0]!);

/** A mesh of building walls: their facade's material lights windows at night. */
function isFacade(object: Object3D): object is Mesh {
  return (
    object instanceof Mesh &&
    !(object instanceof InstancedMesh) &&
    object.material instanceof MeshLambertMaterial &&
    object.material.emissiveMap !== null
  );
}

describe('TrackView', () => {
  it('draws the ground, roads and buildings in a handful of draw calls, and the forest in a few per tile', () => {
    const scene = new Scene();
    new TrackView(scene, world);
    const forest = scene.getObjectByName('forest')!;
    const tiles = new Set(world.trees.map((tree) => `${Math.floor(tree.x / 600)},${Math.floor(tree.z / 600)}`));

    expect(drawCallCount(scene) - drawCallCount(forest)).toBeLessThanOrEqual(12);
    // Trunks, two crown species and shadows per tile.
    expect(drawCallCount(forest)).toBeLessThanOrEqual(4 * tiles.size);
  });

  it('keeps what the chase camera sees at the spawn well inside the mobile budget', () => {
    const scene = new Scene();
    new TrackView(scene, world);
    scene.updateMatrixWorld(true);
    const { x, z, heading } = world.spawn;
    const camera = new PerspectiveCamera(60, 2.2, 0.5, 1000);
    camera.position.set(x - Math.sin(heading) * 8, 5, z - Math.cos(heading) * 8);
    camera.lookAt(x + Math.sin(heading) * 30, 2, z + Math.cos(heading) * 30);
    camera.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    let drawCalls = 0;
    let triangles = 0;
    scene.traverse((object) => {
      if (object instanceof Mesh && frustum.intersectsObject(object)) {
        const geometry = object.geometry;
        const perCopy = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
        drawCalls++;
        triangles += perCopy * (object instanceof InstancedMesh ? object.count : 1);
      }
    });

    // ARCHITECTURE.md §11: at most ~150 draw calls and ~300k triangles in view, with room for the truck and traffic.
    expect(drawCalls).toBeLessThanOrEqual(60);
    expect(triangles).toBeLessThan(150_000);
  });

  it('paves the turning circle at each dead end with the road, in the same draw calls', () => {
    const scene = new Scene();
    new TrackView(scene, world);
    const flatMeshes: Mesh[] = [];
    scene.traverse((object) => {
      if (object instanceof Mesh && !(object instanceof InstancedMesh)) flatMeshes.push(object);
    });

    for (const circle of world.turningCircles) {
      // Some mesh has vertices all round the circle's rim, clear of the road that ends inside it.
      const rimCovered = flatMeshes.some((mesh) => {
        const positions = mesh.geometry.getAttribute('position');
        let onRim = 0;
        for (let i = 0; i < positions.count; i++) {
          const distance = Math.hypot(positions.getX(i) - circle.x, positions.getZ(i) - circle.z);
          if (Math.abs(distance - circle.radiusMeters) < 0.01) onRim++;
        }
        return onRim >= 32;
      });
      expect(rimCovered).toBe(true);
    }
  });

  it('instances every tree, with its trunk and its shadow', () => {
    const scene = new Scene();
    new TrackView(scene, world);
    let crowns = 0;
    let trunks = 0;
    let shadows = 0;
    scene.traverse((object) => {
      if (!(object instanceof InstancedMesh)) {
        return;
      }
      const material = object.material as { flatShading?: boolean; transparent?: boolean };
      // Crowns are flat-shaded and low-poly; shadows are see-through decals; trunks are 6-sided cylinders.
      if (material.flatShading === true) {
        crowns += object.count;
      } else if (material.transparent === true) {
        shadows += object.count;
      } else if (object.geometry.getAttribute('position').count > 30) {
        trunks += object.count;
      }
    });

    expect(crowns).toBe(world.trees.length); // Pines and broadleaves together.
    expect(trunks).toBe(world.trees.length);
    expect(shadows).toBe(world.trees.length);
  });

  it('draws four textured walls and a roof for every building', () => {
    const scene = new Scene();
    new TrackView(scene, world);
    let wallVertices = 0;
    scene.traverse((object) => {
      if (isFacade(object)) {
        const positions = object.geometry.getAttribute('position');
        let vertical = 0;
        for (let i = 0; i < positions.count; i += 4) {
          vertical += positions.getY(i + 2) - positions.getY(i) > 1 ? 4 : 0;
        }
        wallVertices += vertical;
      }
    });

    expect(wallVertices).toBe(world.buildings.length * 16);
  });

  it('lights windows at night, a different pattern on each wall', () => {
    const scene = new Scene();
    const view = new TrackView(scene, world);
    const facades = new Map<MeshLambertMaterial, Mesh>();
    scene.traverse((object) => {
      if (object instanceof Mesh && object.material instanceof MeshLambertMaterial && object.material.emissiveMap !== null) {
        facades.set(object.material, object);
      }
    });
    expect(facades.size).toBe(2); // Offices and warehouses.
    for (const facade of facades.keys()) {
      expect(facade.emissive.getHex()).toBe(0x000000);
      // The lit windows cover several facade tiles before they repeat.
      expect(facade.emissiveMap!.repeat.x).toBeLessThan(1);
    }

    view.setLamps(1);
    for (const facade of facades.keys()) {
      expect(facade.emissive.r).toBeGreaterThan(0.9);
    }
    view.setLamps(0);
    for (const facade of facades.keys()) {
      expect(facade.emissive.getHex()).toBe(0x000000);
    }

    // Walls start at whole facade tiles (so the facade looks the same), but not all at the same one.
    const starts = new Set<string>();
    for (const mesh of facades.values()) {
      const uv = mesh.geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i += 4) {
        expect(Number.isInteger(uv.getX(i))).toBe(true);
        expect(Number.isInteger(uv.getY(i))).toBe(true);
        starts.add(`${uv.getX(i)},${uv.getY(i)}`);
      }
    }
    expect(starts.size).toBeGreaterThan(4);
  });

  it('turns every flat ground-level surface up toward the sky', () => {
    const scene = new Scene();
    new TrackView(scene, world);
    scene.updateMatrixWorld(true);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    let checked = 0;

    scene.traverse((object) => {
      if (!(object instanceof Mesh) || object instanceof InstancedMesh || object.geometry.index === null) {
        return;
      }
      const positions = object.geometry.getAttribute('position');
      const index = object.geometry.index;
      for (let i = 0; i < Math.min(index.count, 600); i += 3) {
        a.fromBufferAttribute(positions, index.getX(i)).applyMatrix4(object.matrixWorld);
        b.fromBufferAttribute(positions, index.getX(i + 1)).applyMatrix4(object.matrixWorld);
        c.fromBufferAttribute(positions, index.getX(i + 2)).applyMatrix4(object.matrixWorld);
        if (Math.max(a.y, b.y, c.y) > 0.2) {
          continue; // Walls and roofs: not lying on the ground.
        }
        const normal = b.sub(a).cross(c.sub(a));
        expect(normal.y, 'triangle faces down and would be culled').toBeGreaterThan(0);
        checked++;
      }
    });

    expect(checked).toBeGreaterThan(100);
  });

  it('gives buildings outward-facing walls', () => {
    const scene = new Scene();
    new TrackView(scene, world);
    const building = world.buildings[0]!;
    const centre = new Vector3((building.minX + building.maxX) / 2, 0, (building.minZ + building.maxZ) / 2);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    let walls = 0;

    scene.traverse((object) => {
      if (!isFacade(object)) {
        return;
      }
      const positions = object.geometry.getAttribute('position');
      const index = object.geometry.index!;
      for (let i = 0; i < index.count; i += 3) {
        a.fromBufferAttribute(positions, index.getX(i));
        b.fromBufferAttribute(positions, index.getX(i + 1));
        c.fromBufferAttribute(positions, index.getX(i + 2));
        const inside = (point: Vector3): boolean =>
          point.x >= building.minX - 1e-6 && point.x <= building.maxX + 1e-6 && point.z >= building.minZ - 1e-6 && point.z <= building.maxZ + 1e-6;
        if (!inside(a) || !inside(b) || !inside(c)) {
          continue;
        }
        const middle = a.clone().add(b).add(c).divideScalar(3);
        const outward = middle.sub(centre).setY(0);
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        expect(normal.dot(outward)).toBeGreaterThan(0);
        walls++;
      }
    });

    expect(walls).toBe(8); // Four walls, two triangles each.
  });

  it('wets the asphalt in the rain: it darkens and mirrors the sky it is given', () => {
    const scene = new Scene();
    const horizon = { value: new Color(0x123456) };
    const view = new TrackView(scene, world, {
      sky: { zenith: { value: new Color() }, horizon, sunColor: { value: new Color() }, sunDirection: { value: new Vector3() } },
    });
    const wettable: MeshBasicMaterial[] = [];
    scene.traverse((object) => {
      if (object instanceof Mesh && object.material instanceof MeshBasicMaterial && object.material.onBeforeCompile.length > 0) {
        const probe = { uniforms: {} as Record<string, unknown>, vertexShader: '', fragmentShader: '' };
        object.material.onBeforeCompile(probe as never, undefined as never);
        if ('wetness' in probe.uniforms) {
          wettable.push(object.material);
        }
      }
    });
    // Only the asphalt: the shoulders, markings and ground stay as they are.
    expect(wettable).toHaveLength(1);
    const shader = {
      uniforms: UniformsUtils.clone(ShaderLib.basic.uniforms),
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    };
    wettable[0]!.onBeforeCompile(shader as never, undefined as never);

    expect(shader.uniforms['wetSky']).toBe(horizon);
    expect(shader.fragmentShader).toContain('wetness');
    expect(shader.fragmentShader).toContain('#include <opaque_fragment>');
    expect(shader.vertexShader).toContain('vToEye = -mvPosition.xyz;');
    expect(shader.uniforms['wetness']!.value).toBe(0);
    view.setWetness(0.7);
    expect(shader.uniforms['wetness']!.value).toBe(0.7);
  });

  it('releases every GPU resource, textures included, on dispose', () => {
    const scene = new Scene();
    const view = new TrackView(scene, world);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
