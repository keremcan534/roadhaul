import { expect, test } from '@playwright/test';

/** The boot screen's note for a WebView too old for the game (index.html's inline script). */
test('tells a phone whose WebView is too old to update it, instead of loading for ever', async ({ page }, testInfo) => {
  // The game's module as an old WebView sees it: syntax it cannot parse (for one before Chrome 94, a static block).
  await page.route(/\/assets\/index-[^/]+\.js$/, (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const later = ;' }));
  await page.goto('./?lang=tr');

  const screen = page.locator('.boot-screen');
  await expect(page.locator('html')).toHaveAttribute('data-boot-state', 'unsupported');
  await expect(screen).toBeVisible();
  await expect(screen.locator('.boot-screen__bar')).toBeHidden();
  await expect(screen.locator('.boot-screen__note')).toHaveText(/^RoadHaul daha yeni bir Android System WebView istiyor\./);
  await expect(screen.locator('.boot-screen__update')).toHaveText('Google Play’i aç');
  await expect(screen.locator('.boot-screen__update')).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=com.google.android.webview');
  await testInfo.attach('old webview', { body: await page.screenshot(), contentType: 'image/png' });
});
