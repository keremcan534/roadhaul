import { describe, expect, it } from 'vitest';
import { hitchFare, pickHitchDestination } from '../../../../src/domain/roadside/hitchhike';

const DEPOTS = [
  { cityId: 'home', yard: { x: 0, z: 0 } },
  { cityId: 'home', yard: { x: 50, z: 0 } },
  { cityId: 'north', yard: { x: 0, z: 4000 } },
  { cityId: 'south', yard: { x: 0, z: -5000 } },
  { cityId: 'far', yard: { x: 20_000, z: 0 } },
];

describe('pickHitchDestination', () => {
  it('picks a town in reach, never the one they stand in, the ones ahead first', () => {
    // Facing north (+z): the town ahead.
    expect(pickHitchDestination(DEPOTS, 0, 100, 0, [2500, 9000], 0.9)).toEqual({ cityId: 'north', x: 0, z: 4000, meters: 3900 });
    // Facing south: the town behind them becomes the one ahead.
    expect(pickHitchDestination(DEPOTS, 0, 100, Math.PI, [2500, 9000], 0)!.cityId).toBe('south');
    // Facing east, nothing in reach ahead: any town in reach, the roll picking.
    expect(pickHitchDestination(DEPOTS, 0, 100, Math.PI / 2, [2500, 9000], 0)!.cityId).toBe('north');
    expect(pickHitchDestination(DEPOTS, 0, 100, Math.PI / 2, [2500, 9000], 0.99)!.cityId).toBe('south');
  });

  it('has nowhere to go with no town in reach', () => {
    expect(pickHitchDestination(DEPOTS, 0, 100, 0, [10_000, 12_000], 0.5)).toBeNull();
    expect(pickHitchDestination([], 0, 0, 0, [1, 2], 0.5)).toBeNull();
  });
});

describe('hitchFare', () => {
  it('pays a fare and so much a kilometre, to the nearest ten', () => {
    expect(hitchFare(5000, 120, 90)).toBe(570);
    expect(hitchFare(2733, 120, 90)).toBe(370);
    expect(hitchFare(-1, 120, 90)).toBe(120);
  });
});
