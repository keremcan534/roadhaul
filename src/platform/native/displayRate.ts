import { registerPlugin } from '@capacitor/core';

/** The Android app's own plugin (android/…/DisplayRatePlugin.java): the screen's refresh rate. */
interface DisplayRatePlugin {
  setPreferredRate(options: { hz: number }): Promise<{ hz: number }>;
}

const DisplayRate = registerPlugin<DisplayRatePlugin>('DisplayRate');

/**
 * Asks the phone to show the app at up to `hz` (the fastest mode its screen
 * has at that or under: 90 or 120 Hz on such phones; 0: the system's
 * choice). Resolves to the rate it shows at, or 0 where it cannot say. The
 * entry point loads this module only in the Android app.
 */
export function preferRefreshRate(hz: number): Promise<number> {
  return DisplayRate.setPreferredRate({ hz })
    .then((result) => result.hz)
    .catch(() => 0);
}
