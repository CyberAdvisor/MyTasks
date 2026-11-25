/**
 * Todoist's CSV export (FR-12.13): recognise it by its header and turn it
 * into the rows of Import's own format (FR-12.9), so the same checks,
 * preview and single undo step apply (FR-12.6).
 *
 * A Todoist export is one project. Its rows are `meta` (the project's
 * description), `section`, `task` and `note` (a comment on the task above),
 * with blank rows between blocks. What becomes what:
 *
 * - the file's name (without ".csv") is the project's name; the project has
 *   no area
 * - a section is a heading
 * - a task is a task; a sub-task (INDENT 2 or more) is a task of its own
 *   under the same heading, with "Sub-task of: <parent>" in its notes
 * - "@label" words in a task's name are tags
 * - PRIORITY 1–3 is P1–P3; 4, Todoist's "no priority", is none
 * - DESCRIPTION is the notes; each comment is added to them with its date
 * - DATE is the start date or the repeat (todoistDates.ts); DEADLINE the
 *   deadline. A date that can't be read, or one in another language, is
 *   left out and its text kept in the notes ("Todoist date: …")
 * - a reminder is kept as text in the notes ("Todoist reminder: …"), as
 *   tasks have no reminders yet
 * - AUTHOR, RESPONSIBLE, DURATION, ICON and the view are ignored
 */
import { readTodoistDate, readTodoistDay, type RepeatColumns } from './todoistDates';
import { toLocalDate } from '../model/dates';
import type { LocalDate } from '../model/types';

/** The columns written for Import's own format, in this order. */
const OUT = [
  'type', 'id', 'parent_id', 'title', 'notes', 'tags', 'start', 'start_date', 'deadline', 'priority',
  'repeat', 'repeat_every', 'repeat_unit', 'repeat_weekdays', 'repeat_month_day', 'repeat_month', 'repeat_first', 'repeat_ends_on',
] as const;
type OutRow = Partial<Record<(typeof OUT)[number], string>>;

/** A file to convert: its name and its CSV table, header first. */
export interface TodoistFile {
  name: string;
  table: string[][];
}

/** The converted table, and what the preview says about it. */
export interface TodoistConversion {
  table: string[][];
  /** The projects made, one per file. */
  projects: string[];
  /** Tasks whose date, repeat or deadline couldn't be read. */
  unreadable: number;
}

/** Is this table a Todoist export? Its header starts TYPE, CONTENT and has INDENT and DATE_LANG. */
export function isTodoistExport(table: string[][]): boolean {
  const header = (table[0] ?? []).map((h) => h.trim().toUpperCase());
  return header[0] === 'TYPE' && header[1] === 'CONTENT' && header.includes('INDENT') && header.includes('DATE_LANG');
}

/** The project's name from the file's: "Work.csv" → "Work". */
export function projectName(fileName: string): string {
  return fileName.replace(/\.csv$/i, '').trim() || 'Imported project';
}

/** "Call Sam @phone @errands" → title "Call Sam", tags "phone; errands". */
export function splitLabels(content: string): { title: string; tags: string } {
  const tags: string[] = [];
  const title = content
    .replace(/(^|\s)@([^\s@]+)/g, (_, space: string, label: string) => {
      // Import reads "/" as nesting and ";" as a separator.
      tags.push(label.replace(/[/;]/g, '-'));
      return space;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { title: title || content.trim(), tags: [...new Set(tags)].join('; ') };
}

/** A comment's date: Todoist writes when it was made, as an ISO time. */
function commentDate(text: string, ref: LocalDate): LocalDate | null {
  const t = Date.parse(text);
  return Number.isNaN(t) ? readTodoistDay(text, ref) : toLocalDate(new Date(t));
}

/** Turn one or more Todoist exports into Import's own table. */
export function convertTodoist(files: TodoistFile[], ref: LocalDate): TodoistConversion {
  const rows: OutRow[] = [];
  const projects: string[] = [];
  let unreadable = 0;

  files.forEach((file, f) => {
    const header = file.table[0].map((h) => h.trim().toUpperCase());
    const get = (cells: string[], name: string) => (cells[header.indexOf(name)] ?? '').trim();
    const projectId = `p${f + 1}`;
    const name = projectName(file.name);
    projects.push(name);
    const project: OutRow = { type: 'project', id: projectId, title: name, notes: '' };
    rows.push(project);

    let headingId: string | null = null;
    let lastTask: OutRow | null = null;
    // The latest task at each indent, for a sub-task's parent.
    const byIndent: string[] = [];
    let n = 0;

    for (const cells of file.table.slice(1)) {
      if (cells.every((c) => !c.trim())) continue;
      const type = get(cells, 'TYPE').toLowerCase();
      const content = get(cells, 'CONTENT');
      if (type === 'meta') {
        const description = get(cells, 'DESCRIPTION');
        if (description) project.notes = description;
      } else if (type === 'section') {
        headingId = `${projectId}h${++n}`;
        rows.push({ type: 'heading', id: headingId, parent_id: projectId, title: content || 'Section' });
        byIndent.length = 0;
        lastTask = null;
      } else if (type === 'task') {
        const { title, tags } = splitLabels(content);
        const indent = Math.max(1, Number(get(cells, 'INDENT')) || 1);
        byIndent[indent - 1] = title;
        byIndent.length = indent;
        const notes: string[] = [];
        const description = get(cells, 'DESCRIPTION');
        if (description) notes.push(description);
        if (indent > 1 && byIndent[indent - 2]) notes.push(`Sub-task of: ${byIndent[indent - 2]}`);

        const row: OutRow = { type: 'task', id: `${projectId}t${++n}`, parent_id: headingId ?? projectId, title, tags };
        const priority = get(cells, 'PRIORITY');
        if (/^[123]$/.test(priority)) row.priority = priority;

        let missed = false;
        const english = (lang: string) => !lang || lang.toLowerCase() === 'en';
        const date = get(cells, 'DATE');
        const read = date && english(get(cells, 'DATE_LANG')) ? readTodoistDate(date, ref) : null;
        let repeat: RepeatColumns | null = null;
        if (read && 'date' in read) Object.assign(row, { start: 'date', start_date: read.date });
        else if (read) Object.assign(row, (repeat = read.repeat));
        else if (date) {
          notes.push(`Todoist date: ${date}`);
          missed = true;
        }

        const deadline = get(cells, 'DEADLINE');
        const due = deadline && english(get(cells, 'DEADLINE_LANG')) ? readTodoistDay(deadline, ref) : null;
        // A repeating task takes its deadline from its rule, so a fixed one is kept as text.
        if (due && !repeat) row.deadline = due;
        else if (deadline) {
          notes.push(`Todoist deadline: ${deadline}`);
          if (!due) missed = true;
        }
        if (missed) unreadable++;

        // My Tasks has no reminders yet, so a reminder is kept as text.
        const reminder = get(cells, 'REMINDER_DATE') || get(cells, 'REMINDER_OFFSET');
        if (reminder) notes.push(`Todoist reminder: ${reminder}`);

        row.notes = notes.join('\n\n');
        rows.push(row);
        lastTask = row;
      } else if (type === 'note' && content) {
        const day = commentDate(get(cells, 'DATE'), ref);
        const comment = day ? `Comment (${day}): ${content}` : `Comment: ${content}`;
        const target = lastTask ?? project;
        target.notes = target.notes ? `${target.notes}\n\n${comment}` : comment;
      }
    }
  });

  return { table: [[...OUT], ...rows.map((r) => OUT.map((c) => r[c] ?? ''))], projects, unreadable };
}
