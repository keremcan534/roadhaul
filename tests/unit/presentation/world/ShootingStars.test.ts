import { PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { ShootingStars } from '../../../../src/presentation/world/ShootingStars';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

function camera(): PerspectiveCamera {
  const view = new PerspectiveCamera(60, 2, 0.5, 2000);
  view.position.set(100, 2, -50);
  view.lookAt(100, 2, -150); // North.
  view.updateMatrixWorld();
  return view;
}

describe('ShootingStars', () => {
  it('lets none fall by day, and now and then one at night where the camera looks, in one draw call', () => {
    const scene = new Scene();
    const stars = new ShootingStars(scene);
    const view = camera();
    for (let t = 0; t < 120; t += 0.1) {
      stars.update(0.1, view, 0);
      expect(stars.mesh.visible).toBe(false);
    }
    let fell = 0;
    let streaking = false;
    for (let t = 0; t < 120; t += 0.05) {
      stars.update(0.05, view, 1);
      if (stars.mesh.visible) {
        expect(drawCallCount(scene)).toBe(1);
        // On the sky ahead (north, -z), high up, centred on the camera.
        const position = stars.mesh.geometry.getAttribute('position');
        expect(position.getZ(0)).toBeLessThan(0);
        expect(position.getY(0)).toBeGreaterThan(50);
        expect(stars.mesh.position.x).toBe(100);
      }
      if (stars.streaking && !streaking) {
        fell += 1;
      }
      streaking = stars.streaking;
    }
    expect(fell).toBeGreaterThanOrEqual(2);
    expect(fell).toBeLessThanOrEqual(8);
  });

  it('lets them fall every few seconds when asked, and frees its GPU resources', () => {
    const scene = new Scene();
    const stars = new ShootingStars(scene);
    stars.fallOften = true;
    let fell = 0;
    let streaking = false;
    for (let t = 0; t < 60; t += 0.05) {
      stars.update(0.05, camera(), 1);
      if (stars.streaking && !streaking) {
        fell += 1;
      }
      streaking = stars.streaking;
    }
    expect(fell).toBeGreaterThanOrEqual(8);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);
    stars.dispose();
    expect(scene.children).toEqual([]);
    expect(disposed).toEqual(resources);
  });
});
