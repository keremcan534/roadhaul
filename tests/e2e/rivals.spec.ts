import { expect, test } from '@playwright/test';
import { closePanel, continueSavedCompany, openPanel, savedCompany, watchForProblems } from './support';

/** A company worth more than the smallest rival, saved just now: the rivals have not moved on while it was closed. */
function richCompany(): string {
  return JSON.stringify({ ...JSON.parse(savedCompany({ credits: 60_000 })), updatedAtMs: Date.now() });
}

test('ranks the companies, runs a campaign, buys a rival out and races another for a tender', async ({ page }, testInfo) => {
  test.slow(); // A campaign, a buy-out and a tender delivered, drawn in software.
  const problems = watchForProblems(page);
  await continueSavedCompany(page, richCompany(), '?lang=en&debug');
  const credits = page.locator('.hq__credits');

  // The league: the flatbed firm first, the company (60,000 and a 12,000 truck) second.
  await openPanel(page, 'rivals');
  const league = page.locator('.league__row');
  await expect(league).toHaveCount(4);
  await expect(league.nth(0)).toHaveAttribute('data-company-id', 'rival_demirkent');
  await expect(league.nth(1)).toHaveClass(/is-player/);
  await expect(league.nth(1).locator('.league__name')).toHaveText('Kuzey Lojistik (you)');
  await expect(league.nth(1).locator('.league__value')).toHaveText('72,000 credits');

  // Each city is led by its rival at first.
  const yeniliman = page.locator('.city-card[data-city-id="city_a"]');
  await expect(page.locator('.city-card')).toHaveCount(3);
  await expect(yeniliman.locator('.city-card__leader')).toHaveText('Led by Yeniliman Express');
  await expect(yeniliman.locator('.city-card__share')).toHaveText('Your share 0%');

  // A campaign in Yeniliman: a share of the city at once, then a wait before the next.
  await yeniliman.locator('[data-action="run-campaign"]').click();
  await expect(credits).toHaveText('54,000 credits');
  await expect(yeniliman.locator('.share-bar__part[data-company-id="player"]')).toBeVisible();
  await expect(yeniliman.locator('.city-card__share')).toHaveText(/^Your share [1-9]\d?%$/);
  await expect(yeniliman.locator('.city-card__wait')).toHaveText(/^Next campaign in \d+:\d\d$/);

  // Worth more than Yeniliman Express: bought out, its standing is the company's, and so is the city.
  const rival = page.locator('.rival-card[data-rival-id="rival_yeniliman"]');
  await expect(rival.locator('[data-action="buy-out-rival"]')).toHaveText('Buy out · 33,800 credits');
  await rival.locator('[data-action="buy-out-rival"]').click();
  await expect(credits).toHaveText('20,200 credits');
  await expect(page.locator('.toast').filter({ hasText: 'You lead Yeniliman now' })).toBeVisible();
  await expect(rival).toHaveClass(/is-acquired/);
  await expect(league).toHaveCount(3);
  await expect(yeniliman).toHaveClass(/is-yours/);
  await expect(yeniliman.locator('.city-card__share')).toHaveText('You lead: contracts from here pay 15% more');
  // The news, newest first: the city changing hands, and the buy-out that did it.
  await expect(page.locator('.rival-news__item').nth(0)).toHaveText(/^Yeniliman: Kuzey Lojistik takes the lead/);
  await expect(page.locator('.rival-news__item').nth(1)).toHaveText(/^You bought Yeniliman Express out(just now|1 min ago)$/);
  await testInfo.attach('rivals', { body: await page.screenshot(), contentType: 'image/png' });

  // Ten minutes on (debug F): a tender on the job board, raced by a rival still in business.
  await closePanel(page);
  await page.keyboard.press('KeyF');
  await expect(page.locator('.toast').filter({ hasText: /^New tender: / }).first()).toBeVisible();
  await openPanel(page, 'jobs');
  const tender = page.locator('.job-card--tender');
  await expect(tender).toHaveCount(1);
  await expect(page.locator('.job-card').first()).toHaveClass(/job-card--tender/);
  await expect(tender.locator('.badge--tender')).toHaveText('Tender');
  await expect(tender.locator('.job-card__race')).toHaveText(/^Against (Başakova Cargo|Demirkent Haulage): first to unload wins [\d,]+ credits$/);
  // Contracts from Yeniliman pay the leader's bonus.
  await expect(page.locator('.job-card[data-mission-id="first_package"] .job-card__leader')).toHaveText("Leader's bonus 15%");

  // Taken and loaded: the race is on, and the HUD shows the rival's time.
  await tender.locator('[data-action="accept"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-panel', 'none');
  await expect(page.locator('.mission-hud__race')).toHaveText('The race starts at loading');
  await page.keyboard.press('KeyT');
  await expect(page.locator('html')).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });
  await expect(page.locator('.mission-hud__race')).toHaveText(/^Rival ETA \d+:\d\d$/);
  await testInfo.attach('race', { body: await page.screenshot(), contentType: 'image/png' });

  // Off the bay, then parked at the delivery bay at once: well ahead of the rival.
  await page.keyboard.down('ArrowUp');
  await expect(page.locator('html')).toHaveAttribute('data-mission-state', 'delivering', { timeout: 10_000 });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('KeyT');
  const result = page.locator('.result-dialog');
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result.locator('.result-dialog__tender')).toHaveText(/^Tender won against (Başakova Cargo|Demirkent Haulage)\+[\d,]+ credits$/);
  await testInfo.attach('result', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});
