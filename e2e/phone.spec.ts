/**
 * The phone layout (Section 6, under 768 px), in WebKit at iPhone size: a
 * Home screen of lists, push navigation into a list with a back link, and the
 * round + button in place of the toolbar (FR-10.5), with the lists sized for
 * touch; pickers and the task menu as sheets along the bottom, and Put Back
 * from a tap in the Trash; focusing on an area from its ⋯ menu; Select mode;
 * compact rows; the tag icon on rows; swipe actions.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { connect, restoreSample, titleGaps } from './app';
import { fakeGitHub } from './fakeGitHub';

test('Home screen of lists, a list, and the + button', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  const lists = page.getByRole('navigation', { name: 'Lists' });
  await expect(page.getByRole('toolbar', { name: 'Actions' })).toBeHidden();
  // The lists fill the screen, so there is no edge to resize (Section 6).
  await expect(page.getByRole('separator', { name: 'Resize sidebar' })).toHaveCount(0);
  // Sized for touch (since 1.1.15).
  const inbox = lists.getByRole('link', { name: 'Inbox' });
  expect(Math.round((await inbox.boundingBox())!.height)).toBe(34);
  await expect(inbox).toHaveCSS('font-size', '14.5px');
  await expect(inbox).toHaveCSS('font-weight', '600');
  expect(Math.round((await inbox.locator('svg').first().boundingBox())!.width)).toBe(19);

  await lists.getByRole('link', { name: 'Inbox' }).click();
  await expect(lists).toBeHidden();
  // ‹ Lists, not the iPad's sidebar button (since 1.1.16).
  await expect(page.getByRole('button', { name: /sidebar/ })).toBeHidden();
  await page.getByRole('button', { name: 'New Task' }).click();
  const field = page.getByRole('dialog', { name: 'Quick Entry' }).getByPlaceholder('New Task');
  await field.fill('Pick up keys');
  await field.press('Enter');
  await expect(page.getByText('Pick up keys')).toBeVisible();

  await page.getByRole('link', { name: 'Lists' }).click();
  await expect(lists).toBeVisible();
});

test('pickers open as sheets along the bottom of the screen (Section 6, since 1.1.13)', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await page.getByRole('navigation', { name: 'Lists' }).getByRole('link', { name: 'Inbox' }).click();
  await page.getByRole('button', { name: 'New Task' }).click();
  const entry = page.getByRole('dialog', { name: 'Quick Entry' });
  const screen = page.viewportSize()!;

  for (const name of ['Start Date', 'Tags', 'Deadline']) {
    await entry.getByRole('button', { name, exact: true }).click();
    const sheet = page.getByRole('dialog', { name, exact: true });
    await expect(sheet).toBeVisible();
    // Fully on screen, full width, against the bottom edge.
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBe(0);
    expect(Math.round(box.width)).toBe(screen.width);
    expect(Math.round(box.y + box.height)).toBe(screen.height);
    // A tap on the dimmed screen above closes it, leaving the new task open.
    await page.mouse.click(screen.width / 2, 20);
    await expect(sheet).toBeHidden();
    await expect(entry).toBeVisible();
  }
});

test('the task menu is a sheet, and a tap in the Trash puts a task back (FR-1.7, since 1.1.14)', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  const lists = page.getByRole('navigation', { name: 'Lists' });
  const screen = page.viewportSize()!;
  await lists.getByRole('link', { name: 'Inbox' }).click();
  await page.getByRole('button', { name: 'New Task' }).click();
  const field = page.getByRole('dialog', { name: 'Quick Entry' }).getByPlaceholder('New Task');
  await field.fill('Book flights');
  await field.press('Enter');
  // Task rows on phones are 48 px, one line or two (since 1.3.1; 44 px from 1.1.18, as on iPad still).
  const row = page.locator('li.row').filter({ hasText: 'Book flights' });
  expect(Math.round((await row.boundingBox())!.height)).toBe(48);

  // The card's ⋯ opens the full task menu as a sheet along the bottom.
  await page.getByText('Book flights', { exact: true }).tap();
  await page.getByRole('button', { name: 'More actions' }).tap();
  const menu = page.getByRole('menu', { name: 'Book flights actions' });
  await expect(menu.getByRole('menuitem', { name: 'Get Info' })).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBe(0);
  expect(Math.round(box.width)).toBe(screen.width);
  expect(Math.round(box.y + box.height)).toBe(screen.height);

  // A submenu takes the list's place, with Back.
  await menu.getByRole('menuitem', { name: 'Priority' }).tap();
  await expect(menu.getByRole('menuitem', { name: 'Get Info' })).toBeHidden();
  await menu.getByRole('menuitem', { name: 'Back' }).tap();
  await menu.getByRole('menuitem', { name: 'Delete Task' }).tap();
  await expect(page.getByText('Book flights', { exact: true })).toBeHidden();

  // In the Trash, a tap opens Put Back.
  await page.getByRole('link', { name: 'Lists' }).click();
  await lists.getByRole('link', { name: 'Trash' }).click();
  await page.getByText('Book flights', { exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Put Back' }).tap();
  await expect(page.getByText('Trash is empty.')).toBeVisible();
  await page.getByRole('link', { name: 'Lists' }).click();
  await lists.getByRole('link', { name: 'Inbox' }).click();
  await expect(page.getByText('Book flights', { exact: true })).toBeVisible();
});

test("focus from an area's ⋯ menu, with the marker under each page's title (FR-22.1)", async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  const lists = page.getByRole('navigation', { name: 'Lists' });
  await lists.getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Area' }).click();
  const title = page.getByLabel('Area title');
  await title.fill('Work');
  await title.blur();

  await page.getByRole('button', { name: 'More area actions' }).click();
  await page.getByRole('menuitem', { name: 'Focus on this Area' }).click();
  // The sidebar is its own screen here, so the marker shows under the title too.
  const marker = page.getByRole('main').getByRole('status', { name: 'Focus' });
  await expect(marker).toHaveText('Focus: Work');
  await page.getByRole('link', { name: 'Lists' }).click();
  await expect(lists.getByRole('status', { name: 'Focus' })).toHaveText('Focus: Work');
  await lists.getByRole('link', { name: 'Today' }).click();
  await expect(marker).toBeVisible();
  await marker.getByRole('button', { name: 'Leave Focus' }).click();
  await expect(marker).toHaveCount(0);
});

test('Select mode: tap to select, the floating bar acts on the selection (FR-10.2)', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await page.getByRole('navigation', { name: 'Lists' }).getByRole('link', { name: 'Today' }).click();
  for (const title of ['Alpha', 'Bravo', 'Charlie']) {
    await page.getByRole('button', { name: 'New Task' }).click();
    const field = page.getByRole('dialog', { name: 'Quick Entry' }).getByPlaceholder('New Task');
    await field.fill(title);
    await field.press('Enter');
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }

  await page.getByRole('button', { name: 'More Today actions' }).tap();
  // No check mark, which would read as a ticked choice (since 1.2.10).
  await expect(page.getByRole('menuitem', { name: 'Select' }).locator('svg')).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Select' }).tap();
  const bar = page.getByRole('toolbar', { name: 'Selected tasks' });
  await expect(bar.getByRole('button', { name: 'Move' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'New Task' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Lists' })).toBeHidden();

  // A tap selects; the checkbox selects too, rather than completing, and shows the selection (since 1.3.1).
  const pick = (title: string) => page.getByRole('button', { name: `Select ${title}` });
  const box = (title: string) => page.getByRole('checkbox', { name: `Select: ${title}` });
  await pick('Alpha').tap();
  await pick('Charlie').tap();
  await expect(box('Alpha')).toHaveAttribute('aria-checked', 'true');
  await expect(box('Bravo')).toHaveAttribute('aria-checked', 'false');
  await box('Bravo').tap();
  await expect(page.getByText('3 Selected')).toBeVisible();
  // No second marker at the row's right end (it was a circle before 1.3.1).
  await expect(page.locator('li.row .pick')).toHaveCount(0);
  await pick('Bravo').tap();
  await expect(page.getByText('2 Selected')).toBeVisible();
  await expect(pick('Bravo')).toHaveAttribute('aria-pressed', 'false');

  // ⋯ › Priority sets it on both; Select mode stays on with both selected.
  await bar.getByRole('button', { name: 'More' }).tap();
  const menu = page.getByRole('menu', { name: '2 tasks actions' });
  await menu.getByRole('menuitem', { name: 'Priority' }).tap();
  await page.getByRole('menuitemradio', { name: /^P4/ }).tap();
  await expect(page.locator('li.row .prio-4')).toHaveCount(2);
  await expect(page.getByText('2 Selected')).toBeVisible();

  // Delete takes both away; Undo brings them back.
  await bar.getByRole('button', { name: 'Delete' }).tap();
  await expect(page.getByText('Alpha', { exact: true })).toBeHidden();
  await expect(page.getByText('0 Selected')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).tap();
  await expect(page.getByText('Charlie', { exact: true })).toBeVisible();

  // Done ends Select mode: the + is back, and a tap opens a task again.
  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(bar).toBeHidden();
  await expect(page.getByRole('button', { name: 'New Task' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Alpha' }).tap();
  await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();
});

test('rows are compact (Milestone 11, since 1.3.1)', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await restoreSample(page);
  await page.evaluate(() => (location.hash = '#/today'));
  const row = (t: string) => page.locator('li.row').filter({ hasText: t });
  await expect(row('Review homepage copy')).toBeVisible();

  // Every row is 48 px, with a project under its title or not.
  for (const t of ['Review homepage copy', 'Pick up dry cleaning']) expect(Math.round((await row(t).boundingBox())!.height)).toBe(48);

  // After the title only icons, each named: the priority in its colour, the context as a pin; no checklist count.
  const review = row('Review homepage copy');
  await expect(review.getByLabel('Priority: P1')).toBeVisible();
  await expect(review.getByLabel('Context: Computer')).toBeVisible();
  await expect(review.locator('.aside .context')).toBeHidden();
  await expect(review.locator('.aside .prio')).toBeHidden();
  await expect(review.getByText('2/3')).toBeHidden();
  // The deadline alone on the right, short.
  await expect(row('Book flights to Lisbon').getByText('2d left')).toBeVisible();
  await expect(row('Book flights to Lisbon').getByText('2 days left')).toBeHidden();

  // So a long title gets most of the row (it was cut to a few characters); widths vary with the browser's font.
  const plumber = row('Call the plumber about the sink');
  const [titleWidth, rowWidth] = [(await plumber.locator('.title').boundingBox())!.width, (await plumber.boundingBox())!.width];
  expect(titleWidth / rowWidth).toBeGreaterThan(0.6);
});

test('a task with tags shows a tag icon, not the tag names (since 1.2.11)', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await page.getByRole('navigation', { name: 'Lists' }).getByRole('link', { name: 'Inbox' }).click();
  await page.getByRole('button', { name: 'New Task' }).click();
  const entry = page.getByRole('dialog', { name: 'Quick Entry' });
  await entry.getByPlaceholder('New Task').fill('Call the bank');
  await entry.getByRole('button', { name: 'Tags', exact: true }).click();
  await page.getByLabel('Find or create a tag').fill('Errands');
  await page.getByLabel('Find or create a tag').press('Enter');
  await page.mouse.click(page.viewportSize()!.width / 2, 20);
  await entry.getByPlaceholder('New Task').press('Enter');
  const row = page.locator('li.row').filter({ hasText: 'Call the bank' });
  await expect(row.getByLabel('Has tags')).toBeVisible();
  await expect(row.getByText('Errands')).toBeHidden();
});

test('Repeat… opens the Repeat sheet; the repeat line opens the Repeat menu (FR-4.1, FR-4.4, since 1.2.13)', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  const lists = page.getByRole('navigation', { name: 'Lists' });
  const day = new Date().getDay();
  const other = (day + 3) % 7;
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  await lists.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'New Task' }).click();
  const field = page.getByRole('dialog', { name: 'Quick Entry' }).getByPlaceholder('New Task');
  await field.fill('Water plants');
  await field.press('Enter');

  await page.getByText('Water plants', { exact: true }).tap();
  await page.getByRole('button', { name: 'More actions' }).tap();
  await page.getByRole('menuitem', { name: 'Repeat…' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Repeat' });
  // The default: 1 week after completion.
  await expect(sheet.getByText("You'll get a new copy")).toContainText('week');
  await sheet.getByRole('button', { name: 'Regularly' }).tap();
  await expect(sheet.getByRole('button', { name: /^Every/ })).toContainText('week');
  await sheet.getByRole('button', { name: /^On/ }).tap();
  await sheet.getByRole('button', { name: `On ${names[other]}` }).tap();
  await expect(sheet.getByRole('button', { name: `On ${names[day]}` })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Back' }).tap();
  await expect(sheet.getByRole('button', { name: /^On/ })).toContainText(' and ');
  await expect(sheet.getByRole('button', { name: /^Next/ })).toContainText('Today');
  await sheet.getByRole('button', { name: 'Save' }).tap();
  await expect(sheet).toBeHidden();

  // Today's copy is in Today; the repeating task's card shows the rule, and its line opens the Repeat menu.
  const copy = page.locator('li.row').filter({ has: page.getByRole('img', { name: 'Copy of a repeating task' }) });
  await expect(copy).toHaveCount(1);
  await copy.locator('.title').tap();
  await page.getByRole('button', { name: 'Show Repeating Task' }).tap();
  const line = page.getByRole('button', { name: 'Edit repeat rule' });
  await expect(line).toContainText(`${names[Math.min(day, other)]} and ${names[Math.max(day, other)]}`);
  await line.tap();
  const menu = page.getByRole('menu', { name: 'Water plants actions' });
  await expect(menu.getByRole('menuitem', { name: 'Create Next Copy' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Edit Rule…' }).tap();
  const edit = page.getByRole('dialog', { name: 'Repeat' });
  await expect(edit.getByRole('button', { name: /^Every/ })).toContainText('week');

  // A yearly rule saves too (its days are stored as plain copies, fixed in 1.2.13).
  await edit.getByRole('button', { name: /^Every/ }).tap();
  await page.getByRole('combobox', { name: 'Unit' }).selectOption('year');
  await page.getByRole('button', { name: 'Back' }).tap();
  await edit.getByRole('button', { name: 'Save' }).tap();
  await expect(edit).toBeHidden();
  await expect(line).toContainText('Repeat every year on the');
});

/** Swipe a task's row by `dx` pixels with one finger (touch pointer events, as WebKit sends them). */
async function swipe(page: Page, title: string, dx: number): Promise<void> {
  const row = page.locator('li.row', { hasText: title });
  const b = (await row.boundingBox())!;
  await row.evaluate(
    (el, { x0, y, dx }) => {
      const send = (type: string, x: number) =>
        el.querySelector('.body')!.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: x, clientY: y }),
        );
      send('pointerdown', x0);
      for (let i = 1; i <= 6; i++) send('pointermove', x0 + (dx * i) / 6);
      send('pointerup', x0 + dx);
    },
    { x0: b.x + b.width / 2, y: b.y + b.height / 2, dx },
  );
}

test('swiping a row: left to right for Start Date, right to left for Select (FR-10.4)', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await page.getByRole('navigation', { name: 'Lists' }).getByRole('link', { name: 'Today' }).click();
  for (const title of ['Alpha', 'Bravo']) {
    await page.getByRole('button', { name: 'New Task' }).click();
    const field = page.getByRole('dialog', { name: 'Quick Entry' }).getByPlaceholder('New Task');
    await field.fill(title);
    await field.press('Enter');
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }

  // A short swipe springs back and does nothing.
  await swipe(page, 'Alpha', 60);
  await expect(page.getByRole('button', { name: 'Tomorrow' })).toBeHidden();
  await expect(page.getByText('1 Selected')).toBeHidden();

  // Left to right: the Start Date sheet for that task.
  await swipe(page, 'Alpha', 220);
  await page.getByRole('button', { name: 'Tomorrow' }).tap();
  await expect(page.getByText('Alpha', { exact: true })).toBeHidden();

  // Right to left: Select mode, with the task selected.
  await swipe(page, 'Bravo', -220);
  await expect(page.getByText('1 Selected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select Bravo' })).toHaveAttribute('aria-pressed', 'true');
});

/** Drag `from` with one finger (touch pointer events, as WebKit sends them) and lift it above the item `to`. */
async function touchDrag(from: Locator, to: Locator): Promise<void> {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await from.evaluate(
    (el, { x, y0, y1 }) => {
      const send = (type: string, y: number) =>
        el.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 9, clientX: x, clientY: y }),
        );
      send('pointerdown', y0);
      for (let i = 1; i <= 8; i++) send('pointermove', y0 + ((y1 - y0) * i) / 8);
      send('pointerup', y1);
    },
    { x: a.x + a.width / 2, y0: a.y + a.height / 2, y1: b.y + 3 },
  );
}

test('a checklist item drags by its handle at once on touch; there is no delete button', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await restoreSample(page);
  await page.evaluate(() => (location.hash = '#/today'));
  await page.getByText('Review homepage copy', { exact: true }).tap();
  const items = page.locator('ul.checklist li');
  await expect(items).toHaveCount(3);
  const titles = () => items.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  const handle = items.nth(2).locator('[data-drag-handle]');
  await expect(handle).toBeVisible();
  // Big enough to hit with a finger, and shown without hovering.
  expect((await handle.boundingBox())!.height).toBeGreaterThanOrEqual(28);
  expect(await handle.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  // Inside its row, with room before the card's edge (Safari let the field push it out, 1.3.2).
  const row = (await items.nth(2).boundingBox())!;
  const h = (await handle.boundingBox())!;
  expect(h.x + h.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
  const icon = (await handle.locator('svg').boundingBox())!;
  expect(row.x + row.width - (icon.x + icon.width)).toBeGreaterThanOrEqual(10);
  await expect(items.getByRole('button', { name: 'Delete item' })).toHaveCount(0);

  // A finger on the text, moving, doesn't drag (it would scroll).
  await touchDrag(items.nth(2).locator('input'), items.nth(0));
  expect(await titles()).toEqual(['Headline', 'Pricing section', 'Footer links']);
  // On the handle it drags at once, no long press.
  await touchDrag(handle, items.nth(0));
  await expect.poll(titles).toEqual(['Footer links', 'Headline', 'Pricing section']);
});

test('a long project title wraps on phones, with the ⋯ after its last word (Milestone 11 PR 8b)', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await restoreSample(page);
  await page.evaluate(() => (location.hash = '#/'));
  await page.getByRole('link', { name: 'Kitchen refresh' }).first().tap();
  // Tapping the title edits it, in a box that wraps.
  await page.getByRole('button', { name: /^Project title/ }).tap();
  const box = page.getByLabel('Project title');
  await box.fill('Kitchen refresh — cabinets, paint and the new lighting');
  await box.press('Enter');
  const shown = page.getByRole('button', { name: /^Project title: Kitchen refresh — cabinets/ });
  await expect(shown).toBeVisible();
  const text = (await shown.boundingBox())!;
  const more = (await page.getByRole('button', { name: 'More project actions' }).boundingBox())!;
  // Three lines of 28 px text, all on screen, and the ⋯ on the last one, after the words.
  expect(text.height).toBeGreaterThan(70);
  expect(text.x + text.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(more.y).toBeGreaterThan(text.y + 50);
  expect(more.y + more.height).toBeLessThanOrEqual(text.y + text.height + 10);
  // Saved: it survives a reload.
  await page.reload();
  await expect(shown).toBeVisible();
});

test('the Move dialog doesn’t put the cursor in its filter on touch screens, so no keyboard covers the list', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await restoreSample(page);
  await page.evaluate(() => (location.hash = '#/today'));
  await page.getByText('Pick up dry cleaning', { exact: true }).tap();
  await page.getByRole('button', { name: 'Move', exact: true }).first().tap();
  const filter = page.getByLabel('Filter places');
  await expect(filter).toBeVisible();
  await expect(filter).not.toBeFocused();
  await filter.tap();
  await page.keyboard.type('kit');
  await expect(page.getByRole('dialog', { name: 'Move to…' }).getByRole('button', { name: 'Kitchen refresh' })).toBeVisible();
});

test('on phones too, the first task starts 26 px below the title or the tag row', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await restoreSample(page);
  await page.evaluate(() => (location.hash = '#/today'));
  await expect(page.locator('main li.row').first()).toBeVisible();
  expect(await titleGaps(page)).toEqual({ bar: 12, first: 26 });
  await page.evaluate(() => (location.hash = '#/inbox'));
  await expect(page.getByText('Idea: a newsletter for launch day')).toBeVisible();
  expect(await titleGaps(page)).toEqual({ bar: null, first: 26 });
});

test('a tap on a note’s link opens it; a tap elsewhere edits the note (FR-7.4)', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await restoreSample(page);
  await page.evaluate(() => (location.hash = '#/today'));
  await page.getByText('Pick up dry cleaning', { exact: true }).tap();
  await page.getByLabel('Notes', { exact: true }).fill('Ask for **Sam** at [the shop](https://example.com/shop)');
  await page.getByLabel('Title', { exact: true }).tap();
  const note = page.getByRole('textbox', { name: 'Notes', exact: true });
  await context.route('https://example.com/**', (route) => route.fulfill({ body: 'shop' }));
  const [tab] = await Promise.all([context.waitForEvent('page'), note.getByRole('link', { name: 'the shop' }).tap()]);
  await tab.close();
  await expect(note.locator('strong')).toBeVisible();
  await note.locator('strong').tap();
  await expect(page.locator('textarea[aria-label="Notes"]')).toBeFocused();
});

test('a long title wraps in the open card, and Return still closes it', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await restoreSample(page);
  await page.evaluate(() => (location.hash = '#/today'));
  await page.getByText('Pick up dry cleaning', { exact: true }).tap();
  const title = page.getByLabel('Title', { exact: true });
  const oneLine = (await title.boundingBox())!.height;
  await title.fill('Pick up dry cleaning and the alterations from the tailor on Main Street');
  await expect.poll(async () => (await title.boundingBox())!.height).toBeGreaterThan(oneLine * 1.5);
  await expect(title).toHaveValue('Pick up dry cleaning and the alterations from the tailor on Main Street');
  await title.press('Enter');
  await expect(page.getByText('Pick up dry cleaning and the alterations from the tailor on Main Street', { exact: true })).toBeVisible();
  await expect(title).toHaveCount(0);
});
