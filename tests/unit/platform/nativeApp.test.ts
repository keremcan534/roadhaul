import { describe, expect, it } from 'vitest';
import { attachNativeApp, isNativeApp, type NativeAppShell } from '../../../src/platform/native/nativeApp';

/** The app around the game, driven by the test: press back, send the app away. */
function fakeShell() {
  let back = (): void => undefined;
  let pause = (): void => undefined;
  let resume = (): void => undefined;
  const shell: NativeAppShell & { minimized: number } = {
    minimized: 0,
    onBackButton: (listener) => {
      back = listener;
    },
    onPause: (listener) => {
      pause = listener;
    },
    onResume: (listener) => {
      resume = listener;
    },
    minimize: () => {
      shell.minimized++;
    },
  };
  return { shell, pressBack: () => back(), sendAway: () => pause(), bringBack: () => resume() };
}

describe('attachNativeApp', () => {
  it('lets the game step back, and puts the app away when there is nowhere to go back to', () => {
    const { shell, pressBack } = fakeShell();
    let atRoot = false;
    let steps = 0;
    attachNativeApp(shell, {
      back: () => {
        steps++;
        return !atRoot;
      },
      leave: () => undefined,
      returned: () => undefined,
    });

    pressBack();
    expect(steps).toBe(1);
    expect(shell.minimized).toBe(0);

    atRoot = true;
    pressBack();
    expect(steps).toBe(2);
    expect(shell.minimized).toBe(1);
  });

  it('tells the game when the app goes to the background, and when it is back', () => {
    const { shell, sendAway, bringBack } = fakeShell();
    let left = 0;
    let returned = 0;
    attachNativeApp(shell, { back: () => true, leave: () => left++, returned: () => returned++ });

    sendAway();
    expect(left).toBe(1);
    expect(returned).toBe(0);
    bringBack();
    expect(returned).toBe(1);
  });
});

describe('isNativeApp', () => {
  it('is true only where the native bridge says so', () => {
    expect(isNativeApp({})).toBe(false);
    expect(isNativeApp({ Capacitor: {} })).toBe(false);
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
  });
});
