/**
 * Daily notes (FR-24.1): Settings › Daily Notes switches a note on in Today,
 * between the calendar events and the tag bar. Each line is a bullet (Return
 * starts the next), shown with light Markdown once left; the note syncs to
 * another device through the gist's own encrypted notes.json, and clearing
 * it clears it there too.
 */
import { expect, test, type Page } from '@playwright/test';
import { connect, openList, synced, watchErrors } from './app';
import { fakeGitHub, FakeGitHub } from './fakeGitHub';

async function dailyNotesSwitch(page: Page, on: boolean): Promise<void> {
  await page.getByRole('link', { name: 'Settings' }).click();
  const toggle = page.getByRole('switch', { name: 'Show a daily note in Today' });
  await expect(toggle).toBeChecked({ checked: !on });
  await toggle.setChecked(on);
}

const note = (page: Page) => page.getByRole('region', { name: 'Daily Note' });

test('a daily note in Today, switched on per device, synced to another device', async ({ browser }) => {
  const gh = new FakeGitHub();
  const first = await browser.newContext();
  await fakeGitHub(first, gh);
  const a = await first.newPage();
  const errors = watchErrors(a);
  await connect(a);

  // Off by default.
  await openList(a, 'Today');
  await expect(note(a)).toHaveCount(0);

  await dailyNotesSwitch(a, true);
  await openList(a, 'Today');
  await expect(note(a)).toBeVisible();
  // Between the title and the tasks: above the tag bar's place.
  const box = note(a).getByRole('textbox');
  await box.click();
  await expect(box).toHaveValue('- ');
  await box.pressSequentially('Recorded the intro');
  await box.press('Enter');
  await box.pressSequentially('Ad read by **Tuesday**');
  await expect(box).toHaveValue('- Recorded the intro\n- Ad read by **Tuesday**');
  // Leaving it shows the bullets, with bold drawn.
  await box.blur();
  await expect(note(a).getByRole('listitem')).toHaveText(['Recorded the intro', 'Ad read by Tuesday']);
  await expect(note(a).locator('strong')).toHaveText('Tuesday');

  // The note reaches the gist in its own file, encrypted.
  const id = [...gh.gists.keys()][0];
  await expect.poll(() => gh.file(id, 'notes.json'), { timeout: 15_000 }).toBeTruthy();
  expect(JSON.parse(gh.file(id, 'notes.json')!)).toMatchObject({ app: 'mytasks-notes' });
  expect(gh.file(id, 'notes.json')).not.toContain('Recorded');
  await synced(a);

  // Another device: off there until switched on, then the same note.
  const second = await browser.newContext();
  await fakeGitHub(second, gh);
  const b = await second.newPage();
  await connect(b);
  await openList(b, 'Today');
  await expect(note(b)).toHaveCount(0);
  await dailyNotesSwitch(b, true);
  await openList(b, 'Today');
  await expect(note(b).getByRole('listitem')).toHaveText(['Recorded the intro', 'Ad read by Tuesday']);

  // Cleared on the second device, it's cleared on the first.
  const before = gh.file(id, 'notes.json');
  await note(b).getByRole('listitem').first().click();
  const boxB = note(b).getByRole('textbox');
  await boxB.fill('');
  await boxB.blur();
  await expect(note(b).getByRole('listitem')).toHaveCount(0);
  await expect.poll(() => gh.file(id, 'notes.json'), { timeout: 15_000 }).not.toBe(before);
  await a.reload();
  await openList(a, 'Today');
  await expect(note(a).getByRole('textbox')).toHaveValue('', { timeout: 15_000 });
  expect(errors).toEqual([]);
  await first.close();
  await second.close();
});
