import { expect, test, type Page } from '@playwright/test';
import { isYardCleared, slideVehicle, yardJamSolution, type YardJam, type YardVehicle } from '../../src/domain/puzzles/yardJam';
import { openGame, watchForProblems } from './support';

const html = (page: Page) => page.locator('html');

/** A new company's truck started beside one of North Valley's places, then parked on its lot (the debug G key). */
async function parkAtPlace(page: Page, spawn: string): Promise<void> {
  await openGame(page, `?debug&lang=en&traffic=0&spawn=${spawn}`);
  await page.keyboard.press('KeyG');
  await expect(page.locator('.place-panel')).toBeVisible({ timeout: 15_000 });
}

/** The yard as the dialog shows it: each vehicle's bays, its length and which way it lies. */
async function shownYard(page: Page): Promise<YardJam> {
  return page.locator('.yard-jam__vehicle').evaluateAll((pieces) =>
    pieces.map((piece) => {
      const style = (piece as HTMLElement).style;
      return {
        row: Number(style.getPropertyValue('--row')),
        col: Number(style.getPropertyValue('--col')),
        length: Number(style.getPropertyValue('--length')) as 2 | 3,
        horizontal: (piece as HTMLElement).dataset.lies === 'along-row',
      } satisfies YardVehicle;
    }),
  );
}

/** Drags vehicle `index` `bays` bays along its length (negative: back). */
async function slide(page: Page, index: number, bays: number, horizontal: boolean): Promise<void> {
  const board = await page.locator('.yard-jam__board').boundingBox();
  const piece = await page.locator(`.yard-jam__vehicle[data-index="${index}"]`).boundingBox();
  const bay = board!.width / 6;
  const x = piece!.x + Math.min(piece!.width, bay) / 2;
  const y = piece!.y + Math.min(piece!.height, bay) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (horizontal ? bays * bay : 0), y + (horizontal ? 0 : bays * bay), { steps: 6 });
  await page.mouse.up();
}

test('finds the diner, and clears the day\'s Yard Jam on its placemat for the reward', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await parkAtPlace(page, '-600,-480,110');

  const panel = page.locator('.place-panel');
  await expect(panel).toHaveAttribute('data-kind', 'diner');
  await expect(panel.locator('.place-panel__name')).toHaveText('Kettle Creek Diner');
  await expect(page.locator('.toast').filter({ hasText: 'New place: Kettle Creek Diner!' })).toBeVisible();
  await panel.locator('[data-action="place-action"]').click();

  const dialog = page.locator('.yard-jam');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.yard-jam__title')).toHaveText('Today’s Yard Jam');
  await expect(dialog.locator('[data-value="moves"]')).toHaveText('Moves: 0');
  const dealt = await shownYard(page);
  const solution = yardJamSolution(dealt)!;
  expect(solution.length).toBeGreaterThanOrEqual(4);

  // One move, then back to the yard as dealt.
  const first = solution[0]!;
  const vehicle = dealt[first.index]!;
  await slide(page, first.index, first.position - (vehicle.horizontal ? vehicle.col : vehicle.row), vehicle.horizontal);
  await expect(dialog.locator('[data-value="moves"]')).toHaveText('Moves: 1');
  await dialog.locator('[data-action="yard-jam-restart"]').click();
  await expect(dialog.locator('[data-value="moves"]')).toHaveText('Moves: 0');

  // The fewest moves, as the solver finds them.
  let yard = dealt;
  for (const move of solution) {
    const moving = yard[move.index]!;
    await slide(page, move.index, move.position - (moving.horizontal ? moving.col : moving.row), moving.horizontal);
    yard = slideVehicle(yard, move.index, move.position);
  }
  expect(isYardCleared(yard)).toBe(true);
  await expect(dialog.locator('[data-value="moves"]')).toHaveText(`Yard cleared! Moves: ${solution.length}`);
  await expect(dialog.locator('.yard-jam__reward')).toHaveText('+1,200 credits and 100 XP for today’s yard');

  await dialog.locator('[data-action="yard-jam-close"]').click();
  await expect(dialog).toBeHidden();
  // Still on the lot: the counter is back, and today's yard is done.
  await expect(panel.locator('.place-panel__line')).toHaveText('You cleared today’s yard. Another one for fun?');
  expect(problems).toEqual([]);
});

test('scrubs the truck clean at the truck wash for its tip', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await parkAtPlace(page, '-1690,420,12');

  const panel = page.locator('.place-panel');
  await expect(panel).toHaveAttribute('data-kind', 'truckWash');
  await panel.locator('[data-action="place-action"]').click();
  const wash = page.locator('.truck-wash');
  await expect(wash).toBeVisible();
  await expect(wash.locator('[data-value="clean"]')).toHaveText('0%');

  // Rub back and forth over the whole picture, a brush's width down each pass.
  const stage = (await wash.locator('.truck-wash__dirt').boundingBox())!;
  const pass = stage.width * 0.06 * 1.4;
  await page.mouse.move(stage.x + 2, stage.y + 2);
  await page.mouse.down();
  for (let y = stage.y + pass / 2, leftward = false; y < stage.y + stage.height; y += pass, leftward = !leftward) {
    await page.mouse.move(leftward ? stage.x + 2 : stage.x + stage.width - 2, y, { steps: 12 });
    await page.mouse.move(leftward ? stage.x + 2 : stage.x + stage.width - 2, Math.min(y + pass, stage.y + stage.height - 2), { steps: 2 });
  }
  await page.mouse.up();

  await expect(wash.locator('.truck-wash__result')).toHaveText('Sparkling clean! The wash tips you 300 credits.');
  await wash.locator('[data-action="wash-close"]').click();
  await expect(wash).toBeHidden();
  await expect(panel.locator('.place-panel__line')).toHaveText('Washed today, and still shining. Again for fun?');
  expect(problems).toEqual([]);
});

test('takes a photo of the view at the lookout, and goes back to the road', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await parkAtPlace(page, '-1600,1700,29');

  const panel = page.locator('.place-panel');
  await expect(panel).toHaveAttribute('data-kind', 'lookout');
  await expect(panel.locator('.place-panel__line')).toHaveText('The open sea below the cliffs, and gulls riding the wind.');
  await panel.locator('[data-action="place-action"]').click();
  await expect(html(page)).toHaveAttribute('data-photo', 'on');

  await page.locator('[data-action="photo-close"]').click();
  await expect(html(page)).not.toHaveAttribute('data-photo', 'on');
  await expect(page.locator('.pause-menu')).toBeHidden();
  await expect(panel).toBeVisible();
  expect(problems).toEqual([]);
});
