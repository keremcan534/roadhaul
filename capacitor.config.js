// The Android app's Capacitor settings, read by `npx cap sync` (npm run android). A script rather than JSON for the
// ads: ROADHAUL_ADS (off, test or live; docs/RELEASE.md) decides whether the AdMob plugin, and Google's ads SDK with
// it, goes into the app at all. Off by default: a build without ads carries no ads code. vite.config.ts reads the
// same switch for the game's side.
const ads = process.env.ROADHAUL_ADS || 'off';

/** The plugins the app is built with: every other package is left out of it. */
const plugins = ['@capacitor/app', '@capgo/native-purchases', ...(ads === 'off' ? [] : ['@capacitor-community/admob'])];

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: 'io.github.keremcan534.roadhaul',
  appName: 'RoadHaul',
  webDir: 'dist',
  backgroundColor: '#1b2430',
  android: { includePlugins: plugins },
  plugins: {
    SystemBars: {
      hidden: true,
      initialViewportFitValueHint: 'cover',
    },
  },
};

// The Capacitor CLI loads this file with require(): Node hands it this export as the module's value.
export { config as 'module.exports' };
