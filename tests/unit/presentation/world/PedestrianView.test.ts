import {
  Box3,
  Matrix4,
  Scene,
  ShaderLib,
  UniformsUtils,
  Vector3,
  type IUniform,
  type MeshLambertMaterial,
  type WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';
import { RoadPath } from '../../../../src/domain/world/RoadPath';
import type { Sidewalk, StreetFurniture } from '../../../../src/domain/world/townscape';
import { PedestrianView, personGeometry, type TruckNearby } from '../../../../src/presentation/world/PedestrianView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

/** A street 10 m wide running east from -300 to 300, pavements along both sides, and a bus stop. */
const street = new RoadPath({
  id: 'high',
  kind: 'street',
  widthMeters: 10,
  closed: false,
  controlPoints: [
    [-300, 0],
    [300, 0],
  ],
});
const sidewalks: Sidewalk[] = [
  { roadIndex: 0, side: 1, fromMeters: 0, toMeters: 600 },
  { roadIndex: 0, side: -1, fromMeters: 0, toMeters: 600 },
];
const furniture: StreetFurniture[] = [{ kind: 'busStop', x: 0, z: -7, heading: 0, radius: 1 }];

function view(capacity = 200): { scene: Scene; people: PedestrianView } {
  const scene = new Scene();
  return { scene, people: new PedestrianView(scene, [street], sidewalks, furniture, { capacity }) };
}

/** Where each person drawn stands. */
function placesOf(people: PedestrianView): Vector3[] {
  const matrix = new Matrix4();
  return Array.from({ length: people.shown }, (_, i) => {
    people.mesh.getMatrixAt(i, matrix);
    return new Vector3().setFromMatrixPosition(matrix);
  });
}

describe('PedestrianView', () => {
  it('draws the people near the camera, on the pavements, in one draw call', () => {
    const { scene, people } = view();
    const { walkers, waiting } = people.population;
    expect(walkers).toBeGreaterThan(30);
    expect(waiting).toBeGreaterThanOrEqual(1);

    people.update(0, { x: 0, z: 0 }, 1, 0);

    expect(people.shown).toBeGreaterThan(5);
    expect(drawCallCount(scene)).toBe(1);
    for (const place of placesOf(people)) {
      expect(Math.hypot(place.x, place.z)).toBeLessThanOrEqual(140 + 1e-6);
      // On a pavement, beside the street, standing on its top.
      expect(Math.abs(place.z)).toBeGreaterThan(5);
      expect(Math.abs(place.z)).toBeLessThan(5 + 2.6);
      expect(place.y).toBeCloseTo(0.17, 6);
    }
    // Far from any town, none.
    people.update(0, { x: 0, z: 2000 }, 1, 0);
    expect(people.shown).toBe(0);
  });

  it('draws no more than it holds, and fewer out in a thinner crowd', () => {
    const { people } = view(6);
    people.update(0, { x: 0, z: 0 }, 1, 0);
    expect(people.shown).toBe(6);

    const { people: town } = view();
    town.update(0, { x: 0, z: 0 }, 1, 0);
    const busy = town.shown;
    town.update(0, { x: 0, z: 0 }, 0.3, 0);
    expect(town.shown).toBeLessThan(busy);
    expect(town.shown).toBeGreaterThan(0);
  });

  it('walks them on as time goes by, and keeps them where they are while it stands still', () => {
    const { people } = view();
    people.update(0, { x: 0, z: 0 }, 1, 0);
    const before = placesOf(people);
    people.update(0, { x: 0, z: 0 }, 1, 0);
    expect(placesOf(people)).toEqual(before);

    people.update(2, { x: 0, z: 0 }, 1, 0);
    const moved = placesOf(people).filter((place, i) => before[i] !== undefined && place.distanceTo(before[i]!) > 1);
    expect(moved.length).toBeGreaterThan(0);
  });

  it('builds a person about 1.75 m tall facing +z, swinging legs and arms, an umbrella that opens in the rain', () => {
    const geometry = personGeometry();
    const bounds = new Box3().setFromBufferAttribute(geometry.getAttribute('position') as never);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    // Its head, without the umbrella over it.
    const tallest = new Box3();
    const position = geometry.getAttribute('position');
    const limb = geometry.getAttribute('limb');
    for (let i = 0; i < position.count; i++) {
      if (limb.getX(i) < 4.5) tallest.expandByPoint(new Vector3().fromBufferAttribute(position, i));
    }
    expect(tallest.max.y).toBeGreaterThan(1.7);
    expect(tallest.max.y).toBeLessThan(1.85);
    expect(geometry.getAttribute('part').count).toBe(position.count);
    expect(position.count / 3).toBeLessThan(700);

    const { people } = view();
    const material = people.mesh.material as MeshLambertMaterial;
    const shader = {
      uniforms: UniformsUtils.clone(ShaderLib.lambert.uniforms) as Record<string, IUniform>,
      vertexShader: ShaderLib.lambert.vertexShader,
      fragmentShader: ShaderLib.lambert.fragmentShader,
    };
    material.onBeforeCompile(shader as never, {} as WebGLRenderer);
    expect(shader.vertexShader).toContain('transformed = swing( transformed');
    expect(shader.vertexShader).toContain('vColor = vec4( dress, 1.0 );');
    expect(shader.vertexShader).not.toContain('#include <color_vertex>');
    people.update(0, { x: 0, z: 0 }, 1, 0.8);
    expect(shader.uniforms['umbrella']!.value).toBe(0.8);
  });

  it('jumps out of the way of a truck driving along the pavement, and drifts back once it has passed', () => {
    const { people } = view();
    people.update(0, { x: 0, z: 0 }, 1, 0);
    // Someone walking the north pavement (its middle 6.3 m north of the road's), and a truck driving along it
    // at 10 m/s from 10 m west of them.
    const walker = placesOf(people).find((place) => place.z > 5 && Math.abs(place.x) < 100)!;
    const truck: TruckNearby = { x: walker.x - 10, z: 6.3, heading: Math.PI / 2, speed: 10, rear: -2, front: 7, halfWidth: 1.25 };
    const near = (place: Vector3): boolean => place.z > 0 && Math.abs(place.x - walker.x) < 3;

    for (let i = 0; i < 10; i++) people.update(0.05, { x: 0, z: 0 }, 1, 0, truck);
    const aside = placesOf(people).filter(near);
    expect(aside.length).toBeGreaterThan(0);
    for (const place of aside) {
      // Clear of the truck's side, most of a meter at least, north or south of it.
      expect(Math.abs(place.z - 6.3)).toBeGreaterThan(1.25 + 0.8);
    }

    // Long gone: back on their way, on the pavement.
    truck.x = 900;
    for (let i = 0; i < 100; i++) people.update(0.05, { x: 0, z: 0 }, 1, 0, truck);
    for (const place of placesOf(people)) {
      expect(Math.abs(place.z)).toBeGreaterThan(5);
      expect(Math.abs(place.z)).toBeLessThan(5 + 2.6);
    }
  });

  it('releases its GPU resources on dispose', () => {
    const { scene, people } = view();
    const disposed = watchDisposal(gpuResources(scene));

    people.dispose();

    expect(disposed.size).toBe(3);
    expect(scene.children).toHaveLength(0);
  });
});
