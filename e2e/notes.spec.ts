/**
 * Light Markdown in notes (FR-7.4): a saved note shows bold, italic, lists and
 * links when it isn't being edited; a click on a link opens it in a new tab, and
 * a click anywhere else, or Tab, turns it back into the text box holding what was
 * typed. Only http, https and mailto addresses become links. Project notes work
 * the same way.
 */
import { expect, test, type Page } from '@playwright/test';
import { connect, openList, restoreSample, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

const NOTE = 'Call **before noon**, _politely_.\n- receipt\n- [the shop](https://example.com/shop)\n[bad](javascript:alert(1))';

test.beforeEach(async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await restoreSample(page);
});

async function openCard(page: Page): Promise<void> {
  await page.getByText('Pick up dry cleaning', { exact: true }).dblclick();
}

test('a task’s note shows its styles and links, and becomes the text box again when clicked', async ({ page, context }) => {
  const errors = watchErrors(page);
  await openList(page, 'Today');
  await openCard(page);
  await page.getByLabel('Notes', { exact: true }).fill(NOTE);
  await page.keyboard.press('Escape');
  await openCard(page);

  const note = page.getByRole('textbox', { name: 'Notes', exact: true });
  await expect(note.locator('strong')).toHaveText('before noon');
  await expect(note.locator('em')).toHaveText('politely');
  await expect(note.locator('li')).toHaveText(['receipt', 'the shop']);
  // Solid bullets, though the card sits inside the task list.
  await expect(note.locator('ul')).toHaveCSS('list-style-type', 'disc');
  const shop = note.getByRole('link', { name: 'the shop' });
  await expect(shop).toHaveAttribute('href', 'https://example.com/shop');
  await expect(shop).toHaveAttribute('target', '_blank');
  // A javascript: address stays text.
  await expect(note.getByRole('link')).toHaveCount(1);
  await expect(note).toContainText('[bad](javascript:alert(1))');

  // The link opens in a new tab, and the note stays styled.
  await context.route('https://example.com/**', (route) => route.fulfill({ body: 'shop' }));
  const [tab] = await Promise.all([context.waitForEvent('page'), shop.click()]);
  await tab.close();
  await expect(note.locator('strong')).toBeVisible();

  // A click elsewhere edits the text as typed, the caret at its end.
  await note.locator('strong').click();
  const box = page.locator('textarea[aria-label="Notes"]');
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(NOTE);
  await page.keyboard.type('!');
  await expect(box).toHaveValue(`${NOTE}!`);
  // Leaving the box shows the note again.
  await page.getByLabel('Title', { exact: true }).click();
  await expect(note.locator('strong')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Tab from the title turns the styled note into the text box', async ({ page }) => {
  await openList(page, 'Today');
  await openCard(page);
  await page.getByLabel('Notes', { exact: true }).fill('**x**');
  await page.keyboard.press('Escape');
  await openCard(page);
  await page.getByLabel('Title', { exact: true }).click();
  await page.keyboard.press('Tab');
  await expect(page.locator('textarea[aria-label="Notes"]')).toBeFocused();
  await expect(page.locator('textarea[aria-label="Notes"]')).toHaveValue('**x**');
});

test('a project’s notes show their styles too', async ({ page }) => {
  await openList(page, 'Kitchen refresh');
  await page.getByLabel('Project notes').fill('See www.example.com for **tiles**');
  await page.getByLabel('Project title').click();
  const note = page.getByRole('textbox', { name: 'Project notes' });
  await expect(note.locator('strong')).toHaveText('tiles');
  await expect(note.getByRole('link', { name: 'www.example.com' })).toHaveAttribute('href', 'https://www.example.com/');
  await note.locator('strong').click();
  await expect(page.locator('textarea[aria-label="Project notes"]')).toHaveValue('See www.example.com for **tiles**');
});

test('a checklist item with a link shows it clickable, and becomes its text box when clicked (FR-7.1)', async ({ page, context }) => {
  await openList(page, 'Today');
  await openCard(page);
  await page.getByRole('button', { name: 'Add checklist' }).click();
  await expect(page.locator('input[data-item]')).toBeFocused();
  await page.keyboard.type('Pay at [the portal](https://pay.example/bill) **today**');
  await page.keyboard.press('Enter');
  // The new item, once it's there (until then the first item is the last one).
  await expect(page.locator('ul[aria-label="Checklist"] li')).toHaveCount(2);
  await expect(page.locator('ul[aria-label="Checklist"] li').last().locator('input')).toBeFocused();
  await page.keyboard.type('Plain item');
  await page.getByLabel('Title', { exact: true }).click();

  const items = page.getByRole('list', { name: 'Checklist' });
  const portal = items.getByRole('link', { name: 'the portal' });
  await expect(portal).toHaveAttribute('href', 'https://pay.example/bill');
  // Only links: the bold marks stay as typed, and an item with no link stays a text box.
  await expect(items.locator('[data-item-view]')).toHaveText('Pay at the portal **today**');
  await expect(items.locator('input[data-item]')).toHaveValue('Plain item');

  await context.route('https://pay.example/**', (route) => route.fulfill({ body: 'pay' }));
  const [tab] = await Promise.all([context.waitForEvent('page'), portal.click()]);
  await tab.close();
  await expect(portal).toBeVisible();

  await items.locator('[data-item-view]').click({ position: { x: 4, y: 8 } });
  const box = items.locator('input[data-item]').first();
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('Pay at [the portal](https://pay.example/bill) **today**');
  // Moving it keeps it the text box being edited.
  await page.keyboard.press('Meta+ArrowDown');
  await expect(items.locator('input[data-item]').last()).toBeFocused();
  await expect(items.locator('input[data-item]').last()).toHaveValue('Pay at [the portal](https://pay.example/bill) **today**');
});
