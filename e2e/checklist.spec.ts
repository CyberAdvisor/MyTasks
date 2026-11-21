/**
 * Reordering a checklist (FR-7.1, Milestone 11 PR 3): by the handle at the end
 * of each item, with a mouse (here) or on touch (e2e/phone.spec.ts), and with
 * Cmd/Ctrl+Up/Down or Alt+Up/Down. A press on the item's text doesn't drag,
 * and there is no delete button: erasing the text deletes the item.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { connect, openList, restoreSample, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

/** The open card's checklist items, as shown. */
const items = (page: Page) => page.locator('ul.checklist li');

/** The open card's checklist titles, in the order shown. */
async function titles(page: Page): Promise<string[]> {
  return items(page).locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
}

/** Press on `from` and drop above the item `to`, with the mouse, in small steps. */
async function dragAbove(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 - 6, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + 3, { steps: 8 });
  await page.mouse.up();
}

/** The sample task "Review homepage copy", open: Headline ✓, Pricing section ✓, Footer links. */
async function openReview(page: Page): Promise<void> {
  await openList(page, 'Today');
  await page.getByText('Review homepage copy', { exact: true }).dblclick();
  await expect(items(page)).toHaveCount(3);
}

test.beforeEach(async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await restoreSample(page);
});

test('the handle drags an item; its text does not; there is no delete button', async ({ page }) => {
  const errors = watchErrors(page);
  await openReview(page);
  expect(await titles(page)).toEqual(['Headline', 'Pricing section', 'Footer links']);
  await expect(items(page).getByRole('button', { name: 'Delete item' })).toHaveCount(0);

  // Pressing on the text and moving selects text; nothing moves.
  await dragAbove(page, items(page).nth(2).locator('input'), items(page).nth(0));
  expect(await titles(page)).toEqual(['Headline', 'Pricing section', 'Footer links']);

  // The handle moves it, with no "Moved" message.
  await dragAbove(page, items(page).nth(2).locator('[data-drag-handle]'), items(page).nth(0));
  await expect.poll(() => titles(page)).toEqual(['Footer links', 'Headline', 'Pricing section']);
  await expect(page.getByText('Moved', { exact: true })).toBeHidden();

  // It stays after the card closes and opens again.
  await page.keyboard.press('Escape');
  await page.getByText('Review homepage copy', { exact: true }).dblclick();
  await expect.poll(() => titles(page)).toEqual(['Footer links', 'Headline', 'Pricing section']);

  // Undo puts it back.
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  await page.getByText('Review homepage copy', { exact: true }).dblclick();
  await expect.poll(() => titles(page)).toEqual(['Headline', 'Pricing section', 'Footer links']);
  expect(errors).toEqual([]);
});

test('while dragging, the other items slide apart to show where it lands; no line', async ({ page }) => {
  await openReview(page);
  const handle = items(page).nth(2).locator('[data-drag-handle]');
  const a = (await handle.boundingBox())!;
  const top = (await items(page).nth(1).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, top.y + 4, { steps: 8 });
  // Pricing section moves down a place to open the gap; the dragged item shows only as its copy.
  await expect(items(page).nth(1)).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 0, [1-9]/);
  await expect(items(page).nth(2)).toHaveCSS('opacity', '0');
  await expect(page.locator('.drop-line')).toBeHidden();
  await page.mouse.up();
  await expect.poll(() => titles(page)).toEqual(['Headline', 'Footer links', 'Pricing section']);
  // Once drawn in the new order, nothing is left moved or hidden.
  await expect(items(page).nth(1)).toHaveCSS('opacity', '1');
  for (const i of [0, 1, 2]) await expect(items(page).nth(i)).toHaveCSS('transform', 'none');
});

test('Cmd/Ctrl+Up and Down move an item, as Alt+Up and Down do; the task stays put', async ({ page }) => {
  await openList(page, 'Today');
  const rows = page.locator('li.row');
  await expect(rows.filter({ hasText: 'Review homepage copy' })).toBeVisible();
  const before = await rows.allInnerTexts();
  await openReview(page);
  await items(page).nth(2).locator('input').click();
  await page.keyboard.press('ControlOrMeta+ArrowUp');
  await expect.poll(() => titles(page)).toEqual(['Headline', 'Footer links', 'Pricing section']);
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => titles(page)).toEqual(['Footer links', 'Headline', 'Pricing section']);
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await expect.poll(() => titles(page)).toEqual(['Headline', 'Footer links', 'Pricing section']);
  await expect(items(page).nth(1).locator('input')).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await rows.allInnerTexts()).toEqual(before);
});

test('with checked items at the bottom, a drop lands where it was made', async ({ page }) => {
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByLabel('Move checked items to the bottom of the checklist').check();
  await openReview(page);
  expect(await titles(page)).toEqual(['Footer links', 'Headline', 'Pricing section']);
  await dragAbove(page, items(page).nth(2).locator('[data-drag-handle]'), items(page).nth(1));
  await expect.poll(() => titles(page)).toEqual(['Footer links', 'Pricing section', 'Headline']);
});

test('Quick Entry’s checklist reorders by its handle before the task is saved', async ({ page }) => {
  await openList(page, 'Inbox');
  await page.getByRole('toolbar', { name: 'Actions' }).getByRole('button', { name: 'New Task' }).click();
  const qe = page.getByRole('dialog', { name: 'Quick Entry' });
  await qe.getByPlaceholder('New Task').fill('Packing');
  await qe.getByRole('button', { name: 'Add checklist' }).click();
  for (const [i, t] of ['One', 'Two', 'Three'].entries()) {
    if (i) await page.keyboard.press('Enter');
    await page.keyboard.type(t);
  }
  await expect(items(page)).toHaveCount(3);
  await dragAbove(page, items(page).nth(2).locator('[data-drag-handle]'), items(page).nth(0));
  await expect.poll(() => titles(page)).toEqual(['Three', 'One', 'Two']);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(qe).toBeHidden();
  await page.getByText('Packing', { exact: true }).dblclick();
  await expect.poll(() => titles(page)).toEqual(['Three', 'One', 'Two']);
});
