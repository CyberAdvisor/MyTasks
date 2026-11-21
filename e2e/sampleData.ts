/**
 * Sample tasks for the README and website screenshots (`npm run screenshots`,
 * e2e/screenshots.shoot.ts): a backup file the screenshot run restores, so
 * no real tasks ever appear. Dates are relative to the day it is built, so
 * Today and the deadlines always read the same.
 *
 * tests/backup.test.ts checks that it passes Restore's checks, so a schema
 * change that breaks it fails the unit tests, not just the next screenshot run.
 */
import { sampleRecords } from './sampleRecords';

/** The sample backup file's text, built for `today`. */
export function sampleBackup(today = new Date()): string {
  const { day, area, project, todo, context, tag, item, backup } = sampleRecords(today);
  const user = { startDate: day() };
  return backup({
    areas: [area('work', 'Work'), area('home', 'Home')],
    projects: [
      project('launch', 'Website launch', { areaId: 'work' }),
      project('lisbon', 'Lisbon trip', { areaId: 'home' }),
      project('kitchen', 'Kitchen refresh', { areaId: 'home' }),
    ],
    headings: [],
    todos: [
      todo('review', 'Review homepage copy', { ...user, projectId: 'launch', contextId: 'computer', deadline: day(), priority: 1 }),
      todo('flights', 'Book flights to Lisbon', { ...user, projectId: 'lisbon', contextId: 'computer', deadline: day(2), priority: 2 }),
      todo('plumber', 'Call the plumber about the sink', { ...user, areaId: 'home', contextId: 'phone', priority: 2 }),
      todo('cleaning', 'Pick up dry cleaning', { ...user, start: 'unscheduled', contextId: 'errands', priority: 3 }),
      todo('paint', 'Choose cabinet paint colour', {
        ...user,
        projectId: 'kitchen',
        notes: 'Sage or warm white; get samples first.',
        priority: 4,
      }),
      todo('checklist', 'Send launch checklist to the team', {
        ...user,
        projectId: 'launch',
        contextId: 'computer',
        tagIds: ['waiting'],
        priority: 2,
      }),
      todo('hotel', 'Compare hotels near Alfama', { projectId: 'lisbon' }),
      todo('idea', 'Idea: a newsletter for launch day'),
      todo('library', 'Return library books'),
    ],
    checklistItems: [item('review', 'Headline', true), item('review', 'Pricing section', true), item('review', 'Footer links')],
    tags: [tag('waiting', 'Waiting')],
    contexts: [context('errands', 'Errands'), context('computer', 'Computer'), context('phone', 'Phone')],
    savedSearches: [],
  });
}
