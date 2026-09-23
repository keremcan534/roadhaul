import { expect, test } from '@playwright/test';
import { openGame, watchForProblems } from './support';

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
