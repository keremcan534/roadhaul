import { expect, test, type Page } from '@playwright/test';

/** Collects console errors, console warnings and uncaught exceptions for the whole test. */
function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
  return problems;
}

/** Resolves after the browser has produced `count` more animation frames. */
async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let remaining = frames;
        const tick = (): void => {
          remaining--;
          if (remaining <= 0) {
            resolve();
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }),
    count,
  );
}

test('boots into the main menu and keeps rendering the world without errors', async ({ page }, testInfo) => {
  const problems = watchForProblems(page);

  await page.goto('/');

  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-boot-state', 'ready');
  await expect(html).toHaveAttribute('data-game-state', 'mainMenu');
  await expect(page.locator('.fatal-error')).toHaveCount(0);

  const canvas = page.locator('#game-canvas');
  const viewport = page.viewportSize();
  const box = await canvas.boundingBox();
  expect(box?.width).toBe(viewport?.width);
  expect(box?.height).toBe(viewport?.height);

  // The camera orbits, so two captures some frames apart must differ if frames are being drawn.
  await waitForFrames(page, 5);
  const first = await canvas.screenshot();
  await waitForFrames(page, 30);
  const second = await canvas.screenshot();
  expect(first.equals(second), 'the canvas stopped changing between frames').toBe(false);

  await testInfo.attach('main-menu', { body: second, contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('shows the performance overlay with ?debug', async ({ page }) => {
  const problems = watchForProblems(page);

  await page.goto('/?debug');

  await expect(page.locator('html')).toHaveAttribute('data-boot-state', 'ready');
  await expect(page.locator('.perf-overlay')).toContainText(/\d+ FPS · \d+ draws/);
  // Debug logging is on, but the only acceptable console output is below warning level.
  expect(problems).toEqual([]);
});
