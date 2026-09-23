import { describe, expect, it, vi } from 'vitest';
import { capacitorShell } from '../../../src/platform/native/capacitorShell';

const plugin = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  minimized: 0,
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (eventName: string, listener: () => void) => {
      plugin.listeners.set(eventName, listener);
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
    minimizeApp: () => {
      plugin.minimized++;
      return Promise.resolve();
    },
  },
}));

describe('capacitorShell', () => {
  it("hands Capacitor's back button and pause events to the game, and minimizes through it", () => {
    const shell = capacitorShell();
    let backs = 0;
    let pauses = 0;

    shell.onBackButton(() => backs++);
    shell.onPause(() => pauses++);
    plugin.listeners.get('backButton')?.();
    plugin.listeners.get('pause')?.();
    shell.minimize();

    expect(backs).toBe(1);
    expect(pauses).toBe(1);
    expect(plugin.minimized).toBe(1);
  });
});
