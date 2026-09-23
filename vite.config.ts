import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs so the same build works from a sub-path (static hosting)
  // and from the local file system (a future Capacitor Android wrapper).
  base: './',
  build: {
    target: 'es2022',
    // three.js alone is ~530 kB minified (~135 kB gzip). The limit is set just
    // above it, so the warning fires when game code starts to bloat the bundle.
    chunkSizeWarningLimit: 600,
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/architecture/**/*.test.ts'],
    environment: 'node',
  },
});
