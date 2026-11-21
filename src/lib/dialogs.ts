/**
 * Confirmation dialogs shared by a page's ⋯ menu and the sidebar's
 * right-click menu, so both ask the same question. Each is shown with
 * ChoiceDialog; the chosen `value` goes to the matching action in actions.ts.
 */

interface DialogSpec {
  title: string;
  message: string;
  choices: { label: string; value: string; danger?: boolean }[];
}

/** "Its 2 repeating tasks will stop repeating." (review C4) */
function stopsRepeating(repeating: number): string {
  return repeating === 1 ? 'Its repeating task will stop repeating.' : `Its ${repeating} repeating tasks will stop repeating.`;
}

/**
 * Completing a project that still has open tasks, or repeating tasks (FR-2.3,
 * review C4). With only repeating tasks there is nothing to choose: Complete.
 */
export function completeProjectDialog(openCount: number, repeating = 0): DialogSpec {
  const repeat = repeating ? ` ${stopsRepeating(repeating)}` : '';
  if (!openCount) {
    return { title: 'Complete this project?', message: stopsRepeating(repeating), choices: [{ label: 'Complete', value: 'complete' }] };
  }
  return {
    title: 'Complete this project?',
    message: `It still has ${openCount} open ${openCount === 1 ? 'task' : 'tasks'}. Mark them as completed or canceled?${repeat}`,
    choices: [
      { label: 'Cancel them', value: 'cancel' },
      { label: 'Complete them', value: 'complete' },
    ],
  };
}

/** Archiving a heading that holds repeating tasks (review C4); other headings archive without asking. */
export function archiveHeadingDialog(repeating: number): DialogSpec {
  return { title: 'Archive this heading?', message: stopsRepeating(repeating), choices: [{ label: 'Archive', value: 'archive' }] };
}

/** Deleting an area: keep its projects and tasks, or move them to Trash (FR-2.5). */
export const DELETE_AREA_DIALOG: DialogSpec = {
  title: 'Delete this area?',
  message: 'Choose what happens to its projects and tasks.',
  choices: [
    { label: 'Keep them', value: 'keep' },
    { label: 'Move them to Trash', value: 'trash', danger: true },
  ],
};

/** Deleting a saved search (FR-15.5). */
export const DELETE_SAVED_SEARCH_DIALOG: DialogSpec = {
  title: 'Delete saved search?',
  message: 'The search is removed from the sidebar. Your tasks are not changed.',
  choices: [{ label: 'Delete', value: 'delete', danger: true }],
};

/**
 * Giving a repeating project's template's task a date, or checking it off
 * (FR-4.6): the change goes to the next copy, made now.
 */
export const COPY_NOW_DIALOG: DialogSpec = {
  title: 'Create Copy Now?',
  message:
    'This task is in the template of a repeating project, which keeps no dates or completions. Make the next copy now, with this change on its task? The template stays as it is.',
  choices: [{ label: 'Create Copy', value: 'create' }],
};

/** Stop… on a repeating project (FR-4.6), worded as for a repeating task (FR-4.4). */
export function stopProjectDialog(title: string): DialogSpec {
  return {
    title: 'Stop repeating?',
    message: `“${title || 'New Project'}” and the copies it has made become ordinary projects. No more copies are made.`,
    choices: [{ label: 'Stop It', value: 'stop', danger: true }],
  };
}

/** Deleting a repeating project's template (FR-4.6): copies already made stay. */
export const DELETE_TEMPLATE_DIALOG: DialogSpec = {
  title: 'Delete this repeating project?',
  message: 'The template and all future copies are deleted. Copies already made stay.',
  choices: [{ label: 'Delete', value: 'delete', danger: true }],
};
