import { Mesh, PerspectiveCamera, Scene, Vector3, type BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import {
  createTruckEffectsState,
  TruckEffects,
  type TruckEffectsState,
} from '../../../../src/presentation/vehicles/TruckEffects';
import { TruckView } from '../../../../src/presentation/vehicles/TruckView';

const truck = VEHICLES[0]!;

function setUp(density = 1): { effects: TruckEffects; view: TruckView; eye: PerspectiveCamera } {
  const scene = new Scene();
  const view = new TruckView(scene, truck);
  view.update({ x: 0, z: 0, heading: 0 }, new VehicleDynamics(truck).createState(0, 0, 0), 0);
  const eye = new PerspectiveCamera(60, 2, 0.5, 1000);
  eye.position.set(0, 6, -12);
  eye.lookAt(0, 1, 4);
  return { effects: new TruckEffects(scene, density), view, eye };
}

function driving(overrides: Partial<TruckEffectsState> = {}): TruckEffectsState {
  return {
    ...createTruckEffectsState(),
    driving: true,
    engineRunning: true,
    engineRpm: truck.powertrain.idleRpm,
    idleRpm: truck.powertrain.idleRpm,
    maxRpm: truck.powertrain.maxRpm,
    ...overrides,
  };
}

/** The puffs' mesh, where the effects put it. */
function puffMeshOf(effects: TruckEffects): Mesh {
  return (effects as unknown as { pool: { mesh: Mesh } }).pool.mesh;
}

/** Puffs in the air after `seconds` of `state`, in 60 Hz frames. */
function puffsAfter(seconds: number, state: TruckEffectsState, density = 1): number {
  const { effects, view, eye } = setUp(density);
  for (let t = 0; t < seconds; t += 1 / 60) {
    effects.update(1 / 60, view, state, eye);
  }
  return effects.count;
}

describe('TruckEffects', () => {
  it('puffs exhaust while the engine runs, more under load, and none with it off', () => {
    const idling = puffsAfter(1, driving());
    const pulling = puffsAfter(1, driving({ drivePedal: 1, engineRpm: truck.powertrain.maxRpm, speed: 8 }));

    expect(idling).toBeGreaterThan(0);
    expect(pulling).toBeGreaterThan(idling * 2);
    expect(puffsAfter(1, driving({ engineRunning: false }))).toBe(0);
  });

  it('raises dust from the wheels off the road, less on wet ground, and none standing still', () => {
    const exhaustOnly = puffsAfter(1, driving({ speed: 10 }));
    const dust = puffsAfter(1, driving({ speed: 10, offRoad: true }));
    const wetDust = puffsAfter(1, driving({ speed: 10, offRoad: true, wetness: 1 }));

    expect(dust).toBeGreaterThan(exhaustOnly + 15);
    expect(wetDust).toBeLessThan(dust);
    expect(wetDust).toBeGreaterThan(exhaustOnly);
    // Standing still off the road: only the exhaust, as on it.
    expect(puffsAfter(1, driving({ offRoad: true }))).toBe(puffsAfter(1, driving()));
  });

  it('throws spray off a wet road at speed, more the wetter it is', () => {
    const dry = puffsAfter(1, driving({ speed: 20 }));
    const drizzle = puffsAfter(1, driving({ speed: 20, wetness: 0.3 }));
    const pouring = puffsAfter(1, driving({ speed: 20, wetness: 1 }));

    expect(drizzle).toBeGreaterThan(dry);
    expect(pouring).toBeGreaterThan(drizzle);
    // Too slow to throw any.
    expect(puffsAfter(1, driving({ speed: 3, wetness: 1 }))).toBe(puffsAfter(1, driving({ speed: 3 })));
  });

  it('throws nothing while paused or off the road behind the menus, and lets what is in the air settle', () => {
    const { effects, view, eye } = setUp();
    const state = driving({ speed: 10, offRoad: true, drivePedal: 1 });
    effects.update(0, view, state, eye);
    expect(effects.count).toBe(0);
    effects.update(0.5, view, state, eye);
    const thrown = effects.count;
    expect(thrown).toBeGreaterThan(0);

    effects.update(0, view, state, eye);
    expect(effects.count).toBe(thrown);
    state.driving = false;
    for (let i = 0; i < 300; i++) {
      effects.update(1 / 60, view, state, eye);
    }
    expect(effects.count).toBe(0);
  });

  it('thins everything out on weaker devices', () => {
    const state = driving({ speed: 15, offRoad: true, drivePedal: 1, engineRpm: truck.powertrain.maxRpm });

    expect(puffsAfter(1, state, 0.5)).toBeLessThan(puffsAfter(1, state, 1) * 0.7);
  });

  it('throws the exhaust from the stack and the dust from behind the rear wheels', () => {
    for (const [state, source] of [
      [driving({ drivePedal: 1 }), (view: TruckView) => view.exhaustOutlet(new Vector3())],
      // Coasting with the engine off: only the wheels throw anything.
      [
        driving({ engineRunning: false, speed: 10, offRoad: true }),
        (view: TruckView) => view.behindRearWheel(1, new Vector3()),
      ],
    ] as const) {
      const { effects, view, eye } = setUp();
      while (effects.count === 0) {
        effects.update(1 / 60, view, state, eye);
      }
      const puffs = puffMeshOf(effects);
      const first = new Vector3()
        .fromBufferAttribute(puffs.geometry.getAttribute('position') as BufferAttribute, 0)
        .add(new Vector3().fromBufferAttribute(puffs.geometry.getAttribute('position') as BufferAttribute, 2))
        .multiplyScalar(0.5);
      // Just thrown: a frame's drift from where it came out.
      const from = source(view);
      expect(Math.hypot(first.y - from.y, first.z - from.z)).toBeLessThan(0.5);
      expect(Math.abs(Math.abs(first.x) - Math.abs(from.x))).toBeLessThan(0.5);
    }
  });
});
