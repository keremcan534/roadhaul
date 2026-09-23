import { DirectionalLight, FogExp2, HemisphereLight, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { EnvironmentView } from '../../../../src/presentation/world/EnvironmentView';
import { SUN_DIRECTION } from '../../../../src/presentation/world/lighting';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

describe('EnvironmentView', () => {
  it('lights the scene from the sun and the sky, with haze in the distance', () => {
    const scene = new Scene();
    new EnvironmentView(scene);

    const sun = scene.children.find((child) => child instanceof DirectionalLight);
    expect(sun).toBeDefined();
    expect(sun!.position.clone().normalize().toArray().map((value) => value.toFixed(6))).toEqual(
      [SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z].map((value) => value.toFixed(6)),
    );
    expect(scene.children.some((child) => child instanceof HemisphereLight)).toBe(true);
    expect(scene.fog).toBeInstanceOf(FogExp2);
    expect(drawCallCount(scene)).toBeLessThanOrEqual(3);
  });

  it('keeps the sky, clouds and hills centred on the camera', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const backdrop = scene.children.find((child) => child.children.length === 3)!;

    view.update({ x: 120, z: -340 });

    expect(backdrop.position.toArray()).toEqual([120, 0, -340]);
  });

  it('releases every GPU resource and restores the scene on dispose', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
  });
});
