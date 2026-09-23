import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env['CI']);
const port = 4173;

/**
 * End-to-end smoke tests (the spec's "PlayMode tests") against the production build.
 * Run `npm run build` first; the preview server only serves `dist/`.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
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
