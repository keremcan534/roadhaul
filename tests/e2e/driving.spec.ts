import { expect, test } from '@playwright/test';
import {
  centreOf,
  openGame,
  sceneScreenshot,
  shownSpeed,
  waitForFrames,
  watchForProblems,
  wheelRotation,
} from './support';

test('boots straight into driving with the touch controls on screen', async ({ page }) => {
  const problems = watchForProblems(page);

  await openGame(page);

  await expect(page.locator('.fatal-error')).toHaveCount(0);
  await expect(page.locator('.touch-controls')).toBeVisible();
  await expect(page.locator('.dashboard__speed')).toHaveText('0');
  await expect(page.locator('.dashboard__gear')).toHaveText('D1');
  const viewport = page.viewportSize();
  const canvas = await page.locator('#game-canvas').boundingBox();
  expect(canvas?.width).toBe(viewport?.width);
  expect(canvas?.height).toBe(viewport?.height);
  expect(problems).toEqual([]);
});

test('drives forward with the keyboard while the view follows the truck', async ({ page }, testInfo) => {
  const problems = watchForProblems(page);
  await openGame(page);
  await waitForFrames(page, 5);
  const before = await sceneScreenshot(page);

  await page.keyboard.down('ArrowUp');
  await expect.poll(() => shownSpeed(page), { timeout: 20_000 }).toBeGreaterThan(20);
  await page.keyboard.up('ArrowUp');

  const after = await sceneScreenshot(page);
  expect(before.equals(after), 'the view did not change while driving').toBe(false);
  await testInfo.attach('driving', { body: after, contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('engages reverse when the brake is held at a standstill', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page);

  await page.keyboard.down('ArrowDown');
  await expect(page.locator('.dashboard__gear')).toHaveText('R', { timeout: 10_000 });
  await expect.poll(() => shownSpeed(page), { timeout: 10_000 }).toBeGreaterThan(3);
  await page.keyboard.up('ArrowDown');

  expect(problems).toEqual([]);
});

test('drives with the on-screen gas pedal and steering wheel', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page);

  const gas = await centreOf(page, '.pedal--gas');
  await page.mouse.move(gas.x, gas.y);
  await page.mouse.down();
  await expect(page.locator('.pedal--gas')).toHaveClass(/is-pressed/);
  await expect.poll(() => shownSpeed(page), { timeout: 20_000 }).toBeGreaterThan(10);
  await page.mouse.up();
  await expect(page.locator('.pedal--gas')).not.toHaveClass(/is-pressed/);

  // Drag the wheel a quarter turn clockwise, from the top of the rim to its right side.
  const wheel = await centreOf(page, '.steering-wheel');
  const box = await page.locator('.steering-wheel').boundingBox();
  const radius = (box?.width ?? 100) * 0.42;
  await page.mouse.move(wheel.x, wheel.y - radius);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    const angle = -Math.PI / 2 + (step / 10) * (Math.PI / 2);
    await page.mouse.move(wheel.x + Math.cos(angle) * radius, wheel.y + Math.sin(angle) * radius);
  }
  await expect.poll(() => wheelRotation(page)).toBeGreaterThan(1.4);
  await page.mouse.up();
  await expect.poll(() => wheelRotation(page), { timeout: 5_000 }).toBeLessThan(0.05);

  expect(problems).toEqual([]);
});

test('switches between the chase and cabin cameras', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page);
  await waitForFrames(page, 5);
  const chase = await sceneScreenshot(page);

  await page.locator('.camera-button').click();
  await waitForFrames(page, 5);
  const cabin = await sceneScreenshot(page);
  await page.locator('.camera-button').click();

  expect(chase.equals(cabin), 'the camera did not change').toBe(false);
  expect(problems).toEqual([]);
});

test('shows the performance overlay with ?debug', async ({ page }) => {
  const problems = watchForProblems(page);

  await openGame(page, '?debug');

  await expect(page.locator('.perf-overlay')).toContainText(/\d+ FPS · \d+ draws/);
  expect(problems).toEqual([]);
});
