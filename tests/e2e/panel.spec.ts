import { expect, test, type Page } from '@playwright/test';
import { openCompanyHq, openPanel, watchForProblems } from './support';

/** Drags one finger up the screen from (x, y) by `distance` pixels, as a phone's touch screen reports it. */
async function swipeUp(page: Page, x: number, y: number, distance: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', atY: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: atY }] });
  await touch('touchStart', y);
  const steps = 10;
  for (let step = 1; step <= steps; step++) {
    await touch('touchMove', y - (distance * step) / steps);
  }
  await touch('touchEnd', y - distance);
  await cdp.detach();
}

const VIEWPORTS = {
  landscape: null, // The project's phone, on its side.
  portrait: { width: 412, height: 839 },
  'narrow portrait': { width: 360, height: 740 },
} as const;

for (const [orientation, viewport] of Object.entries(VIEWPORTS)) {
  test(`opens the company panel beside the road and scrolls its pages with a finger, ${orientation}`, async ({ page }) => {
    test.setTimeout(60_000);
    const problems = watchForProblems(page);
    if (viewport !== null) {
      await page.setViewportSize(viewport);
    }
    await openCompanyHq(page, '?lang=tr');
    const size = page.viewportSize()!;
    // Once it has slid in.
    await page.locator('.hq__sheet').evaluate((sheet) => Promise.all(sheet.getAnimations().map((animation) => animation.finished)));

    // The world stays in sight beside (or above) the panel, and the panel fits the screen.
    const sheet = (await page.locator('.hq__sheet').boundingBox())!;
    expect(sheet.width * sheet.height).toBeLessThan(size.width * size.height * 0.8);
    expect(sheet.x).toBeGreaterThanOrEqual(0);
    expect(sheet.y).toBeGreaterThanOrEqual(0);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(size.width + 1);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(size.height + 1);
    for (const selector of ['.hq__company-name', '.hq__credits', '[data-action="close-hq"]', '.hq__tab[data-tab="events"]']) {
      await expect(page.locator(selector)).toBeInViewport();
    }

    for (const tab of ['jobs', 'garage'] as const) {
      await openPanel(page, tab);
      const list = page.locator('.hq__list');
      const overflow = await list.evaluate((element) => element.scrollHeight - element.clientHeight);
      expect(overflow, `${tab}: the page is longer than the panel`).toBeGreaterThan(100);
      const box = (await list.boundingBox())!;
      // A finger dragged up on the cards scrolls them.
      await swipeUp(page, box.x + box.width / 2, box.y + box.height * 0.85, box.height * 0.6);
      await expect.poll(() => list.evaluate((element) => element.scrollTop), { message: `${tab}: swiped` }).toBeGreaterThan(40);
      // At the bottom of the page, its last card is whole on the screen, above the panel's edge.
      await list.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      const last = page.locator('.hq__list article').last();
      await expect(last).toBeInViewport();
      const lastBox = (await last.boundingBox())!;
      expect(lastBox.y + lastBox.height, `${tab}: the last card ends inside the list`).toBeLessThanOrEqual(box.y + box.height + 1);
      expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(size.height);
    }
    expect(problems).toEqual([]);
  });
}
