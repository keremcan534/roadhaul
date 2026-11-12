/**
 * What the game needs from the Android app around it (Capacitor's App
 * plugin, see capacitorShell.ts), so the rules below run and are tested
 * without it.
 */
export interface NativeAppShell {
  /** The system back button (or back gesture) was used. */
  onBackButton(listener: () => void): void;
  /** The app is going to the background. */
  onPause(listener: () => void): void;
  /** The app is back in the foreground. */
  onResume(listener: () => void): void;
  /** Puts the app away, like the home button: it keeps its state. */
  minimize(): void;
}

export interface NativeAppActions {
  /** Steps back one screen or closes what is open; false when there is nowhere to go back to. */
  back(): boolean;
  /** The player is leaving the game for now: pause the drive and save. */
  leave(): void;
  /** The player is back. */
  returned(): void;
}

/**
 * Inside the Android app: the back button steps back through the game and,
 * at its root, puts the app away; going to the background pauses and saves; the game hears when the app is back.
 */
export function attachNativeApp(shell: NativeAppShell, actions: NativeAppActions): void {
  shell.onBackButton(() => {
    if (!actions.back()) {
      shell.minimize();
    }
  });
  shell.onPause(() => actions.leave());
  shell.onResume(() => actions.returned());
}

/** The global that Capacitor's native bridge sets up before the page's scripts run, in the app only. */
interface CapacitorGlobal {
  readonly Capacitor?: { readonly isNativePlatform?: () => boolean };
}

/** True inside the Android app, false in a browser. */
export function isNativeApp(window: object): boolean {
  return (window as CapacitorGlobal).Capacitor?.isNativePlatform?.() === true;
}
