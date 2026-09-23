import { expect, test } from '@playwright/test';
import {
  centreOf,
  headingChange,
  openGame,
  sceneScreenshot,
  shownHeading,
  shownSpeed,
  turnWheel,
  waitForFrames,
  watchForProblems,
  wheelRotation,
} from './support';

test('drives off from the HQ with the touch controls on screen', async ({ page }) => {
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

  // A quarter turn clockwise, from the top of the rim to its right side; the wheel re-centres when let go.
  await turnWheel(page, Math.PI / 2);
  await expect.poll(() => wheelRotation(page)).toBeGreaterThan(1.4);
  await page.mouse.up();
  await expect.poll(() => wheelRotation(page), { timeout: 5_000 }).toBeLessThan(0.05);

  expect(problems).toEqual([]);
});

// Seen from above, turning right lowers the heading and turning left raises it. Each direction starts
// fresh from the spawn: the truck turns 15° within a second there, long before it could reach a tree.
for (const [key, direction, name] of [
  ['ArrowRight', -1, 'right (clockwise)'],
  ['ArrowLeft', 1, 'left (anticlockwise)'],
] as const) {
  test(`steers ${name} with the ${key} key`, async ({ page }) => {
    const problems = watchForProblems(page);
    await openGame(page, '?debug');
    await page.keyboard.down('ArrowUp');
    await expect.poll(() => shownSpeed(page), { timeout: 20_000 }).toBeGreaterThan(15);
    const before = await shownHeading(page);

    await page.keyboard.down(key);
    await expect
      .poll(async () => direction * headingChange(before, await shownHeading(page)), { timeout: 10_000 })
      .toBeGreaterThan(15);

    await page.keyboard.up(key);
    await page.keyboard.up('ArrowUp');
    expect(problems).toEqual([]);
  });
}

test('turns the truck right when the on-screen wheel turns clockwise', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page, '?debug');
  await page.keyboard.down('ArrowUp'); // Gas from the keyboard, steering from the touch wheel.
  await expect.poll(() => shownSpeed(page), { timeout: 20_000 }).toBeGreaterThan(15);
  const before = await shownHeading(page);

  await turnWheel(page, Math.PI / 2);
  await expect.poll(async () => -headingChange(before, await shownHeading(page)), { timeout: 10_000 }).toBeGreaterThan(15);

  await page.mouse.up();
  await page.keyboard.up('ArrowUp');
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
