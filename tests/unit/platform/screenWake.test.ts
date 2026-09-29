import { describe, expect, it } from 'vitest';
import { ScreenWake, type ScreenWakeHost, type WakeLockHold } from '../../../src/platform/browser/screenWake';

/** A browser whose screen lock is granted (or refused) and can be taken back, as when the page hides. */
function browser(grant = true) {
  const held: { hold: WakeLockHold; released: boolean; drop: () => void }[] = [];
  let requests = 0;
  const host: ScreenWakeHost = {
    wakeLock: {
      request: () => {
        requests++;
        if (!grant) {
          return Promise.reject(new Error('NotAllowedError'));
        }
        const listeners: (() => void)[] = [];
        const entry = {
          released: false,
          drop: () => {
            entry.released = true;
            listeners.forEach((listener) => listener());
          },
          hold: {
            release: () => {
              entry.drop();
              return Promise.resolve();
            },
            addEventListener: (_type: 'release', listener: () => void) => listeners.push(listener),
          },
        };
        held.push(entry);
        return Promise.resolve(entry.hold);
      },
    },
  };
  return { host, held, requests: () => requests };
}

/** Lets the lock's promises settle (a few turns of the microtask queue). */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) {
    await Promise.resolve();
  }
}

describe('ScreenWake', () => {
  it('holds the screen on while wanted, lets it go after, and asks again when the page shows', async () => {
    const { host, held, requests } = browser();
    const wake = new ScreenWake(host);

    wake.keepAwake = true;
    wake.keepAwake = true;
    await settle();
    expect(requests()).toBe(1);
    expect(held[0]!.released).toBe(false);

    // The page hides: the browser takes the lock back; shown again, it is asked for anew.
    held[0]!.drop();
    wake.resume();
    await settle();
    expect(requests()).toBe(2);
    expect(held[1]!.released).toBe(false);

    wake.keepAwake = false;
    await settle();
    expect(held[1]!.released).toBe(true);
    wake.resume();
    await settle();
    expect(requests()).toBe(2);
  });

  it('lets go at once of a lock granted after it was no longer wanted', async () => {
    const { host, held } = browser();
    const wake = new ScreenWake(host);

    wake.keepAwake = true;
    wake.keepAwake = false;
    await settle();

    expect(held[0]!.released).toBe(true);
  });

  it('does without where the browser refuses or has no such thing', async () => {
    const refusing = browser(false);
    const wake = new ScreenWake(refusing.host);
    wake.keepAwake = true;
    await settle();
    wake.resume();
    await settle();
    expect(refusing.requests()).toBe(2);

    expect(() => {
      const none = new ScreenWake({});
      none.keepAwake = true;
      none.resume();
    }).not.toThrow();
  });
});
