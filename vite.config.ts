import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs so the same build works from a sub-path (static hosting)
  // and from the local file system (a future Capacitor Android wrapper).
  base: './',
  build: {
    target: 'es2022',
    // three.js with the geometry-merging addon is ~540 kB minified (~140 kB gzip).
    // The limit leaves room for the game code, so the warning fires when it
    // starts to bloat the bundle.
    chunkSizeWarningLimit: 650,
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/architecture/**/*.test.ts'],
    environment: 'node',
  },
});
