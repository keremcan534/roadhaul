import { expect, test } from '@playwright/test';
import { centreOf, openGame, shownSpeed, watchForProblems } from './support';

const CONTROLS = ['.steering-wheel', '.pedal--gas', '.pedal--brake', '.dashboard', '.camera-button'] as const;

for (const orientation of ['landscape', 'portrait'] as const) {
  test(`lays out the touch controls without overlaps in ${orientation}`, async ({ page }) => {
    const problems = watchForProblems(page);
    if (orientation === 'portrait') {
      await page.setViewportSize({ width: 412, height: 839 }); // Pixel 7 held upright.
    }
    await openGame(page);

    const viewport = page.viewportSize()!;
    const boxes = await Promise.all(CONTROLS.map((selector) => page.locator(selector).boundingBox()));
    boxes.forEach((box, index) => {
      expect(box, `${CONTROLS[index]} is not shown`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    });
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const first = boxes[a]!;
        const second = boxes[b]!;
        const overlap =
          first.x < second.x + second.width &&
          second.x < first.x + first.width &&
          first.y < second.y + second.height &&
          second.y < first.y + first.height;
        expect(overlap, `${CONTROLS[a]} overlaps ${CONTROLS[b]}`).toBe(false);
      }
    }
    expect(problems).toEqual([]);
  });
}

test('keeps a pedal pressed until the last finger on it lifts', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page);
  const gas = page.locator('.pedal--gas');
  const centre = await centreOf(page, '.pedal--gas');
  // Count lifted fingers, so the test cannot pass without actually lifting one.
  await gas.evaluate((pedal) =>
    pedal.addEventListener('pointerup', () =>
      pedal.setAttribute('data-test-lifts', String(Number(pedal.getAttribute('data-test-lifts') ?? 0) + 1)),
    ),
  );
  // Real multi-touch through the DevTools protocol. In Chromium, touchStart adds the new points
  // and touchEnd lifts exactly the points it lists (all of them when it lists none).
  const cdp = await page.context().newCDPSession(page);
  const thumb = { x: centre.x, y: centre.y - 15, id: 1 };
  const finger = { x: centre.x, y: centre.y + 15, id: 2 };
  const touch = (type: 'touchStart' | 'touchEnd', touchPoints: (typeof thumb)[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints });

  await touch('touchStart', [thumb]);
  await touch('touchStart', [thumb, finger]);
  await expect(gas).toHaveClass(/is-pressed/);
  await touch('touchEnd', [finger]);
  await expect(gas).toHaveAttribute('data-test-lifts', '1');

  // The thumb is still down: the pedal stays pressed and the truck keeps accelerating.
  await expect(gas).toHaveClass(/is-pressed/);
  await expect.poll(() => shownSpeed(page), { timeout: 20_000 }).toBeGreaterThan(10);
  await expect(gas).toHaveClass(/is-pressed/);

  await touch('touchEnd', []);
  await expect(gas).toHaveAttribute('data-test-lifts', '2');
  await expect(gas).not.toHaveClass(/is-pressed/);
  expect(problems).toEqual([]);
});
