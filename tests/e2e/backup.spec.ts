import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { foundCompany, openMainMenu, openSettingsWhileDriving, savedCompany, watchForProblems } from './support';

test('backs the company up to a file from Settings, and restores another from the main menu after asking', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await openMainMenu(page, '?lang=en&traffic=0');
  await foundCompany(page, 'Işık Lojistik');

  // In a drive: a backup, but no restoring.
  await openSettingsWhileDriving(page);
  const row = page.locator('[data-setting="company"]');
  await expect(row.locator('.settings__label')).toHaveText('Your company');
  await expect(row.locator('[data-action="restore-backup"]')).toBeDisabled();
  await expect(row.locator('.settings__restore-note')).toHaveText('A backup is restored from the main menu.');
  await expect(row.locator('.settings__restore-note')).toBeVisible();
  // Where the browser has no share sheet for it, the backup downloads, named for the company and the day.
  const downloading = page.waitForEvent('download');
  await row.locator('[data-action="backup-company"]').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^roadhaul-isik-lojistik-\d{8}\.json$/);
  await expect(page.locator('.toast').filter({ hasText: 'Backup saved to your downloads.' })).toBeVisible();
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8')) as { version: number; profile: { companyName: string } };
  expect(backup.profile.companyName).toBe('Işık Lojistik');
  expect(backup.version).toBeGreaterThanOrEqual(22);

  // Back on the main menu, with the company still loaded: a backup of another company, an old save, restored over it.
  await page.locator('[data-action="close-settings"]').click();
  await page.locator('[data-action="pause-main-menu"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'mainMenu');
  await page.locator('.main-menu [data-action="settings"]').click();
  await expect(row.locator('[data-action="restore-backup"]')).toBeEnabled();
  await expect(row.locator('.settings__restore-note')).toBeHidden();
  const input = row.locator('[data-input="backup-file"]');

  // Not a backup: refused, nothing asked.
  await input.setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"shopping": ["diesel"]}') });
  await expect(page.locator('.toast').filter({ hasText: 'That file is not a RoadHaul backup, or it is damaged.' })).toBeVisible();
  await expect(row.locator('.settings__confirm')).toBeHidden();

  // A backup: the question names what it holds; keeping theirs changes nothing.
  const other = { name: 'kuzey.json', mimeType: 'application/json', buffer: Buffer.from(savedCompany()) };
  await input.setInputFiles(other);
  const question = row.locator('.settings__confirm-question');
  await expect(question).toHaveText('Replace the company on this device with Kuzey Lojistik (level 2, 30,000 credits)?');
  await row.locator('[data-action="cancel-restore"]').click();
  await expect(row.locator('.settings__confirm')).toBeHidden();

  // Replaced: the game starts again with it.
  await input.setInputFiles(other);
  await expect(question).toBeVisible();
  const reloaded = page.waitForEvent('load');
  await row.locator('[data-action="confirm-restore"]').click();
  await expect(page.locator('.toast').filter({ hasText: 'Kuzey Lojistik is back. Starting again…' })).toBeVisible();
  await reloaded;
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'mainMenu');
  await expect(page.locator('.main-menu__card-name')).toHaveText('Kuzey Lojistik');
  await page.locator('[data-action="continue-game"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving');
  expect(problems).toEqual([]);
});
