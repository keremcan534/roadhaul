import { describe, expect, it } from 'vitest';
import { createCanvasTransform, MapViewport } from '../../../../src/ui/map/MapViewport';

function viewport(): MapViewport {
  const view = new MapViewport(0.01, 20);
  view.resize(400, 300);
  return view;
}

describe('MapViewport', () => {
  it('draws the world as seen from above: x to the right, z down, north up', () => {
    const view = viewport();
    view.centerX = 100;
    view.centerZ = 50;
    view.scale = 2;
    expect(view.screenX(100, 50)).toBe(200);
    expect(view.screenY(100, 50)).toBe(150);
    expect(view.screenX(110, 50)).toBe(220); // East is right…
    expect(view.screenY(100, 40)).toBe(130); // …and north (−z) is up.
  });

  it('turns screen points back into world points, turned or not', () => {
    const view = viewport();
    view.centerX = -30;
    view.centerZ = 70;
    view.scale = 1.7;
    for (const rotation of [0, 0.4, -2.2, Math.PI]) {
      view.turn(rotation);
      for (const [x, z] of [
        [-30, 70],
        [12, -5],
        [-400, 250],
      ] as const) {
        expect(view.worldX(view.screenX(x, z), view.screenY(x, z))).toBeCloseTo(x, 9);
        expect(view.worldZ(view.screenX(x, z), view.screenY(x, z))).toBeCloseTo(z, 9);
      }
    }
  });

  it('turns the map so the way the truck heads is up', () => {
    const view = viewport();
    view.scale = 1;
    for (const heading of [0, Math.PI / 2, 2, -2.5]) {
      view.headUp(heading);
      // Ten meters ahead of the truck (at the centre) is straight up the screen.
      const aheadX = 10 * Math.sin(heading);
      const aheadZ = 10 * Math.cos(heading);
      expect(view.screenX(aheadX, aheadZ)).toBeCloseTo(200, 9);
      expect(view.screenY(aheadX, aheadZ)).toBeCloseTo(140, 9);
      // Left of the truck is left on the screen: turning left raises the heading.
      const leftX = 10 * Math.sin(heading + Math.PI / 2);
      const leftZ = 10 * Math.cos(heading + Math.PI / 2);
      expect(view.screenX(leftX, leftZ)).toBeCloseTo(190, 9);
    }
  });

  it('fits a box on the screen and keeps the zoom within its limits', () => {
    const view = viewport();
    view.turn(1);
    view.fit({ minX: -1000, maxX: 1000, minZ: 0, maxZ: 500 });
    expect(view.rotation).toBe(0);
    expect(view.centerX).toBe(0);
    expect(view.centerZ).toBe(250);
    expect(view.scale).toBe(0.2); // 400 px across 2000 m.

    // 50 px clear on every side: 300 px across 2000 m.
    view.fit({ minX: -1000, maxX: 1000, minZ: 0, maxZ: 500 }, 50);
    expect(view.scale).toBe(0.15);

    view.fit({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 });
    expect(view.scale).toBe(20);
    view.zoomAt(100, 200, 150);
    expect(view.scale).toBe(20);
    view.zoomAt(1e-9, 200, 150);
    expect(view.scale).toBe(0.01);
  });

  it('zooms about the finger and drags with it', () => {
    const view = viewport();
    view.turn(0.7);
    view.scale = 1.5;
    const x = view.worldX(320, 60);
    const z = view.worldZ(320, 60);
    view.zoomAt(2.5, 320, 60);
    expect(view.scale).toBe(3.75);
    expect(view.screenX(x, z)).toBeCloseTo(320, 9);
    expect(view.screenY(x, z)).toBeCloseTo(60, 9);

    view.panBy(-40, 25);
    expect(view.screenX(x, z)).toBeCloseTo(280, 9);
    expect(view.screenY(x, z)).toBeCloseTo(85, 9);
  });

  it('keeps the middle of the screen over the map', () => {
    const view = viewport();
    view.centerX = 5000;
    view.centerZ = -5000;
    view.keepWithin({ minX: -100, maxX: 100, minZ: -50, maxZ: 50 });
    expect(view.centerX).toBe(100);
    expect(view.centerZ).toBe(-50);
  });

  it('tells which boxes may be on screen, however it is turned', () => {
    const view = viewport();
    view.scale = 1; // The screen's corners are 250 m from its middle.
    const box = (x: number, z: number) => ({ minX: x - 5, maxX: x + 5, minZ: z - 5, maxZ: z + 5 });
    for (const rotation of [0, 1, 2.5]) {
      view.turn(rotation);
      expect(view.sees(box(0, 0), 0)).toBe(true);
      expect(view.sees(box(240, 0), 0)).toBe(true);
      expect(view.sees(box(300, 0), 0)).toBe(false);
      expect(view.sees(box(300, 0), 60)).toBe(true);
    }
  });

  it('gives the canvas the same transform, in device pixels', () => {
    const view = viewport();
    view.centerX = 20;
    view.centerZ = -10;
    view.scale = 0.8;
    view.turn(0.3);
    const t = view.canvasTransform(createCanvasTransform(), 2);
    for (const [x, z] of [
      [0, 0],
      [55, -80],
    ] as const) {
      expect(t.a * x + t.c * z + t.e).toBeCloseTo(view.screenX(x, z) * 2, 9);
      expect(t.b * x + t.d * z + t.f).toBeCloseTo(view.screenY(x, z) * 2, 9);
    }
  });
});
