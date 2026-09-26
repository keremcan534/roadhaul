import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env['CI']);
const port = 4173;
/**
 * The game is drawn in software in these tests, and CI's runners draw it
 * slower than a developer's machine, some of them half as fast again as
 * others: there every test and every wait gets twice the time. Tests that
 * start the game twice or drive are marked slow (test.slow(): three times).
 */
const timeScale = isCI ? 2 : 1;

/**
 * End-to-end smoke tests (the spec's "PlayMode tests") against the production build.
 * Run `npm run build` first; the preview server only serves `dist/`.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  timeout: 30_000 * timeScale,
  expect: { timeout: 5_000 * timeScale },
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'android-phone',
      use: {
        ...devices['Pixel 7 landscape'],
        launchOptions: {
          // Headless Chromium has no GPU: render WebGL through SwiftShader.
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
});
