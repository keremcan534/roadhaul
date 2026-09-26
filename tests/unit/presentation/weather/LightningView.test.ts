import { Scene, Vector3, type BufferGeometry, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { LightningView } from '../../../../src/presentation/weather/LightningView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const EYE = { x: 100, y: 3, z: -50 };

describe('LightningView', () => {
  it('shows a bolt toward a strike while it flashes, as big as it looks from its distance, facing the camera', () => {
    const scene = new Scene();
    const view = new LightningView(scene);
    expect(view.visible).toBe(false);

    // Three kilometres off to the east (+x): drawn inside the sky's dome, shrunk to look as big.
    view.strike({ distanceMeters: 3000, bearing: Math.PI / 2, brightness: 0.6 }, EYE);
    view.update(0.8, EYE);

    expect(view.visible).toBe(true);
    expect(drawCallCount(scene)).toBe(1);
    const { position, scale, rotation } = view.mesh;
    expect(position.x).toBeCloseTo(EYE.x + 760, 6);
    expect(position.z).toBeCloseTo(EYE.z, 6);
    expect(position.y).toBe(0);
    // Its top as high up the sky as a cloud base 1300 m up, 3 km off.
    expect(Math.atan2(scale.y, 760)).toBeCloseTo(Math.atan2(1300, 3000), 6);
    // Its face (+z) turned to the camera, to the west of it.
    const facing = new Vector3(0, 0, 1).applyEuler(rotation);
    expect(facing.x).toBeCloseTo(-1, 6);
    expect((view.mesh.material as ShaderMaterial).uniforms['flash']!.value).toBe(0.8);

    // Gone with the flash.
    view.update(0.01, EYE);
    expect(view.visible).toBe(false);
  });

  it('draws a near strike where it is, and none too far off to be seen through the rain', () => {
    const view = new LightningView(new Scene());

    view.strike({ distanceMeters: 600, bearing: 0, brightness: 1 }, EYE);
    view.update(1, EYE);
    expect(view.mesh.position.z).toBeCloseTo(EYE.z + 600, 6);
    expect(view.mesh.scale.y).toBeCloseTo(1300, 6);

    view.strike({ distanceMeters: 5500, bearing: 0, brightness: 0.3 }, EYE);
    view.update(1, EYE);
    expect(view.visible).toBe(false);
  });

  it('holds a few bolt shapes, each a jagged channel from the cloud to the ground facing the camera, and draws one', () => {
    const view = new LightningView(new Scene());
    const geometry = view.mesh.geometry as BufferGeometry;
    const position = geometry.getAttribute('position');
    const drawn = new Set<string>();

    for (let strike = 0; strike < 12; strike++) {
      view.strike({ distanceMeters: 2000, bearing: 0, brightness: 0.8 }, EYE);
      const { start, count } = geometry.drawRange;
      drawn.add(`${start}:${count}`);
      expect(count % 6).toBe(0);
      let top = -Infinity;
      let bottom = Infinity;
      for (let corner = start; corner < start + count; corner += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(position, corner + k));
        // Every triangle faces +z: the way the bolt is turned to the camera.
        expect(new Vector3().subVectors(b!, a!).cross(new Vector3().subVectors(c!, a!)).z).toBeGreaterThan(0);
        for (const point of [a!, b!, c!]) {
          top = Math.max(top, point.y);
          bottom = Math.min(bottom, point.y);
        }
      }
      expect(top).toBeGreaterThan(0.95);
      expect(bottom).toBeLessThan(0.05);
    }
    expect(drawn.size).toBeGreaterThan(1);
  });

  it('releases its GPU resources on dispose', () => {
    const scene = new Scene();
    const view = new LightningView(scene);
    view.mesh.visible = true;
    const disposed = watchDisposal(gpuResources(scene));

    view.dispose();

    expect(disposed.size).toBe(2);
    expect(scene.children).toHaveLength(0);
  });
});
