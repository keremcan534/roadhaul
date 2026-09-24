import { Color, PerspectiveCamera, Scene, Vector3, type BufferAttribute, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createParticleSpawn, ParticlePool, type ParticleSpawn } from '../../../../src/presentation/effects/ParticlePool';
import { gpuResources, watchDisposal } from '../../../support/threeResources';

function camera(): PerspectiveCamera {
  const eye = new PerspectiveCamera(60, 2, 0.5, 1000);
  eye.position.set(10, 6, -12);
  eye.lookAt(0, 1, 0);
  return eye;
}

function puff(overrides: Partial<ParticleSpawn> = {}): ParticleSpawn {
  return { ...createParticleSpawn(), lifeSeconds: 2, ...overrides };
}

/** Corner `corner` of the `quad`th quad drawn. */
function corner(mesh: Mesh, quad: number, corner: number): Vector3 {
  const positions = mesh.geometry.getAttribute('position') as BufferAttribute;
  return new Vector3().fromBufferAttribute(positions, quad * 4 + corner);
}

function alphaOf(mesh: Mesh, quad: number): number {
  const colors = mesh.geometry.getAttribute('color') as BufferAttribute;
  return colors.getW(quad * 4);
}

describe('ParticlePool', () => {
  it('draws nothing until a puff is thrown, then one quad a puff, face-on to the camera', () => {
    const scene = new Scene();
    const pool = new ParticlePool(scene, 8);
    const eye = camera();

    pool.update(0.1, eye);
    expect(pool.mesh.visible).toBe(false);
    expect(pool.mesh.geometry.drawRange.count).toBe(0);

    pool.spawn(puff({ x: 0, y: 1, z: 0, startSizeMeters: 1, endSizeMeters: 1 }));
    pool.spawn(puff({ x: 2, y: 1, z: 0 }));
    pool.update(0.5, eye);

    expect(pool.count).toBe(2);
    expect(pool.mesh.visible).toBe(true);
    expect(pool.mesh.geometry.drawRange.count).toBe(12);
    // The quad spans the camera's right and up: square, as wide as the puff, and edge-on to the view direction.
    const forward = eye.getWorldDirection(new Vector3());
    const [a, b, c] = [corner(pool.mesh, 0, 0), corner(pool.mesh, 0, 1), corner(pool.mesh, 0, 2)];
    expect(b.clone().sub(a).dot(forward)).toBeCloseTo(0, 5);
    expect(c.clone().sub(b).dot(forward)).toBeCloseTo(0, 5);
    expect(b.distanceTo(a)).toBeCloseTo(1, 5);
    expect(c.distanceTo(b)).toBeCloseTo(1, 5);
    const centre = a.clone().add(c).multiplyScalar(0.5);
    expect(centre.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-5);
  });

  it('carries a puff on, slowed by the air and lifted, growing, then fading out and gone at the end of its life', () => {
    const scene = new Scene();
    const pool = new ParticlePool(scene, 4);
    const eye = camera();
    pool.spawn(
      puff({ y: 1, vx: 4, drag: 1, lift: 2, startSizeMeters: 0.2, endSizeMeters: 2, lifeSeconds: 2, opacity: 0.8 }),
    );

    pool.update(0.05, eye);
    const young = alphaOf(pool.mesh, 0);
    pool.update(0.45, eye);
    const centre = corner(pool.mesh, 0, 0).add(corner(pool.mesh, 0, 2)).multiplyScalar(0.5);
    // Half a second at 4 m/s would be 2 m; the air holds it back. The lift has carried it up.
    expect(centre.x).toBeGreaterThan(1.2);
    expect(centre.x).toBeLessThan(2);
    expect(centre.y).toBeGreaterThan(1.1);
    const width = corner(pool.mesh, 0, 0).distanceTo(corner(pool.mesh, 0, 1));
    expect(width).toBeGreaterThan(0.2);
    expect(width).toBeLessThan(2);
    // In quickly, out slowly.
    const grown = alphaOf(pool.mesh, 0);
    expect(young).toBeLessThan(grown);
    expect(grown).toBeLessThanOrEqual(0.8);
    pool.update(1.2, eye);
    expect(alphaOf(pool.mesh, 0)).toBeLessThan(grown);

    pool.update(0.4, eye);
    expect(pool.count).toBe(0);
    expect(pool.mesh.visible).toBe(false);
  });

  it('lets spray fall to the road and no further', () => {
    const scene = new Scene();
    const pool = new ParticlePool(scene, 4);
    pool.spawn(puff({ y: 0.5, lift: -20, startSizeMeters: 0, endSizeMeters: 0, lifeSeconds: 3 }));

    pool.update(1, camera());

    expect(corner(pool.mesh, 0, 0).y).toBeCloseTo(0.05, 5);
  });

  it('makes way for new puffs with the oldest when it is full', () => {
    const scene = new Scene();
    const pool = new ParticlePool(scene, 3);
    for (let i = 0; i < 5; i++) {
      pool.spawn(puff({ x: i, startSizeMeters: 0, endSizeMeters: 0 }));
    }

    pool.update(0.01, camera());

    expect(pool.count).toBe(3);
    const xs = [0, 1, 2].map((quad) => Math.round(corner(pool.mesh, quad, 0).x));
    expect(xs.sort()).toEqual([2, 3, 4]);
  });

  it('holds the puffs still while the time stands still', () => {
    const scene = new Scene();
    const pool = new ParticlePool(scene, 2);
    const eye = camera();
    pool.spawn(puff({ vx: 5, lifeSeconds: 1 }));
    pool.update(0.2, eye);
    const before = corner(pool.mesh, 0, 0);

    pool.update(0, eye);
    pool.update(0, eye);

    expect(corner(pool.mesh, 0, 0).distanceTo(before)).toBeLessThan(1e-6);
    expect(pool.count).toBe(1);
  });

  it('colours puffs in linear colour, like the rest of the scene', () => {
    const scene = new Scene();
    const pool = new ParticlePool(scene, 1);
    pool.spawn(puff({ color: 0x808080 }));
    pool.update(0.1, camera());

    const colors = pool.mesh.geometry.getAttribute('color') as BufferAttribute;
    expect(colors.getX(0)).toBeCloseTo(new Color(0x808080).r, 6);
    expect(colors.getX(0)).toBeLessThan(0.3);
  });

  it('releases every GPU resource and leaves the scene on dispose', () => {
    const scene = new Scene();
    const pool = new ParticlePool(scene, 4);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    pool.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
