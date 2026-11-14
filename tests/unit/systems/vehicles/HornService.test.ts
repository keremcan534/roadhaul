import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import type { CompanyTruckNearby } from '../../../../src/systems/traffic/CompanyTraffic';
import { HornService } from '../../../../src/systems/vehicles/HornService';
import { STEP_SECONDS } from '../../../support/driving';
import { newCompany } from '../../../support/game';
import { MemoryLogger } from '../../../support/MemoryLogger';

/** A truck 9 m long (its nose 7 m ahead of its rear axle) standing at (10, 20), facing +X. */
const TRUCK = {
  isDriving: true,
  vehicle: { x: 10, z: 20, heading: Math.PI / 2 },
  footprint: { offsets: [-0.75, 2.25, 5.75], radius: 1.25 },
};

/** The horn with the traffic and the company trucks round it as each test has them; what it emits. */
function hornWith(companyTruck: { key: string; owner: 'fleet' | 'rival'; x: number; z: number } | null) {
  const events = new EventBus<GameEvents>(new MemoryLogger());
  const heard: { x: number; z: number; heading: number }[] = [];
  const truck = companyTruck === null ? null : { ...companyTruck };
  const traffic = {
    simulation: {
      hearHorn(x: number, z: number, heading: number): number {
        heard.push({ x, z, heading });
        return 2;
      },
    },
  };
  const companyTrucks = {
    nearestInTraffic(x: number, z: number, meters: number, out: CompanyTruckNearby): boolean {
      if (truck === null || Math.hypot(truck.x - x, truck.z - z) > meters) {
        return false;
      }
      Object.assign(out, truck);
      return true;
    },
    placeInTraffic(key: string, placement: { x: number; z: number; heading: number }): boolean {
      if (truck === null || key !== truck.key) {
        return false;
      }
      placement.x = truck.x;
      placement.z = truck.z;
      return true;
    },
  };
  const horn = new HornService(TRUCK, traffic, companyTrucks, events);
  const sounded: GameEvents['HornSounded'][] = [];
  const answered: GameEvents['HornAnswered'][] = [];
  events.on('HornSounded', (event) => sounded.push(event));
  events.on('HornAnswered', (event) => answered.push(event));
  const step = (seconds: number): void => {
    for (let t = 0; t < seconds - 1e-9; t += STEP_SECONDS) {
      horn.update(STEP_SECONDS);
    }
  };
  return { horn, heard, sounded, answered, step, truck };
}

describe('HornService', () => {
  it('sounds once a press, from the truck\'s nose to the traffic ahead, and tells what it did', () => {
    const { horn, heard, sounded, step } = hornWith(null);
    horn.press(true);
    step(1);
    // Held down: one blast; let go and pressed again: another.
    expect(sounded).toEqual([{ x: 10, z: 20, heading: Math.PI / 2, hurried: 2 }]);
    expect(heard).toHaveLength(1);
    expect(heard[0]!.x).toBeCloseTo(10 + 7, 9);
    expect(heard[0]!.z).toBeCloseTo(20, 9);
    horn.press(false);
    horn.press(true);
    step(STEP_SECONDS);
    expect(sounded).toHaveLength(2);
  });

  it('has a company truck in the traffic near the truck hoot back a moment later, and not again straight away', () => {
    const { horn, sounded, answered, step, truck } = hornWith({ key: 'driver_ayse', owner: 'fleet', x: 60, z: 20 });
    horn.press(true);
    horn.press(false);
    step(0.5);
    expect(sounded).toHaveLength(1);
    expect(answered).toEqual([]);
    // It drove on meanwhile: it answers from where it is.
    truck!.x = 66;
    step(0.5);
    expect(answered).toEqual([{ owner: 'fleet', key: 'driver_ayse', x: 66, z: 20 }]);

    horn.press(true);
    horn.press(false);
    step(2);
    expect(answered).toHaveLength(1);
    step(15);
    horn.press(true);
    horn.press(false);
    step(2);
    expect(answered).toHaveLength(2);
  });

  it('is not answered from beyond the company trucks\' hearing, nor once a new drive starts', () => {
    const far = hornWith({ key: 'rival_a:0', owner: 'rival', x: 200, z: 20 });
    far.horn.press(true);
    far.step(2);
    expect(far.sounded).toHaveLength(1);
    expect(far.answered).toEqual([]);

    const near = hornWith({ key: 'rival_a:0', owner: 'rival', x: 40, z: 20 });
    near.horn.press(true);
    near.step(0.2);
    near.horn.reset();
    near.step(2);
    expect(near.answered).toEqual([]);
  });

  it('works on the road in the real game: the horn heard by the traffic round the truck', async () => {
    const game = await newCompany();
    const sounded: GameEvents['HornSounded'][] = [];
    game.events.on('HornSounded', (event) => sounded.push(event));
    game.traffic.update(STEP_SECONDS);
    game.horn.press(true);
    game.horn.update(STEP_SECONDS);
    const vehicle = game.driving.vehicle;
    expect(sounded).toEqual([{ x: vehicle.x, z: vehicle.z, heading: vehicle.heading, hurried: expect.any(Number) }]);
  });
});
