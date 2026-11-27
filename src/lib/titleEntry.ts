/**
 * Natural-language entry (FR-1.12): the setting, and reading a task's title
 * when it is saved. `model/titleWords.ts` finds the words; this module asks it
 * with what the gist holds (tags, contexts, whether reminders are on), takes
 * the words out of the title and sets the fields, and says what it set.
 */
import { get, writable } from 'svelte/store';
import * as repo from './db/repo';
import { tx, undoGroup } from './db/history';
import { readFlag, writeFlag } from './state/flags';
import { fullSnapshot, settings } from './state/live';
import { remindersOn } from './calendar/calendar';
import { formatTime, isReminderTime, reminderDate, reminderTime } from './model/reminder';
import { ruleText } from './model/repeat';
import { whenLabel, today } from './model/dates';
import { priorityLabel, type AppSettings } from './model/settings';
import { readTitle, typedPart, hasFields, type TitleContext, type TitleFields, type TitleReading } from './model/titleWords';
import type { Snapshot } from './model/lists';
import type { ID, LocalDate, Tag, Todo } from './model/types';
import type { TodoDraft } from './state/draft.svelte';

const KEY = 'mytasks.readTitles';
const store = writable(readFlag(KEY));

/** Whether this device reads task titles (Settings › Task Titles); off until switched on. */
export const readTitles = { subscribe: store.subscribe };

export function setReadTitles(on: boolean): void {
  writeFlag(KEY, on);
  store.set(on);
}

/** A tag's path from the top ("Home/Garden"). */
function tagPath(tag: Tag, tags: Tag[]): string {
  const names = [tag.title];
  const seen = new Set([tag.id]);
  for (let p = tags.find((t) => t.id === tag.parentTagId); p && !seen.has(p.id); p = tags.find((t) => t.id === p!.parentTagId)) {
    seen.add(p.id);
    names.unshift(p.title);
  }
  return names.join('/');
}

/** What the reader needs, for a task with these dates in this project. */
export function titleContext(
  task: { startDate: LocalDate | null; deadline: LocalDate | null; repeat?: unknown; projectId?: ID | null },
  s: Snapshot,
  now = new Date(),
): TitleContext {
  const project = task.projectId ? s.projects.find((p) => p.id === task.projectId) : undefined;
  return {
    ref: today(),
    now,
    tags: s.tags.filter((t) => !t.deletedAt).map((t) => ({ id: t.id, title: t.title, path: tagPath(t, s.tags) })),
    contexts: s.contexts.filter((c) => !c.deletedAt).map((c) => ({ id: c.id, title: c.title })),
    remindersOn: get(remindersOn),
    template: !!task.repeat || !!project?.repeat,
    deadline: task.deadline,
    startDate: task.startDate,
  };
}

/** "Sat · reminder 9:00 AM · P1 · Errand": what was read, for the message. */
export function titleSummary(f: TitleFields, ref: LocalDate, s: Snapshot, prefs: AppSettings): string {
  const parts: string[] = [];
  if (f.startDate) parts.push(f.startDate === ref ? 'Today' : whenLabel(f.startDate, ref));
  if (f.repeat) parts.push(ruleText(f.repeat.rule));
  if (f.deadline) parts.push(`deadline ${f.deadline === ref ? 'today' : whenLabel(f.deadline, ref)}`);
  if (f.reminder) {
    const time = formatTime(isReminderTime(f.reminder) ? f.reminder : reminderTime(f.reminder));
    const day = isReminderTime(f.reminder) ? null : reminderDate(f.reminder);
    parts.push(day && day !== f.startDate ? `reminder ${day === ref ? 'today' : whenLabel(day, ref)} ${time}` : `reminder ${time}`);
  }
  if (f.priority) parts.push(priorityLabel(f.priority, prefs));
  for (const id of f.tagIds ?? []) parts.push(s.tags.find((t) => t.id === id)?.title ?? '');
  if (f.contextId) parts.push(s.contexts.find((c) => c.id === f.contextId)?.title ?? '');
  return parts.filter(Boolean).join(' · ');
}

/** The message after a title was read. */
export const titleMessage = (summary: string) => `From the title: ${summary}`;

/**
 * Read the words typed in an open task's title since `before` (FR-1.12).
 * Returns the reading, or null when the setting is off or nothing was read;
 * `applyTaskTitle` then saves it.
 */
export function readTaskTitle(todo: Todo, before: string, title: string): TitleReading | null {
  if (!get(store)) return null;
  const part = typedPart(before, title);
  if (part.from >= part.to) return null;
  const reading = readTitle(title, titleContext(todo, get(fullSnapshot)), part);
  return hasFields(reading.fields) ? reading : null;
}

/** Save a reading's shorter title and its fields on a task, as one undo step and one transaction. */
export async function applyTaskTitle(id: ID, r: TitleReading): Promise<void> {
  const f = r.fields;
  const ref = today();
  await undoGroup(() =>
    tx(async () => {
      await repo.updateTodoText(id, { title: r.title });
      if (f.repeat) await repo.setRepeat(id, f.repeat.rule, f.repeat.first);
      if (f.startDate) await repo.setWhen(id, f.startDate <= ref ? { kind: 'today' } : { kind: 'date', date: f.startDate });
      if (f.deadline) await repo.setDeadline(id, f.deadline);
      if (f.reminder) await repo.setReminder(id, f.reminder);
      if (f.priority) await repo.setPriority(id, f.priority);
      if (f.contextId) await repo.setContext(id, f.contextId);
      for (const tagId of f.tagIds ?? []) await repo.toggleTag('todos', id, tagId, true);
    }),
  );
}

/**
 * Read a Quick Entry draft's whole title and put what it says into the
 * draft's fields (a repeat is returned, to be set once the task exists).
 * Returns the reading, or null when the setting is off or nothing was read.
 */
export function readDraftTitle(draft: TodoDraft): TitleReading | null {
  if (!get(store)) return null;
  const s = get(fullSnapshot);
  const reading = readTitle(draft.title, titleContext({ ...draft.placement, startDate: draft.startDate, deadline: draft.deadline }, s));
  const f = reading.fields;
  if (!hasFields(f)) return null;
  draft.title = reading.title;
  const ref = today();
  if (f.startDate) draft.setWhen(f.startDate <= ref ? { kind: 'today' } : { kind: 'date', date: f.startDate }, ref);
  if (f.deadline) draft.deadline = f.deadline;
  if (f.reminder) draft.reminder = f.reminder;
  if (f.priority) draft.priority = f.priority;
  if (f.contextId) draft.contextId = f.contextId;
  for (const tagId of f.tagIds ?? []) draft.toggleTag(tagId, true);
  return reading;
}

/** The message for a reading, with today's labels and the user's priority names. */
export function messageFor(r: TitleReading): string {
  return titleMessage(titleSummary(r.fields, today(), get(fullSnapshot), get(settings)));
}
