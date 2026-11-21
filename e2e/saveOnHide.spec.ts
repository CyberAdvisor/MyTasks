/**
 * Typed text is saved when the app is hidden, not only 300 ms after the
 * last key (review C7, F9): an open task's title and notes, a project's
 * title and notes. Here the page is hidden straight after typing, as
 * switching apps does, and reloaded 100 ms later, before the 300 ms save
 * would have run; on iPhone the system may close a hidden app at any time.
 */
import { expect, test, type Page } from '@playwright/test';
import { connect, openList, restoreSample, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

/** Type `text` at the end of `field`, hide the page at once, and reload 100 ms later. */
async function typeThenLeave(page: Page, field: ReturnType<Page['getByLabel']>, text: string): Promise<void> {
  await field.click();
  await field.press('End');
  await page.keyboard.type(text, { delay: 0 });
  await page.evaluate(async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 100));
  });
  await page.reload();
}

test.beforeEach(async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await restoreSample(page);
});

test('an open task’s title and notes are kept when the app is closed straight after typing', async ({ page }) => {
  const errors = watchErrors(page);
  await openList(page, 'Today');
  await page.getByText('Pick up dry cleaning', { exact: true }).dblclick();
  await typeThenLeave(page, page.getByLabel('Notes', { exact: true }), 'Ticket 42');
  await page.getByText('Pick up dry cleaning', { exact: true }).dblclick();
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Ticket 42');
  await typeThenLeave(page, page.getByLabel('Title', { exact: true }), ' today');
  await expect(page.getByText('Pick up dry cleaning today', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a project’s title and notes are kept when the app is closed straight after typing', async ({ page }) => {
  await openList(page, 'Kitchen refresh');
  const notes = page.getByLabel('Project notes');
  await typeThenLeave(page, notes, 'Budget £4k');
  await expect(page.getByLabel('Project notes')).toHaveValue('Budget £4k');
  await typeThenLeave(page, page.getByLabel('Project title'), ' 2027');
  await expect(page.getByLabel('Project title')).toHaveValue('Kitchen refresh 2027');
});
