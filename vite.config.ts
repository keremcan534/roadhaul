import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs so the same build works from a sub-path (static hosting)
  // and from the local file system (a future Capacitor Android wrapper).
  base: './',
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
