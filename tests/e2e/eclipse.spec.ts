import { expect, test } from '@playwright/test';
import { openGame, watchForProblems } from './support';

test('an eclipse of the sun comes on its day, and its totality is pointed out', async ({ page }) => {
  const problems = watchForProblems(page);
  // 9 December 2026, a new moon's day, has one: its middle at 09:35, the sun low in the south-east. The clock
  // held there, the truck facing it.
  await openGame(page, '?lang=en&traffic=0&weather=clear&time=09:35&spawn=300,-641,45', { date: '2026-12-09' });
  await expect(page.locator('.toast').filter({ hasText: 'Totality! The moon hides the sun' })).toBeVisible({ timeout: 15_000 });
  expect(problems).toEqual([]);
});

test('an eclipse of the moon for a look (?sky=lunar): the copper moon is pointed out', async ({ page }) => {
  const problems = watchForProblems(page);
  // Its middle at the clock's time, held: the full moon low in the east of an evening.
  await openGame(page, '?lang=en&traffic=0&weather=clear&sky=lunar&time=19:05&spawn=300,-641,104', { date: '2027-01-22' });
  await expect(page.locator('.toast').filter({ hasText: 'A total eclipse of the moon' })).toBeVisible({ timeout: 15_000 });
  expect(problems).toEqual([]);
});
