import { App } from '@capacitor/app';
import type { NativeAppShell } from './nativeApp';

/**
 * The Android app around the game, through Capacitor's App plugin. The
 * entry point loads this module only inside the app (isNativeApp), so the
 * web build does not download it.
 */
export function capacitorShell(): NativeAppShell {
  return {
    onBackButton: (listener) => {
      void App.addListener('backButton', () => listener());
    },
    onPause: (listener) => {
      void App.addListener('pause', () => listener());
    },
    minimize: () => {
      void App.minimizeApp();
    },
  };
}
