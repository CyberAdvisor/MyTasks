/**
 * The resizable sidebar (Section 6): drag its edge, kept after a reload,
 * double-click resets; hidden and shown again (since
 * 1.1.16): drag past the narrowest and pull back from the left edge on the
 * Mac, the sidebar button on iPad.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTask, connect } from './app';
import { fakeGitHub } from './fakeGitHub';

/** The sidebar's width, read from where its edge is. */
async function width(page: Page): Promise<number> {
  const box = await page.getByRole('separator', { name: 'Resize sidebar' }).boundingBox();
  return Math.round(box!.x + box!.width / 2);
}

/** Drag the sidebar's edge by dx pixels. */
async function drag(page: Page, dx: number): Promise<void> {
  const box = (await page.getByRole('separator', { name: 'Resize sidebar' }).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 200;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y);
  await page.mouse.move(x + dx, y);
  await page.mouse.up();
}

test('the sidebar resizes, keeps its width after a reload, and resets on double-click', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  expect(await width(page)).toBe(260);
  // Since 1.1.17: 16 px medium names on 28 px rows, 18 px icons.
  const inbox = page.getByRole('navigation', { name: 'Lists' }).getByRole('link', { name: 'Inbox' });
  expect(Math.round((await inbox.boundingBox())!.height)).toBe(28);
  await expect(inbox).toHaveCSS('font-size', '16px');
  await expect(inbox).toHaveCSS('font-weight', '500');
  expect(Math.round((await inbox.locator('svg').first().boundingBox())!.width)).toBe(18);

  await drag(page, 80);
  expect(await width(page)).toBe(340);
  await drag(page, 500);
  expect(await width(page)).toBe(400);

  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  expect(await width(page)).toBe(400);

  // Short of hiding, it stops at the narrowest.
  await drag(page, -220);
  expect(await width(page)).toBe(200);
  await page.getByRole('separator', { name: 'Resize sidebar' }).dblclick();
  expect(await width(page)).toBe(260);

  // Dragged well past the narrowest, it hides, and stays hidden after a reload.
  const nav = page.getByRole('navigation', { name: 'Lists' });
  await drag(page, -200);
  await expect(nav).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(nav).toBeHidden();
  // No sidebar button with a mouse: the window's left edge pulls it back, at its width.
  await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeHidden();
  await page.mouse.move(3, 300);
  await page.mouse.down();
  await page.mouse.move(30, 300);
  await page.mouse.move(80, 300);
  await page.mouse.up();
  await expect(nav).toBeVisible();
  expect(await width(page)).toBe(260);
});

test.describe('on an iPad', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('the sidebar button hides and shows the sidebar; task rows are 44 px', async ({ page, context }) => {
    await fakeGitHub(context);
    await connect(page);
    await addTask(page, 'Book flights');
    const row = page.locator('li.row').filter({ hasText: 'Book flights' });
    expect(Math.round((await row.boundingBox())!.height)).toBe(44);
    const nav = page.getByRole('navigation', { name: 'Lists' });
    await expect(nav).toBeVisible();
    await page.getByRole('button', { name: 'Hide sidebar' }).tap();
    await expect(nav).toBeHidden();
    await page.getByRole('button', { name: 'Show sidebar' }).tap();
    await expect(nav).toBeVisible();
  });
});
