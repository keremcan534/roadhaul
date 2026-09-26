import { expect, test, type Locator } from '@playwright/test';
import { openCompanyHq, openPanel, takeContract, watchForProblems } from './support';

/** Wednesday 2026-09-23, 09:00 UTC: Safe Driver and Heavy Cargo run; Express Week starts on Monday. */
const SAFE_DRIVER_WEEK = '2026-09-23T09:00:00Z';

async function credits(locator: Locator): Promise<number> {
  return Number((await locator.textContent())!.replace(/\D/g, ''));
}

test('shows the events in the company panel, and pays a careful delivery the Safe Driver bonus', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?debug&lang=en', { date: SAFE_DRIVER_WEEK });
  const card = (eventId: string): Locator => page.locator(`.event-card[data-event-id="${eventId}"]`);

  await openPanel(page, 'events');
  await expect(page.locator('.event-card')).toHaveCount(3);
  await expect(card('safe_driver')).toHaveAttribute('data-state', 'running');
  await expect(card('safe_driver').locator('.event-card__terms')).toHaveText('Deliver the cargo without a scratch');
  await expect(card('safe_driver').locator('.event-card__objective')).toHaveText('0 / 3 deliveries');
  await expect(card('heavy_cargo')).toHaveAttribute('data-state', 'running');
  await expect(card('heavy_cargo').locator('.event-card__status')).toHaveText('Unlocks at level 2');
  await expect(card('express_week')).toHaveAttribute('data-state', 'upcoming');
  await expect(card('express_week').locator('.event-card__when')).toHaveText(/^Starts in 4 d 1[45] h$/);
  await testInfo.attach('events', { body: await page.screenshot(), contentType: 'image/png' });

  // Parked into both bays with the debug key: the cargo arrives without a scratch.
  await openPanel(page, 'jobs');
  await takeContract(page, 'first_package');
  await page.keyboard.press('KeyT');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });
  await page.keyboard.down('ArrowUp');
  await expect(html).toHaveAttribute('data-mission-state', 'delivering', { timeout: 10_000 });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('KeyT');

  const result = page.locator('.result-dialog');
  await expect(result).toBeVisible({ timeout: 15_000 });
  const event = result.locator('.result-dialog__event');
  await expect(event).toHaveCount(1);
  await expect(event.locator('.result-dialog__event-title')).toContainText('Safe Driver bonus');
  await expect(event.locator('.result-dialog__event-progress')).toHaveText('1 / 3 deliveries');
  // The balance holds the pay and the event's 15% on top.
  const total = await credits(result.locator('.result-dialog__line.is-total dd'));
  const bonus = await credits(event.locator('.result-dialog__event-bonus'));
  expect(bonus).toBe(Math.round(total * 0.15));
  expect(await credits(result.locator('.result-dialog__line').last().locator('dd'))).toBe(5000 + total + bonus);
  await testInfo.attach('result', { body: await page.screenshot(), contentType: 'image/png' });

  await result.locator('[data-action="continue"]').click();
  await page.locator('[data-action="dock-events"]').click();
  await expect(card('safe_driver').locator('.event-card__objective')).toHaveText('1 / 3 deliveries');
  expect(problems).toEqual([]);
});
