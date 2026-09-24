import {
  Color,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Scene,
  ShaderMaterial,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
} from 'three';
import { describe, expect, it } from 'vitest';
import { WEATHER } from '../../../../src/data/content/weather';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { EnvironmentView } from '../../../../src/presentation/world/EnvironmentView';
import { PrelitMaterials } from '../../../../src/presentation/world/lighting';
import { SeaView } from '../../../../src/presentation/world/SeaView';
import { mapFixture, seaFixture } from '../../../support/contentFixtures';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const world = new DrivingWorld(mapFixture({ sea: seaFixture(), scenery: { seed: 3, treesPerKilometer: 0 } }));

function named(scene: Scene, name: string): Mesh {
  const mesh = scene.getObjectByName(name);
  expect(mesh, name).toBeInstanceOf(Mesh);
  return mesh as Mesh;
}

/** Whether every triangle of `geometry` faces up (+y), as seen from above. */
function facesUp(geometry: BufferGeometry): boolean {
  const position = geometry.getAttribute('position') as BufferAttribute;
  const index = geometry.getIndex()!;
  const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    if (normal.y <= 0) {
      return false;
    }
  }
  return true;
}

describe('SeaView', () => {
  it('lays the water from the shore out past the map edge, facing up', () => {
    const scene = new Scene();
    const environment = new EnvironmentView(scene);
    new SeaView(scene, world.sea!, world.halfSizeMeters, environment.sky);
    const water = named(scene, 'water');
    water.geometry.computeBoundingBox();
    const box = water.geometry.boundingBox!;

    expect(box.max.x).toBeCloseTo(-180, 6);
    expect(box.min.x).toBeLessThanOrEqual(-world.halfSizeMeters - 1000);
    expect(box.min.z).toBeLessThan(-world.halfSizeMeters);
    expect(box.max.z).toBeGreaterThan(world.halfSizeMeters);
    expect(facesUp(water.geometry)).toBe(true);
  });

  it('mirrors the sky it is given, so it follows the weather', () => {
    const scene = new Scene();
    const environment = new EnvironmentView(scene);
    new SeaView(scene, world.sea!, world.halfSizeMeters, environment.sky);
    const uniforms = (named(scene, 'water').material as ShaderMaterial).uniforms;

    expect(uniforms['horizon']).toBe(environment.sky.horizon);
    expect(uniforms['sunDirection']).toBe(environment.sky.sunDirection);
    const night = WEATHER.find((weather) => weather.id === 'night')!.look;
    environment.applyWeather(night, night, 1);
    expect((uniforms['horizon']!.value as { getHex(): number }).getHex()).toBe(night.horizonColor);
    expect((named(scene, 'water').material as ShaderMaterial).fog).toBe(true);
  });

  it('moves the waves on with time, and holds them while it stands still', () => {
    const scene = new Scene();
    const view = new SeaView(scene, world.sea!, world.halfSizeMeters, new EnvironmentView(new Scene()).sky);
    const time = (named(scene, 'water').material as ShaderMaterial).uniforms['time']!;

    view.update(0.5);
    view.update(0.25);
    expect(time.value).toBeCloseTo(0.75, 9);
    view.update(0);
    expect(time.value).toBeCloseTo(0.75, 9);
  });

  it('runs a sandy beach along the natural shore, broken at the quay, pre-lit like the ground', () => {
    const scene = new Scene();
    const prelit = new PrelitMaterials();
    new SeaView(scene, world.sea!, world.halfSizeMeters, new EnvironmentView(new Scene()).sky, { prelit });
    const beach = named(scene, 'beach');
    const position = beach.geometry.getAttribute('position') as BufferAttribute;

    expect(facesUp(beach.geometry)).toBe(true);
    for (let i = 0; i < position.count; i++) {
      expect(position.getX(i)).toBeGreaterThanOrEqual(-180 - 1e-6);
      expect(position.getX(i)).toBeLessThanOrEqual(-180 + 9 + 1e-6);
      // The quay runs from z −30 to 30: no sand on it.
      expect(Math.abs(position.getZ(i)) >= 30 - 1e-6).toBe(true);
    }
    const material = beach.material as MeshBasicMaterial;
    const daylight = material.color.r;
    prelit.setLight(new Color(0.5, 0.5, 0.5), 0.5);
    expect(material.color.r).toBeCloseTo(daylight * 0.5, 9);
  });

  it('puts the boulders in stretches of shore, each drawn only when in view', () => {
    const scene = new Scene();
    new SeaView(scene, world.sea!, world.halfSizeMeters, new EnvironmentView(new Scene()).sky);
    const tiles: InstancedMesh[] = [];
    scene.traverse((object) => {
      if (object instanceof InstancedMesh) tiles.push(object);
    });

    expect(tiles.reduce((sum, tile) => sum + tile.count, 0)).toBe(world.sea!.rocks.length);
    for (const tile of tiles) {
      expect(tile.frustumCulled).toBe(true);
      expect(tile.boundingSphere).not.toBeNull();
    }
    // The water, the beach and the boulders.
    expect(drawCallCount(scene)).toBe(2 + tiles.length);
  });

  it('releases every GPU resource and leaves the scene on dispose', () => {
    const scene = new Scene();
    const view = new SeaView(scene, world.sea!, world.halfSizeMeters, new EnvironmentView(new Scene()).sky);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
