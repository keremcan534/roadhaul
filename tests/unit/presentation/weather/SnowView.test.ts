import { Mesh, Scene, type ShaderMaterial, type Vector2 } from 'three';
import { describe, expect, it } from 'vitest';
import { SnowView } from '../../../../src/presentation/weather/SnowView';
import { LampLighting } from '../../../../src/presentation/world/LampLighting';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

function setup() {
  const scene = new Scene();
  const view = new SnowView(scene);
  const snow = scene.getObjectByName('snow') as Mesh;
  const uniforms = (snow.material as ShaderMaterial).uniforms as Record<string, { value: unknown }>;
  const flakes = (): number => snow.geometry.drawRange.count / 6;
  return { scene, view, snow, uniforms, flakes };
}

describe('SnowView', () => {
  it('draws all its flakes in one draw call, more the harder it snows, and none while it does not', () => {
    const { scene, view, snow, flakes } = setup();

    view.update(1 / 60, 0, 0, 0);
    expect(drawCallCount(scene)).toBe(1);
    expect(snow.visible).toBe(false);
    // Placed round the camera by the shader: nothing for three.js to cull by.
    expect(snow.frustumCulled).toBe(false);

    view.update(1 / 60, 0, 0, 0.25);
    const light = flakes();
    view.update(1 / 60, 0, 0, 1);
    const heavy = flakes();
    expect(snow.visible).toBe(true);
    expect(light).toBeGreaterThan(100);
    expect(heavy).toBeCloseTo(light * 4, -1);
    // Every flake is a quad of its own: four corners, two triangles.
    expect(snow.geometry.getAttribute('position').count).toBe(heavy * 4);
  });

  it('draws a share of its flakes on weaker devices, and keeps them out of the cab', () => {
    const full = setup();
    const scene = new Scene();
    const light = new SnowView(scene, 0.5);
    full.view.update(1 / 60, 0, 0, 1);
    light.update(1 / 60, 0, 0, 1);
    expect((scene.getObjectByName('snow') as Mesh).geometry.drawRange.count).toBe(full.snow.geometry.drawRange.count / 2);

    const clearance = (): number => full.uniforms.clearance!.value as number;
    const byDefault = clearance();
    full.view.setClearance(1.2);
    expect(clearance()).toBe(1.2);
    full.view.setClearance(0);
    expect(clearance()).toBe(byDefault);
  });

  it('follows the camera and lets the flakes fall, drift and sway while it runs, frozen when paused', () => {
    const { view, uniforms } = setup();
    const fall = (): number => uniforms.fall!.value as number;
    const sway = (): number => uniforms.swayTime!.value as number;

    view.update(0.5, 120, -40, 1);
    const firstFall = fall();
    const firstSway = sway();
    view.update(0.5, 130, -42, 1);
    expect((uniforms.center!.value as Vector2).toArray()).toEqual([130, -42]);
    expect(fall()).not.toBe(firstFall);
    expect(sway()).not.toBe(firstSway);

    view.update(0, 130, -42, 1);
    expect(sway()).toBe(firstSway + 0.5);
  });

  it('keeps its animation numbers small however long it snows, so the shader stays precise', () => {
    const { view, uniforms } = setup();

    for (let frame = 0; frame < 60 * 60 * 20; frame++) {
      view.update(1 / 60, 0, 0, 1);
    }

    expect(uniforms.fall!.value as number).toBeLessThan(1);
    expect(Math.abs((uniforms.drift!.value as Vector2).x)).toBeLessThan(100);
    expect(uniforms.swayTime!.value as number).toBeLessThan(700);
  });

  it('lets the flakes catch the light of the night\'s lamps when given them, sharing their uniforms', () => {
    const lamps = new LampLighting();
    const scene = new Scene();
    new SnowView(scene, 1, lamps.uniforms);
    const material = (scene.getObjectByName('snow') as Mesh).material as ShaderMaterial;

    expect(material.uniforms['lampLevel']).toBe(lamps.uniforms.lampLevel);
    expect(material.vertexShader).toContain('#define SNOW_LAMPS');
    const plain = setup().snow.material as ShaderMaterial;
    expect(plain.vertexShader).not.toContain('#define SNOW_LAMPS');
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
