import { describe, expect, it } from 'vitest';
import { deliveryStars, isPerfectDelivery } from '../../../../src/domain/missions/deliveryStars';

describe('deliveryStars', () => {
  it('gives a star for delivering, one for being on time and one for flawless cargo', () => {
    expect(deliveryStars(true, 0)).toEqual({ onTime: true, flawless: true, count: 3 });
    expect(deliveryStars(false, 0)).toEqual({ onTime: false, flawless: true, count: 2 });
    expect(deliveryStars(true, 0.2)).toEqual({ onTime: true, flawless: false, count: 2 });
    expect(deliveryStars(false, 0.2)).toEqual({ onTime: false, flawless: false, count: 1 });
  });

  it('counts cargo that reads 100% as flawless, and only three stars as perfect', () => {
    expect(deliveryStars(true, 0.004).flawless).toBe(true);
    expect(deliveryStars(true, 0.005).flawless).toBe(false);
    expect(isPerfectDelivery(deliveryStars(true, 0))).toBe(true);
    expect(isPerfectDelivery(deliveryStars(false, 0))).toBe(false);
  });
});
