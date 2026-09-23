import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs so the same build works from a sub-path (static hosting)
  // and from the local file system (a future Capacitor Android wrapper).
  base: './',
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
  },
});
