import { Mesh, Scene, type ShaderMaterial, type Vector2 } from 'three';
import { describe, expect, it } from 'vitest';
import { RainView } from '../../../../src/presentation/weather/RainView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

function setup() {
  const scene = new Scene();
  const view = new RainView(scene);
  const rain = scene.getObjectByName('rain') as Mesh;
  const uniforms = (rain.material as ShaderMaterial).uniforms as Record<string, { value: unknown }>;
  const streaks = (): number => rain.geometry.drawRange.count / 6;
  return { scene, view, rain, uniforms, streaks };
}

describe('RainView', () => {
  it('draws all its streaks in one draw call, and nothing while it is dry', () => {
    const { scene, view, rain } = setup();

    view.update(1 / 60, 0, 0, 0);

    expect(drawCallCount(scene)).toBe(1);
    expect(rain.visible).toBe(false);
    // Placed round the camera by the shader: nothing for three.js to cull by.
    expect(rain.frustumCulled).toBe(false);
  });

  it('draws more streaks the harder it rains', () => {
    const { view, rain, streaks } = setup();

    view.update(1 / 60, 0, 0, 0.25);
    const light = streaks();
    view.update(1 / 60, 0, 0, 1);
    const heavy = streaks();

    expect(rain.visible).toBe(true);
    expect(light).toBeGreaterThan(100);
    expect(heavy).toBeCloseTo(light * 4, -1);
    // Every streak is a quad of its own: four corners, two triangles.
    expect(rain.geometry.getAttribute('position').count).toBe(heavy * 4);
    expect(rain.geometry.index!.count).toBe(heavy * 6);
  });

  it('draws a share of its streaks on weaker devices', () => {
    const full = setup();
    const scene = new Scene();
    const light = new RainView(scene, 0.5);
    const rain = scene.getObjectByName('rain') as Mesh;

    full.view.update(1 / 60, 0, 0, 1);
    light.update(1 / 60, 0, 0, 1);

    expect(rain.geometry.drawRange.count).toBe(full.rain.geometry.drawRange.count / 2);
  });

  it('follows the camera, and lets the drops fall and drift with the wind while it runs', () => {
    const { view, uniforms } = setup();
    const fall = (): number => uniforms.fall!.value as number;
    const drift = (): Vector2 => uniforms.drift!.value as Vector2;

    view.update(0.5, 120, -40, 1);
    const firstFall = fall();
    const firstDrift = drift().clone();
    view.update(0.5, 130, -42, 1);

    expect((uniforms.center!.value as Vector2).toArray()).toEqual([130, -42]);
    expect(fall()).not.toBe(firstFall);
    expect(drift().equals(firstDrift)).toBe(false);

    // Frozen while the game is paused.
    const pausedFall = fall();
    view.update(0, 130, -42, 1);
    expect(fall()).toBe(pausedFall);
  });

  it('keeps its animation numbers small however long it rains, so the shader stays precise', () => {
    const { view, uniforms } = setup();

    for (let frame = 0; frame < 60 * 60 * 10; frame++) {
      view.update(1 / 60, 0, 0, 1);
    }

    const fall = uniforms.fall!.value as number;
    const drift = uniforms.drift!.value as Vector2;
    expect(fall).toBeGreaterThanOrEqual(0);
    expect(fall).toBeLessThan(1);
    expect(Math.abs(drift.x)).toBeLessThan(100);
    expect(Math.abs(drift.y)).toBeLessThan(100);
  });

  it('keeps the streaks at least a pixel wide on the screen it draws to', () => {
    const { view, uniforms } = setup();

    view.setViewport(1350, 630);

    expect((uniforms.resolution!.value as Vector2).toArray()).toEqual([1350, 630]);
  });

  it('releases its GPU resources on dispose', () => {
    const { scene, view } = setup();
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect(disposed).toEqual(resources);
    expect(scene.children).toHaveLength(0);
  });
});
