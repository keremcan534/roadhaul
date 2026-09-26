import { expect, test } from '@playwright/test';
import { continueSavedCompany, savedCompany, watchForProblems } from './support';

test('brings the rivals\' trucks near the truck into the traffic', async ({ page }, testInfo) => {
  test.slow(); // Drawn in software, with traffic.
  const problems = watchForProblems(page);
  await continueSavedCompany(page, savedCompany({ credits: 60_000 }), '?lang=en&debug');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-company-trucks', '0');

  // Ten minutes on (debug F): the rivals' trucks are out on the roads, some of them near the truck.
  await page.keyboard.press('KeyF');
  await expect(root).toHaveAttribute('data-company-trucks', /^[1-9]\d*$/, { timeout: 60_000 });
  await testInfo.attach('company trucks', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});
