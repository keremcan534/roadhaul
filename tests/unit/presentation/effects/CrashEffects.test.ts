import { Color, InstancedMesh, Matrix4, Mesh, PerspectiveCamera, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CrashEffects } from '../../../../src/presentation/effects/CrashEffects';
import { gpuResources, watchDisposal } from '../../../support/threeResources';

const camera = new PerspectiveCamera();

function bitsOf(scene: Scene): InstancedMesh {
  return scene.getObjectByName('crash:bits') as InstancedMesh;
}

/** The two pools of puffs (dust, then sparks), as added. */
function poolsOf(scene: Scene): Mesh[] {
  return scene.children.filter((child): child is Mesh => child instanceof Mesh && !(child instanceof InstancedMesh));
}

function run(effects: CrashEffects, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.05) effects.update(0.05, camera);
}

describe('CrashEffects', () => {
  it('draws nothing while nothing flies', () => {
    const scene = new Scene();
    const effects = new CrashEffects(scene, 1);
    effects.update(0.05, camera);
    expect(bitsOf(scene).visible).toBe(false);
    expect(poolsOf(scene).every((pool) => !pool.visible)).toBe(true);
  });

  it('throws bits of a lamp post the way the truck struck, sparks and dust; they land and are gone within seconds', () => {
    const scene = new Scene();
    const effects = new CrashEffects(scene, 1);
    // Struck heading +x at 15 m/s, at (100, 50).
    effects.knock('lamp', 100, 50, 15, Math.PI / 2);
    run(effects, 0.3);

    const bits = bitsOf(scene);
    expect(bits.visible).toBe(true);
    expect(bits.count).toBeGreaterThan(8);
    const matrix = new Matrix4();
    const place = new Vector3();
    let ahead = 0;
    for (let i = 0; i < bits.count; i++) {
      bits.getMatrixAt(i, matrix);
      place.setFromMatrixPosition(matrix);
      expect(place.y).toBeGreaterThan(0);
      if (place.x > 100) ahead++;
    }
    expect(ahead).toBeGreaterThan(bits.count / 2);
    const [dust, sparks] = poolsOf(scene);
    expect(dust!.visible).toBe(true);
    expect(sparks!.visible).toBe(true);

    run(effects, 5);
    expect(bits.visible).toBe(false);
    expect(poolsOf(scene).every((pool) => !pool.visible)).toBe(true);
  });

  it('throws no sparks off straw, and bits of a wreck in its paint', () => {
    const scene = new Scene();
    const effects = new CrashEffects(scene, 1);
    effects.knock('hayBale', 0, 0, 10, 0);
    effects.update(0.05, camera);
    expect(poolsOf(scene)[1]!.visible).toBe(false);

    effects.wreck(0, 0, 20, 0, 0xc7372f);
    effects.update(0.05, camera);
    const bits = bitsOf(scene);
    const paint = new Color(0xc7372f);
    const color = new Color();
    let painted = 0;
    for (let i = 0; i < bits.count; i++) {
      bits.getColorAt(i, color);
      if (Math.abs(color.r - paint.r) + Math.abs(color.g - paint.g) + Math.abs(color.b - paint.b) < 1e-3) painted++;
    }
    expect(painted).toBeGreaterThan(0);
    expect(poolsOf(scene)[1]!.visible).toBe(true);
  });

  it('holds still while paused', () => {
    const scene = new Scene();
    const effects = new CrashEffects(scene, 1);
    effects.knock('bin', 0, 0, 10, 0);
    effects.update(0.05, camera);
    const before = Array.from(bitsOf(scene).instanceMatrix.array);
    effects.update(0, camera);
    expect(Array.from(bitsOf(scene).instanceMatrix.array)).toEqual(before);
  });

  it('releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const effects = new CrashEffects(scene, 1);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);
    effects.dispose();
    expect(disposed.size).toBe(resources.size);
    expect(scene.getObjectByName('crash:bits')).toBeUndefined();
  });
});
