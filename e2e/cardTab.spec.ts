/**
 * Task entry (v1.2.6): in an open card or Quick Entry, Tab goes
 * title, notes, then Start Date, Tags, Checklist, Deadline, Priority and
 * Context, opening each picker as it reaches it, and back to the title; in
 * WebKit (Safari) too. A choice made with Return keeps the card open and the
 * task where it was until the card closes.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTask, connect, openList, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

/** Where focus is: "Title", a field's or button's name, or the picker it's in. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    if (el.matches('input.title, textarea.title')) return 'Title';
    const picker = el.closest('[data-popover]')?.getAttribute('data-popover');
    const name = el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.textContent?.trim() ?? '';
    return picker ? `${picker}: ${name}` : name;
  });

/** Press Tab (or Shift+Tab) `n` times, collecting where focus lands. */
async function tabs(page: Page, n: number, key = 'Tab'): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(50); // a picker focuses its field on the next frame
    seen.push(await focused(page));
  }
  return seen;
}

/** The stops from the title, in the card and in Quick Entry alike (they share the field bar). */
const CARD_STOPS = [
  'Notes',
  'Start Date: Type a date',
  'Tags: Find or create a tag',
  'Add checklist',
  'Deadline: Type a date',
  'Priority: None',
  'Context: Manage Contexts…', // no contexts yet, so no None
  'Title',
];

test('Tab opens each picker in order, and a choice keeps the task in place until the card closes', async ({
  context,
  page,
}) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await openList(page, 'Unscheduled');
  await addTask(page, 'Book flights');
  const row = (t: string) => page.locator('li.row', { hasText: t });

  // The stops, each picker opening on its field or current choice, then round.
  await page.getByText('Book flights', { exact: true }).dblclick();
  await page.getByLabel('Title', { exact: true }).focus();
  expect(await tabs(page, 8)).toEqual(CARD_STOPS);
  // Shift+Tab goes back, and only one picker is ever open.
  expect(await tabs(page, 1, 'Shift+Tab')).toEqual(['Context: Manage Contexts…']);
  await expect(page.locator('[data-popover-panel]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-popover-panel]')).toHaveCount(0);

  // A new task, made with N in the Inbox: a typed start date keeps the card
  // open there on its new chip; the task moves when the card closes.
  await openList(page, 'Inbox');
  // Wait for the Inbox to open: opening a page closes any card, so an N pressed
  // before then makes a card that the page change closes at once.
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await page.keyboard.press('n');
  await page.keyboard.type('Pack bags');
  // The new card's title has focus before Tab (slower machines take a moment).
  await expect(page.getByRole('group', { name: 'Edit task' }).getByLabel('Title', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect.poll(() => focused(page)).toBe('Notes');
  await page.keyboard.press('Tab');
  await expect.poll(() => focused(page)).toBe('Start Date: Type a date');
  await page.keyboard.type('tom');
  await page.keyboard.press('Enter');
  // Focus is on the new chip (the date), not the button it replaced.
  await expect.poll(() => focused(page)).toMatch(/^Start Date: (?!Start Date)/);
  await page.waitForTimeout(300);
  await expect(page.getByRole('group', { name: 'Edit task' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect.poll(() => focused(page)).toBe('Tags: Find or create a tag');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Edit task' })).toHaveCount(0);
  // Closed in the Inbox, it stays there under the bar.
  await expect(page.getByRole('status').filter({ hasText: '1 task moved out of the Inbox' })).toBeVisible();
  await expect(row('Pack bags')).toBeVisible();

  // Quick Entry has the same stops, in the same order; Cancel, Save and Where aren't among them.
  await page.getByRole('toolbar', { name: 'Actions' }).getByRole('button', { name: 'New Task' }).click();
  expect(await tabs(page, 8)).toEqual(CARD_STOPS);

  expect(errors).toEqual([]);
});

test("a field picker is titled with the field's name and points at its button, which is highlighted", async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await openList(page, 'Unscheduled');
  await addTask(page, 'Book flights');
  await page.getByText('Book flights', { exact: true }).dblclick();
  const card = page.getByRole('group', { name: 'Edit task' });
  for (const field of ['Start Date', 'Deadline', 'Priority']) {
    const button = card.getByRole('button', { name: field, exact: true });
    await button.click();
    const panel = page.getByRole('dialog', { name: field });
    await expect(panel.locator('.sheet-title')).toBeVisible();
    await expect(panel.locator('.sheet-title')).toHaveText(field);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(button).not.toHaveCSS('box-shadow', 'none');
    // The arrow's tip sits under the middle of the button.
    const [b, a] = [await button.boundingBox(), await panel.locator('.arrow').boundingBox()];
    expect(Math.abs(a!.x + a!.width / 2 - (b!.x + b!.width / 2))).toBeLessThan(4);
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  }
  expect(errors).toEqual([]);
});
