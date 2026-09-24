import { describe, expect, it } from 'vitest';
import { LookAround, type LookPointerEvent, type LookSurface } from '../../../../src/ui/controls/LookAround';

type Listener = (event: LookPointerEvent) => void;

/** A 1000 × 400 px stand-in for the canvas that fires pointer events on demand. */
class FakeSurface implements LookSurface {
  readonly clientWidth = 1000;
  readonly clientHeight = 400;
  readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((other) => other !== listener));
  }
  setPointerCapture(): void {
    throw new Error('A synthetic pointer cannot be captured.');
  }
  fire(type: string, pointerId: number, clientX: number, clientY: number): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ pointerId, clientX, clientY });
    }
  }
}

function setUp(limits: readonly [number, number] = [Math.PI, 0.4]): { surface: FakeSurface; look: LookAround } {
  const surface = new FakeSurface();
  const look = new LookAround(surface, () => limits);
  look.enabled = true;
  return { surface, look };
}

describe('LookAround', () => {
  it('turns the view by dragging: a whole screen across is half a turn, right and up are positive', () => {
    const { surface, look } = setUp();
    surface.fire('pointerdown', 1, 500, 200);
    surface.fire('pointermove', 1, 750, 200);
    expect(look.yaw).toBeCloseTo(Math.PI / 4, 9);
    surface.fire('pointermove', 1, 750, 120);
    expect(look.pitch).toBeCloseTo((80 / 400) * (Math.PI / 2), 9);
    surface.fire('pointermove', 1, 250, 120);
    expect(look.yaw).toBeCloseTo(-Math.PI / 4, 9);
  });

  it("keeps within the camera's limits", () => {
    const { surface, look } = setUp([0.5, 0.1]);
    surface.fire('pointerdown', 1, 0, 0);
    surface.fire('pointermove', 1, 1000, -400);
    expect(look.yaw).toBe(0.5);
    expect(look.pitch).toBe(0.1);
  });

  it('follows one finger at a time', () => {
    const { surface, look } = setUp();
    surface.fire('pointerdown', 1, 500, 200);
    surface.fire('pointerdown', 2, 100, 100);
    surface.fire('pointermove', 2, 900, 100);
    expect(look.yaw).toBe(0);
    surface.fire('pointermove', 1, 600, 200);
    expect(look.yaw).toBeCloseTo(Math.PI / 10, 9);
  });

  it('turns back ahead a moment after the finger lifts', () => {
    const { surface, look } = setUp();
    surface.fire('pointerdown', 1, 500, 200);
    surface.fire('pointermove', 1, 800, 150);
    surface.fire('pointerup', 1, 800, 150);
    const turned = look.yaw;
    look.update(0.5);
    expect(look.yaw).toBe(turned); // It waits.
    for (let frame = 0; frame < 180; frame++) {
      look.update(1 / 60);
    }
    expect(look.yaw).toBe(0);
    expect(look.pitch).toBe(0);
  });

  it('ignores drags while switched off, and faces ahead when switched off or reset', () => {
    const { surface, look } = setUp();
    surface.fire('pointerdown', 1, 500, 200);
    surface.fire('pointermove', 1, 800, 200);
    look.enabled = false;
    expect(look.yaw).toBe(0);
    surface.fire('pointerdown', 2, 500, 200);
    surface.fire('pointermove', 2, 900, 200);
    expect(look.yaw).toBe(0);

    look.enabled = true;
    surface.fire('pointerdown', 3, 500, 200);
    surface.fire('pointermove', 3, 600, 200);
    look.reset();
    expect(look.yaw).toBe(0);
    surface.fire('pointermove', 3, 700, 200); // The reset let go of the finger too.
    expect(look.yaw).toBe(0);
  });

  it('stops listening when disposed', () => {
    const { surface, look } = setUp();
    look.dispose();
    expect([...surface.listeners.values()].every((listeners) => listeners.length === 0)).toBe(true);
  });
});
