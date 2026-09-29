import { describe, expect, it } from 'vitest';
import { Haptics, type HapticsHost } from '../../../src/platform/browser/haptics';

/** A phone that records its buzzes. */
function phone(active = true): HapticsHost & { buzzes: number[] } {
  const buzzes: number[] = [];
  return {
    buzzes,
    userActivation: { hasBeenActive: active },
    vibrate: (pattern: number) => {
      buzzes.push(pattern);
      return true;
    },
  };
}

describe('Haptics', () => {
  it('buzzes longer for a harder blow, up to a short limit, and not at all for a nudge', () => {
    const host = phone();
    const haptics = new Haptics(host);

    haptics.pulse(0.05);
    haptics.pulse(0.3);
    haptics.pulse(1);
    haptics.pulse(1.5);

    expect(host.buzzes).toHaveLength(3);
    expect(host.buzzes[0]!).toBeLessThan(host.buzzes[1]!);
    expect(host.buzzes[1]!).toBeLessThanOrEqual(host.buzzes[2]!);
    expect(Math.max(...host.buzzes)).toBeLessThanOrEqual(80);
    expect(host.buzzes.every(Number.isInteger)).toBe(true);
  });

  it('stays still when switched off, before the page is touched, and where there is no motor', () => {
    const off = phone();
    const haptics = new Haptics(off);
    haptics.enabled = false;
    haptics.pulse(1);
    expect(off.buzzes).toEqual([]);

    const untouched = phone(false);
    new Haptics(untouched).pulse(1);
    expect(untouched.buzzes).toEqual([]);

    expect(() => new Haptics({}).pulse(1)).not.toThrow();
  });

  it('shrugs off a browser that refuses', () => {
    const haptics = new Haptics({
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(() => haptics.pulse(1)).not.toThrow();
  });
});
