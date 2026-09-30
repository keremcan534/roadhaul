import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * The ads this build shows (docs/RELEASE.md), from ROADHAUL_ADS: `off` (the default), none; `test`, Google's test
 * ads; `live`, the game's own AdMob ad units (ROADHAUL_ADMOB_REWARDED_ID, ROADHAUL_ADMOB_INTERSTITIAL_ID). Only the
 * Android app shows ads; capacitor.config.js reads the same switch to put the AdMob plugin in it.
 */
function adsBuild(): { readonly mode: 'off' | 'test' | 'live'; readonly rewarded: string; readonly interstitial: string } {
  const mode = process.env.ROADHAUL_ADS || 'off';
  if (mode !== 'off' && mode !== 'test' && mode !== 'live') {
    throw new Error(`ROADHAUL_ADS must be off, test or live, not "${mode}".`);
  }
  const rewarded = process.env.ROADHAUL_ADMOB_REWARDED_ID ?? '';
  const interstitial = process.env.ROADHAUL_ADMOB_INTERSTITIAL_ID ?? '';
  if (mode === 'live' && (rewarded === '' || interstitial === '')) {
    throw new Error('ROADHAUL_ADS=live needs ROADHAUL_ADMOB_REWARDED_ID and ROADHAUL_ADMOB_INTERSTITIAL_ID (docs/RELEASE.md).');
  }
  return { mode, rewarded, interstitial };
}

const ADS = adsBuild();

/** The packages the game ships (to the browser and in the Android app): their licences go with it. */
const SHIPPED_PACKAGES = [
  'three',
  '@capacitor/core',
  '@capacitor/app',
  '@capacitor/android',
  '@capgo/native-purchases',
  ...(ADS.mode === 'off' ? [] : ['@capacitor-community/admob']),
];

/**
 * `licenses.txt` beside the page: the licence of every package the game
 * ships, for Settings' open-source licences page (fetched when it opens).
 * Built from node_modules, so it follows the versions installed; the dev
 * server serves the same text.
 */
function openSourceLicenses(): Plugin {
  const fileName = 'licenses.txt';
  const text = (): string => {
    const parts = SHIPPED_PACKAGES.map((name) => {
      const folder = new URL(`./node_modules/${name}/`, import.meta.url);
      const { version, license } = JSON.parse(readFileSync(new URL('package.json', folder), 'utf8')) as {
        version: string;
        license: string;
      };
      return `${name} ${version} (${license})\n\n${readFileSync(new URL('LICENSE', folder), 'utf8').trim()}`;
    });
    parts.push(
      'AndroidX and Guava (the Android app)\n\n' +
        'The Android app also contains AndroidX libraries, Copyright The Android Open Source Project, and Guava, ' +
        'Copyright The Guava Authors, licensed under the Apache License, Version 2.0: ' +
        'https://www.apache.org/licenses/LICENSE-2.0',
      "Google's libraries (the Android app)\n\n" +
        `The Android app also contains the Google Play Billing Library${ADS.mode === 'off' ? '' : ', the Google Mobile Ads SDK and the User Messaging Platform SDK'}, ` +
        'Copyright Google LLC, licensed under the Android Software Development Kit License Agreement: ' +
        'https://developer.android.com/studio/terms',
    );
    return `${parts.join(`\n\n${'—'.repeat(24)}\n\n`)}\n`;
  };
  return {
    name: 'roadhaul-open-source-licenses',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0]?.endsWith(`/${fileName}`)) {
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(text());
        } else {
          next();
        }
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source: text() });
    },
  };
}

export default defineConfig({
  // Relative asset URLs so the same build works from a sub-path (static hosting)
  // and from the local file system (a future Capacitor Android wrapper).
  base: './',
  // The version shown in Settings (package.json), and the build: CI numbers it (ROADHAUL_VERSION_CODE, the Android
  // app's versionCode too); a build on a desktop is `dev`.
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_BUILD__: JSON.stringify(process.env.ROADHAUL_VERSION_CODE ?? 'dev'),
    __ADS__: JSON.stringify(ADS),
  },
  plugins: [openSourceLicenses()],
  // android/ holds copies of the build and Gradle's output: the dev server neither scans nor watches them.
  optimizeDeps: { entries: ['index.html'] },
  server: { watch: { ignored: ['**/android/**'] } },
  build: {
    target: 'es2022',
    // three.js with the geometry-merging addon is ~540 kB minified (~140 kB gzip):
    // its own chunk, so the warning watches the game code and three.js alone.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        // three.js changes far less often than the game: in its own file it stays
        // cached in players' browsers across game updates.
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/architecture/**/*.test.ts'],
    environment: 'node',
    // A test that boots the game builds its world, grown country and all: up to a second here, and
    // over twice that on a busy CI runner, three times in the tests that save and continue. Vitest's
    // 5 s default leaves those too little room; a test that hangs still fails.
    testTimeout: 15_000,
  },
});
