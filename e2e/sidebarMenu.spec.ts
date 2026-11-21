/**
 * The sidebar's right-click menus: commands run from the sidebar without
 * leaving the page being shown, and the menu closes with Escape. An area's
 * Focus on this Area narrows the lists until Leave Focus or the band's ✕.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTask, connect, openList, restoreSample, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

/** Fill a title field that has focus and leave it. */
async function name(page: Page, label: string, text: string): Promise<void> {
  const field = page.getByLabel(label);
  await field.fill(text);
  await field.blur();
}

test('right-click menus on sidebar items run their commands', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  const nav = page.getByRole('navigation', { name: 'Lists' });

  // An area, and a project in it.
  await nav.getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Area' }).click();
  await name(page, 'Area title', 'Home');

  // Area › New Project opens the new project in the area.
  await nav.getByRole('link', { name: 'Home' }).click({ button: 'right' });
  await page.getByRole('menu', { name: 'Home actions' }).getByRole('menuitem', { name: 'New Project' }).click();
  await name(page, 'Project title', 'Garden');

  // From Today, Project › Duplicate Project opens the copy.
  await openList(page, 'Today');
  await nav.getByRole('link', { name: 'Garden' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Garden actions' });
  await expect(menu.getByRole('menuitem', { name: 'Move Completed Items' })).toBeDisabled();
  await menu.getByRole('menuitem', { name: 'Duplicate Project' }).click();
  await expect(nav.getByRole('link', { name: 'Garden' })).toHaveCount(2);

  // Escape closes a menu without doing anything.
  await nav.getByRole('link', { name: 'Home' }).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Home actions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Home actions' })).toBeHidden();

  // The built-in lists keep the browser's own menu: no app menu opens.
  for (const list of ['Inbox', 'Today', 'Trash']) {
    await nav.getByRole('link', { name: list }).click({ button: 'right' });
    await expect(page.getByRole('menu')).toHaveCount(0);
  }

  expect(errors).toEqual([]);
});

test('focus on an area narrows the lists until you leave it (FR-22.1)', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  const nav = page.getByRole('navigation', { name: 'Lists' });
  const main = page.getByRole('main');

  // Two areas with a task each, a task in the Inbox and one in Today with no area.
  for (const [areaName, task] of [['Work', 'Book room'], ['Home', 'Mow lawn']]) {
    await nav.getByRole('button', { name: 'New List' }).click();
    await page.getByRole('menuitem', { name: 'New Area' }).click();
    // Wait for the new area's page, so its own title is the one named.
    await expect(page.getByLabel('Area title')).toHaveValue('');
    await name(page, 'Area title', areaName);
    await addTask(page, task);
  }
  await openList(page, 'Inbox');
  await addTask(page, 'Buy milk');
  await openList(page, 'Today');
  await addTask(page, 'Pay rent');

  // Focusing on Work from Home's page opens Work, with the band and only Work in the sidebar.
  await nav.getByRole('link', { name: 'Home', exact: true }).click();
  await nav.getByRole('link', { name: 'Work', exact: true }).click({ button: 'right' });
  await page.getByRole('menu', { name: 'Work actions' }).getByRole('menuitem', { name: 'Focus on this Area' }).click();
  await expect(page).toHaveURL(/#\/area\//);
  await expect(nav.getByRole('status', { name: 'Focus' })).toHaveText('Focus: Work');
  await expect(nav.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0);

  // Today leaves out the task with no area; a new task there joins Work and stays.
  await openList(page, 'Today');
  await expect(main.getByText('Pay rent')).toHaveCount(0);
  await addTask(page, 'Call recruiter');
  await expect(main.getByText('Call recruiter')).toBeVisible();
  await expect(main.getByText('Work', { exact: true })).toBeVisible();
  // The Inbox stays.
  await openList(page, 'Inbox');
  await expect(main.getByText('Buy milk')).toBeVisible();

  // The focus is kept on this device, and Leave Focus ends it.
  await page.reload();
  await expect(nav.getByRole('status', { name: 'Focus' })).toHaveText('Focus: Work');
  await nav.getByRole('link', { name: 'Work', exact: true }).click({ button: 'right' });
  await page.getByRole('menu', { name: 'Work actions' }).getByRole('menuitem', { name: 'Leave Focus' }).click();
  await expect(nav.getByRole('status', { name: 'Focus' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Home', exact: true })).toBeVisible();

  // So does the band's ✕.
  await nav.getByRole('link', { name: 'Work', exact: true }).click({ button: 'right' });
  await page.getByRole('menu', { name: 'Work actions' }).getByRole('menuitem', { name: 'Focus on this Area' }).click();
  await nav.getByRole('button', { name: 'Leave Focus' }).click();
  await expect(nav.getByRole('link', { name: 'Home', exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});

/** The labels of the open menu named `name`, in order, dividers as "—". */
async function menuLabels(page: Page, name: string): Promise<string[]> {
  return page
    .getByRole('menu', { name })
    .locator('[role^="menuitem"], hr')
    .evaluateAll((els) => els.map((e) => (e.tagName === 'HR' ? '—' : (e.textContent ?? '').replace('✓', '').trim())));
}

test('a project’s and an area’s ⋯ menu and right-click menu are the same (review C8, F4)', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await restoreSample(page);
  const nav = page.getByRole('navigation', { name: 'Lists' });
  for (const [name, more] of [
    ['Website launch', 'More project actions'],
    ['Work', 'More area actions'],
  ]) {
    await openList(page, name);
    await page.getByRole('button', { name: more }).click();
    const pageMenu = await menuLabels(page, name === 'Work' ? 'Area actions' : 'Project actions');
    await page.keyboard.press('Escape');
    await nav.getByRole('link', { name, exact: true }).click({ button: 'right' });
    const sideMenu = await menuLabels(page, `${name} actions`);
    await page.keyboard.press('Escape');
    // The page's only extras: Select (touch screens) and Add Heading (phones).
    expect(pageMenu.filter((l) => l !== 'Select' && l !== 'Add Heading')).toEqual(sideMenu);
    expect(sideMenu).toContain('Print…');
  }
  expect(errors).toEqual([]);
});

test('New List closes on Escape and on a click elsewhere; trashed items say Put Back (review F3, F6)', async ({ context, page }) => {
  await fakeGitHub(context);
  await connect(page);
  const nav = page.getByRole('navigation', { name: 'Lists' });
  const newList = nav.getByRole('button', { name: 'New List' });
  const menu = page.getByRole('menu', { name: 'New List' });
  await newList.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await newList.click();
  await page.locator('main').click({ position: { x: 300, y: 300 } });
  await expect(menu).toBeHidden();
  // Arrow keys move through it.
  await newList.focus();
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitem', { name: 'New Project' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'New Area' })).toBeFocused();
  await page.keyboard.press('Escape');

  await openList(page, 'Inbox');
  await addTask(page, 'Old idea');
  await page.getByText('Old idea', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete Task' }).click();
  await openList(page, 'Trash');
  await expect(page.locator('main').getByRole('button', { name: 'Put Back' })).toBeVisible();
  await expect(page.locator('main').getByRole('button', { name: 'Restore' })).toHaveCount(0);
});
