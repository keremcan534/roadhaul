import { PerspectiveCamera, Scene, Vector3, type InstancedBufferAttribute, type InstancedBufferGeometry, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { WetReflections, type LampMirror, type MirroredLamps } from '../../../../src/presentation/world/WetReflections';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

/** A camera 3 m up at the origin, looking along +z (level). */
function camera(): PerspectiveCamera {
  const eye = new PerspectiveCamera();
  eye.position.set(0, 3, 0);
  eye.lookAt(new Vector3(0, 3, 10));
  return eye;
}

/** Lamps for the mirror to take, each as `add` is given it. */
function lamps(...added: Parameters<LampMirror['add']>[]): MirroredLamps {
  return {
    mirrorLamps(into) {
      for (const lamp of added) {
        into.add(...lamp);
      }
    },
  };
}

/** What the mirror was given this frame: per lamp its place (x, y, z), its kind (0 street, 1 head, 2 tail) and its light. */
function mirrored(reflections: WetReflections): { x: number; y: number; z: number; kind: number; light: number }[] {
  const geometry = reflections.mesh.geometry as InstancedBufferGeometry;
  const lamp = geometry.getAttribute('lamp') as InstancedBufferAttribute;
  const aim = geometry.getAttribute('aim') as InstancedBufferAttribute;
  return Array.from({ length: reflections.lampCount }, (_, i) => ({
    x: lamp.getX(i),
    y: lamp.getY(i),
    z: lamp.getZ(i),
    kind: lamp.getW(i),
    light: aim.getZ(i),
  }));
}

describe('WetReflections', () => {
  it('mirrors every lamp in reach ahead of the camera: street lamps, headlights facing it and tail lights leading it', () => {
    const scene = new Scene();
    const reflections = new WetReflections(scene, 16);
    reflections.setStreetLamps([
      { x: 4, y: 7.4, z: 40, facingX: -1, facingZ: 0 },
      // Behind the camera, and out of reach.
      { x: 4, y: 7.4, z: -30, facingX: -1, facingZ: 0 },
      { x: 4, y: 7.4, z: 400, facingX: -1, facingZ: 0 },
    ]);
    const traffic = lamps(
      // Oncoming: its headlights face the camera, its tail lights away.
      ['head', -1.5, 0.7, 60, 0, -1],
      ['tail', -1.5, 0.8, 64, 0, 1],
      // Leading: its tail lights face the camera, its headlights away.
      ['head', 1.5, 0.7, 34, 0, 1],
      ['tail', 1.5, 0.8, 30, 0, -1],
    );

    reflections.update(camera(), 1, 1, 1, 1 / 60, [traffic]);

    const shown = mirrored(reflections);
    expect(shown.map(({ kind, z }) => [kind, z])).toEqual([
      [1, 60],
      [2, 30],
      [0, 40],
    ]);
    // Each as bright as its kind shines: a headlight's peak far over a tail light's.
    expect(shown[0]!.light).toBeGreaterThan(shown[1]!.light * 100);
    expect(drawCallCount(scene)).toBe(1);
    expect(reflections.mesh.visible).toBe(true);
  });

  it('fades lamps toward the reach, and keeps the nearest street lamps when there are more than it has room for', () => {
    const reflections = new WetReflections(new Scene(), 3);
    reflections.setStreetLamps(
      [250, 20, 180, 40, 120, 60, 290].map((z) => ({ x: 4, y: 7.4, z, facingX: -1, facingZ: 0 })),
    );

    reflections.update(camera(), 1, 0, 1, 0, []);

    // The nearest rings first: of those in the nearest ring (within 100 m), then the next.
    expect(mirrored(reflections).map(({ z }) => z)).toEqual([20, 40, 60]);

    const roomy = new WetReflections(new Scene(), 16);
    roomy.setStreetLamps([20, 290].map((z) => ({ x: 4, y: 7.4, z, facingX: -1, facingZ: 0 })));
    roomy.update(camera(), 1, 0, 1, 0, []);
    const [near, far] = mirrored(roomy);
    expect(far!.light).toBeLessThan(near!.light / 4);
  });

  it('draws nothing while the roads are dry or the lamps are off', () => {
    const scene = new Scene();
    const reflections = new WetReflections(scene, 8);
    reflections.setStreetLamps([{ x: 4, y: 7.4, z: 40, facingX: -1, facingZ: 0 }]);

    reflections.update(camera(), 0, 0, 1, 0, []);
    expect(reflections.mesh.visible).toBe(false);
    reflections.update(camera(), 1, 1, 0, 0, []);
    expect(reflections.mesh.visible).toBe(false);
    expect(reflections.lampCount).toBe(0);
    reflections.update(camera(), 0.5, 0, 0.8, 0, []);
    expect(reflections.mesh.visible).toBe(true);
    expect((reflections.mesh.material as ShaderMaterial).uniforms['strength']!.value).toBeCloseTo(0.4, 9);
  });

  it('sharpens and ripples the streaks the wetter the road and the harder the rain, and lets the truck shade the road behind it', () => {
    const reflections = new WetReflections(new Scene(), 8);
    const uniforms = (reflections.mesh.material as ShaderMaterial).uniforms;
    const truck: MirroredLamps = {
      mirrorLamps(into) {
        into.shade(0, 12, Math.PI / 2, 5, 1.25, 3.8);
      },
    };

    reflections.update(camera(), 0.3, 0, 1, 0, [truck]);
    const damp = { roughness: uniforms['roughness']!.value as number, ripple: uniforms['ripple']!.value as number };
    reflections.update(camera(), 1, 1, 1, 0.5, [truck]);
    expect(uniforms['roughness']!.value).toBeLessThan(damp.roughness);
    expect(uniforms['ripple']!.value).toBeGreaterThan(damp.ripple);
    expect(uniforms['time']!.value).toBeCloseTo(0.5, 9);
    // The truck's box: its middle, the way it faces (sine, cosine) and its size, gone the next frame without it.
    const blocker = uniforms['blocker']!.value as { x: number; y: number; z: number; w: number };
    expect([blocker.x, blocker.y, blocker.z, blocker.w].map((value) => Number(value.toFixed(6)))).toEqual([0, 12, 1, 0]);
    expect((uniforms['blockerSize']!.value as Vector3).toArray()).toEqual([5, 1.25, 3.8]);
    reflections.update(camera(), 1, 1, 1, 0, []);
    expect((uniforms['blockerSize']!.value as Vector3).z).toBe(0);
  });

  it('lays each streak flat on the water, facing up, from under its lamp toward the camera', () => {
    const reflections = new WetReflections(new Scene(), 1);
    const geometry = reflections.mesh.geometry as InstancedBufferGeometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex()!;
    // The vertex shader's layout: x across (to the left looking from the lamp to the camera), y along.
    for (const along of [new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(-0.6, 0, -0.8)]) {
      const across = new Vector3(-along.z, 0, along.x);
      const corner = (i: number): Vector3 =>
        along
          .clone()
          .multiplyScalar(position.getY(index.getX(i)) * 20)
          .addScaledVector(across, position.getX(index.getX(i)));
      for (let i = 0; i < index.count; i += 3) {
        const [a, b, c] = [corner(i), corner(i + 1), corner(i + 2)];
        expect(new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).y).toBeGreaterThan(0);
      }
    }
    const material = reflections.mesh.material as ShaderMaterial;
    // Shaped by the lamps' own beams, and added light the haze swallows (no fog colour mixed in).
    expect(material.fragmentShader).toContain('streetLampBeam( - toward, facing )');
    expect(material.fragmentShader).toContain('lowBeam( - toward, facing');
    expect(material.fragmentShader).not.toContain('fogColor');
    expect(material.depthWrite).toBe(false);
  });

  it('releases its GPU resources on dispose', () => {
    const scene = new Scene();
    const reflections = new WetReflections(scene, 8);
    const disposed = watchDisposal(gpuResources(scene));

    reflections.dispose();

    expect(disposed.size).toBe(2);
    expect(scene.children).toHaveLength(0);
  });
});
