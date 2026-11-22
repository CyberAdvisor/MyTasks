/**
 * Data operations for My Tasks.
 *
 * Every user change runs in a single IndexedDB transaction (FR-DM.2);
 * `history.ts` records it for undo (FR-1.6). (Until 1.3.7 each change was
 * also written to a local change log, FR-DM.3, which nothing read; review C2.) UI code calls these functions; it never writes to the
 * database directly.
 */
import { db } from './database';
import { clearUndo, tx } from './history';
import { bury } from './bury';
import { nowIso, uuidv7 } from '../model/ids';
import { localDay, today } from '../model/dates';
import { bySortKey, keyAtEnd, keyAtStart, keyBetween, placementKeys } from '../model/order';
import { datedOutOfDeferred, deadlineWhen, inToday } from '../model/lists';
import { nextToRelease, othersToReset, projectOrder, releaseChanges, returnChanges, sequentialRule } from '../model/sequential';
import { priorityRules } from '../model/priority';
import { descendantIds } from '../model/tags';
import { TaskLimitError, hasRoom } from '../model/limits';
import { readSettings, type AppSettings, type SettingKey } from '../model/settings';
import { afterCompletionDate, afterCopy, copyId, copyStart, dueCopy, firstDate } from '../model/repeat';
import { buildPlan, type Existing, type ImportPlan } from '../import/plan';
import type { ImportRow } from '../import/rows';
import type { ArchiveSelection } from '../archive';
import { stateCounts, type StateCounts } from '../model/overview';
import type {
  Area,
  BaseRecord,
  ChecklistItem,
  Context,
  EntityName,
  Heading,
  ID,
  LocalDate,
  Priority,
  Project,
  RepeatRule,
  SavedSearch,
  Tag,
  Todo,
  TodoStart,
} from '../model/types';

/** Fresh base fields for a new record. */
function base(sortKey: string): BaseRecord {
  const at = nowIso();
  return { id: uuidv7(), createdAt: at, modifiedAt: at, deletedAt: null, sortKey };
}

/** Patch a record and stamp `modifiedAt`. */
async function patch<T extends BaseRecord>(entity: EntityName, id: ID, changes: Partial<T>): Promise<void> {
  const fields = Object.keys(changes);
  if (!fields.length) return;
  await db.table(entity).update(id, { ...changes, modifiedAt: nowIso() });
}

/** Sort keys of siblings matching `filter`, used to append at the end. A read helper: see `liveChecklist`. */
function siblingKeys<T extends BaseRecord>(entity: EntityName, filter: (r: T) => boolean): Promise<string[]> {
  return db
    .table(entity)
    .toArray()
    .then((rows) => (rows as T[]).filter((r) => r.deletedAt === null && filter(r)).map((r) => r.sortKey));
}

/**
 * Write the keys that put record `id` at its position in `order` (sibling ids
 * in display order), plus `extra` changes on the moved record. Usually only
 * the moved record changes (see `placementKeys`). Call inside a transaction.
 */
async function place<T extends BaseRecord>(
  entity: EntityName,
  id: ID,
  order: ID[],
  field: string,
  keyOf: (r: T) => string | null,
  extra: Partial<T> = {},
): Promise<void> {
  const rows = (await db.table(entity).bulkGet(order)) as (T | undefined)[];
  const byId = new Map(rows.filter((r): r is T => !!r).map((r) => [r.id, r]));
  const keys = placementKeys(order, id, (x) => {
    const r = byId.get(x);
    return r ? keyOf(r) : null;
  });
  for (const [x, key] of keys) {
    await patch<T>(entity, x, { [field]: key, ...(x === id ? extra : {}) } as Partial<T>);
  }
  if (!keys.has(id) && Object.keys(extra).length) await patch<T>(entity, id, extra);
}

/**
 * Sort key that moves record `id` one place up or down among the siblings
 * matching `filter`, or `null` when it is already at that end. A read helper:
 * see `liveChecklist`.
 */
function shiftedKey<T extends BaseRecord>(
  entity: EntityName,
  id: ID,
  filter: (r: T) => boolean,
  direction: 'up' | 'down',
): Promise<string | null> {
  return db
    .table(entity)
    .toArray()
    .then((all) => keyShifted(bySortKey((all as T[]).filter((r) => r.deletedAt === null && filter(r))), id, direction));
}

/** The sort key that moves `id` one place within `rows` (in order), or `null` at that end. */
function keyShifted(rows: BaseRecord[], id: ID, direction: 'up' | 'down'): string | null {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const others = rows.filter((r) => r.id !== id);
  if (direction === 'up') {
    if (i === 0) return null;
    return keyBetween(others[i - 2]?.sortKey ?? null, others[i - 1].sortKey);
  }
  if (i === rows.length - 1) return null;
  return keyBetween(others[i].sortKey, others[i + 1]?.sortKey ?? null);
}

// ---------------------------------------------------------------------------
// Settings and automatic priority (FR-14.9 to FR-14.14)
// ---------------------------------------------------------------------------

/** Current settings, read inside the caller's transaction. A read helper: see `liveChecklist`. */
function loadSettings(): Promise<AppSettings> {
  return db.settings.toArray().then(readSettings);
}

/**
 * The changes the automatic rules make to a to-do now, or `null`: a reached
 * deadline sets When to today (FR-3.7), then the priority rules (FR-14.9,
 * FR-14.10, and FR-17.3 for a task in sequential `project`) run on the result.
 */
function autoChanges(t: Todo, ref: LocalDate, settings: AppSettings, project?: Project): Partial<Todo> | null {
  const when = deadlineWhen(t, ref);
  const rule = project ? sequentialRule(project, settings.sequentialTags) : null;
  const priority = priorityRules({ ...t, ...when }, ref, settings, rule?.priority ?? null);
  return when || priority ? { ...when, ...priority } : null;
}

/** Apply the automatic rules to one to-do after a change. */
async function applyAutoRules(id: ID): Promise<void> {
  const t = await db.todos.get(id);
  // A repeating task's template is never in Today and takes no automatic priority; its copies do.
  if (!t || t.repeat) return;
  const project = t.projectId ? await db.projects.get(t.projectId) : undefined;
  // Nor do the tasks of a repeating project's template (FR-4.6).
  if (project?.repeat) return;
  const changes = autoChanges(t, today(), await loadSettings(), project);
  if (changes) await patch<Todo>('todos', id, changes);
}

/**
 * If project `projectId` is sequential and has no open task in Today, move
 * its next task there (FR-17.2). `releasedBy` is the task whose completion
 * caused it, so unchecking that task can take it back (FR-17.5).
 */
async function release(projectId: ID, releasedBy: ID | null): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project || project.repeat) return;
  const settings = await loadSettings();
  const rule = sequentialRule(project, settings.sequentialTags);
  if (!rule) return;
  const todos = await db.todos.where('projectId').equals(projectId).toArray();
  const headings = await db.headings.where('projectId').equals(projectId).toArray();
  const ref = today();
  const next = nextToRelease(project, projectOrder(projectId, todos, headings), ref);
  if (!next) return;
  await patch<Todo>('todos', next.id, releaseChanges(next, ref, rule, releasedBy));
  await applyAutoRules(next.id);
}

/**
 * Return a released task, or one put in Today by hand, to where it was,
 * without the priority and context Today gave it (FR-17.5, FR-17.6).
 */
async function returnTask(t: Todo): Promise<void> {
  await patch<Todo>('todos', t.id, returnChanges(t));
  await applyAutoRules(t.id);
}

/**
 * Make the copies repeating tasks are due to make (FR-4.1), move any dated
 * task or project out of Deferred (`datedOutOfDeferred`), run the
 * automatic rules over every open to-do (FR-3.5, FR-3.7, FR-14.9), then
 * release a task in each sequential project with none in Today (FR-17.2). Called at launch, on resume and at midnight, so start dates
 * arriving and deadlines passing are picked up without background
 * execution. Not an undo step; the changes sync like any edit.
 *
 * The changes are worked out in memory first and written in bulk calls:
 * a long chain of single writes can let IndexedDB commit the transaction
 * early (Dexie's PrematureCommitError), which stopped the sweep whenever it
 * changed more than one to-do.
 */
export function sweepRules(): Promise<void> {
  return tx(async () => {
    const settings = await loadSettings();
    const ref = today();
    const at = nowIso();
    await makeDueCopies(ref);
    const todos = (await db.todos.toArray()).filter((t) => t.deletedAt === null);
    const projects = (await db.projects.toArray()).filter((p) => p.deletedAt === null);
    const headings = await db.headings.toArray();
    const projectOf = new Map(projects.map((p) => [p.id, p]));

    // Each to-do as changed so far, and the changes to write.
    const current = new Map(todos.map((t) => [t.id, t]));
    const changes = new Map<ID, Partial<Todo>>();
    const apply = (id: ID, c: Partial<Todo> | null) => {
      if (!c) return;
      current.set(id, { ...current.get(id)!, ...c });
      changes.set(id, { ...changes.get(id), ...c });
    };
    const project = (t: Todo) => (t.projectId ? projectOf.get(t.projectId) : undefined);

    // A dated task in Deferred becomes scheduled first, so the rules below see it there.
    for (const t of todos) apply(t.id, datedOutOfDeferred(t));
    // A repeating project's template is a pattern: the rules act on its copies' tasks, not its own (FR-4.6).
    const ruled = (t: Todo) => t.status === 'open' && !t.repeat && !project(t)?.repeat;
    for (const t of todos) if (ruled(t)) apply(t.id, autoChanges(current.get(t.id)!, ref, settings, project(t)));
    for (const p of projects) {
      if (p.repeat) continue;
      const rule = sequentialRule(p, settings.sequentialTags);
      if (!rule) continue;
      const next = nextToRelease(p, projectOrder(p.id, [...current.values()], headings), ref);
      if (!next) continue;
      apply(next.id, releaseChanges(next, ref, rule, null));
      apply(next.id, autoChanges(current.get(next.id)!, ref, settings, p));
    }

    const projectFixes = projects.filter((p) => datedOutOfDeferred(p));
    if (projectFixes.length) {
      await db.projects.bulkUpdate(projectFixes.map((p) => ({ key: p.id, changes: { ...datedOutOfDeferred(p)!, modifiedAt: at } })));
    }
    if (!changes.size) return;
    const updates = [...changes].map(([key, c]) => ({ key, changes: { ...c, modifiedAt: at } }));
    await db.todos.bulkUpdate(updates);
  }, { track: false });
}

/**
 * Save one setting. Turning a rule on applies it to existing to-dos; turning
 * it off leaves the priorities it already set (FR-14.14).
 */
export async function setSetting<K extends SettingKey>(key: K, value: AppSettings[K]): Promise<void> {
  await tx(() => db.settings.put({ key, value, modifiedAt: nowIso() }), { track: false });
  if (key === 'moveToCompleted') await sweepCompleted();
  else if (key === 'sequentialTags' || (value === true && (key === 'autoP1' || key === 'defaultP2'))) await sweepRules();
}

// ---------------------------------------------------------------------------
// Moving completed items to Completed (FR-12.2)
// ---------------------------------------------------------------------------

/**
 * Status, completion time and move time for a status change. A closed item
 * goes straight to Completed when the setting is Immediately; otherwise it
 * waits in its list. Reopening clears both times.
 */
function statusFields(
  status: Todo['status'],
  at: string,
  settings: AppSettings,
): Pick<Todo, 'status' | 'completedAt' | 'loggedAt'> {
  if (status === 'open') return { status, completedAt: null, loggedAt: null };
  return { status, completedAt: at, loggedAt: settings.moveToCompleted === 'immediately' ? at : null };
}

/** Whether a waiting item is due to move under `mode`, given today's date. */
function dueToMove(item: Todo | Project, mode: AppSettings['moveToCompleted'], ref: LocalDate): boolean {
  if (item.status === 'open' || item.loggedAt !== null) return false;
  if (mode === 'immediately') return true;
  // Daily: everything completed before today (FR-3.5 rollover).
  return mode === 'daily' && item.completedAt !== null && localDay(item.completedAt) < ref;
}

/**
 * Move the waiting items the setting says are due: all of them for
 * Immediately, those completed before today for Daily, none for Manually.
 * Runs at launch, on resume, at midnight and when the setting changes. It is
 * the app's own change, so it never replaces the user's last undo step.
 */
export function sweepCompleted(): Promise<void> {
  return tx(async () => {
    const { moveToCompleted } = await loadSettings();
    if (moveToCompleted === 'manually') return;
    const ref = today();
    const at = nowIso();
    for (const t of await db.todos.where('status').anyOf('completed', 'canceled').toArray()) {
      if (dueToMove(t, moveToCompleted, ref)) await patch<Todo>('todos', t.id, { loggedAt: at });
    }
    for (const p of await db.projects.where('status').anyOf('completed', 'canceled').toArray()) {
      if (dueToMove(p, moveToCompleted, ref)) await patch<Project>('projects', p.id, { loggedAt: at });
    }
  }, { track: false });
}

/** Move Completed Items (FR-12.2): move the given waiting to-dos and projects now. Undoable. */
export function moveToCompleted(ids: { todos: ID[]; projects: ID[] }): Promise<void> {
  return tx(async () => {
    const at = nowIso();
    for (const id of ids.todos) await patch<Todo>('todos', id, { loggedAt: at });
    for (const id of ids.projects) await patch<Project>('projects', id, { loggedAt: at });
  });
}

/** Set or clear a to-do's context (FR-18.3). */
export function setContext(id: ID, contextId: ID | null): Promise<void> {
  return tx(() => patch<Todo>('todos', id, { contextId }));
}

/** Set or clear a to-do's priority as the user's own choice (FR-14.2). */
export function setPriority(id: ID, priority: Priority | null): Promise<void> {
  return tx(() =>
    patch<Todo>('todos', id, { priority, prioritySource: 'user', priorityBeforeAuto: null }),
  );
}

// ---------------------------------------------------------------------------
// Repeating tasks (FR-4.1 to FR-4.4, FR-14.7)
// ---------------------------------------------------------------------------

/**
 * Make the copy `template` is due to make for `date`, just above the
 * template in its list, unless it exists already (made here before, or on
 * another device and synced: the id is the same everywhere). The copy is an
 * ordinary task with the template's title, notes, checklist, tags, context
 * and place. It keeps a priority the user set on the template (FR-14.7);
 * otherwise the automatic rules decide.
 *
 * Asked for by hand (`byHand`, Create Next Copy), a copy is made even when
 * that date's copy was trashed or deleted, under new ids: the shared ones
 * still belong to the deleted copy. Made on its own, it isn't, so a copy
 * skipped on one device doesn't come back from another. Returns the copy's id.
 */
async function makeCopy(template: Todo, rule: RepeatRule, date: LocalDate, byHand = false): Promise<ID> {
  let id = copyId(template.id, date);
  const existing = await db.todos.get(id);
  if (existing) {
    const dead = existing.deletedAt !== null || existing.trashedAt !== null;
    if (!byHand || !dead) return id;
    id = uuidv7();
  }
  const shared = id === copyId(template.id, date);
  const keys = await siblingKeys<Todo>(
    'todos',
    (x) => x.projectId === template.projectId && x.areaId === template.areaId && x.sortKey < template.sortKey,
  );
  const before = keys.length ? keys.sort().at(-1)! : null;
  const at = nowIso();
  const userPriority = template.prioritySource === 'user';
  const copy: Todo = {
    ...template,
    id,
    createdAt: at,
    modifiedAt: at,
    deletedAt: null,
    sortKey: keyBetween(before, template.sortKey),
    status: 'open',
    start: 'unscheduled',
    startDate: copyStart(rule, date),
    todaySortKey: null,
    deadline: rule.deadlineDays !== null ? date : null,
    priority: userPriority ? template.priority : null,
    prioritySource: userPriority ? 'user' : null,
    priorityBeforeAuto: null,
    completedAt: null,
    loggedAt: null,
    trashedAt: null,
    releasedBy: null,
    releasedFrom: null,
    repeat: null,
    repeatOf: template.id,
  };
  await db.todos.add(copy);
  for (const item of await liveChecklist(template.id)) {
    const c: ChecklistItem = { ...item, ...base(item.sortKey), id: shared ? copyId(item.id, date) : uuidv7(), todoId: id, completed: false };
    await db.checklistItems.add(c);
  }
  return id;
}

/**
 * Make the copy `template` is due to make now, if any, and move the template
 * on to its next date. When the repeat ends, the template stops repeating
 * and goes to Completed (FR-4.2).
 */
async function makeDueCopy(template: Todo, ref: LocalDate): Promise<void> {
  const rule = template.repeat;
  if (!rule || template.status !== 'open' || template.trashedAt || template.deletedAt) return;
  const due = dueCopy(rule, template.startDate, ref);
  if (due) await copyAndMoveOn(template, rule, due.date, due);
}

/**
 * Make `template`'s copy for `date`, then move the template on to `then.next`,
 * or, when the repeat has ended, stop it and send it to Completed (FR-4.2).
 * Returns the copy's id.
 */
async function copyAndMoveOn(
  template: Todo,
  rule: RepeatRule,
  date: LocalDate,
  then: { next: LocalDate | null; finished: boolean },
  byHand = false,
): Promise<ID> {
  const id = await makeCopy(template, rule, date, byHand);
  if (then.finished) {
    const at = nowIso();
    await patch<Todo>('todos', template.id, { repeat: null, startDate: null, status: 'completed', completedAt: at, loggedAt: at });
  } else {
    await patch<Todo>('todos', template.id, { startDate: then.next, repeat: { ...rule, made: rule.made + 1 } });
  }
  await applyAutoRules(id);
  return id;
}

/**
 * Make a template's next copy now (Create Next Copy, FR-4.4):
 * a fixed schedule's copy keeps its scheduled date and the template moves on
 * to the date after; after completion, the copy is for its waiting date, or
 * today, and the template waits for it. Returns the copy's id.
 */
async function nextCopyNow(template: Todo): Promise<ID | undefined> {
  const rule = template.repeat;
  if (!rule || template.status !== 'open') return undefined;
  const ref = today();
  const date = template.startDate ?? (rule.mode === 'fixed' ? firstDate(rule, ref) : ref);
  if (!date) return undefined;
  return copyAndMoveOn(template, rule, date, afterCopy(rule, date), true);
}

/** Create Next Copy (FR-4.4): one undo step. */
export function createNextCopy(id: ID): Promise<ID | undefined> {
  return tx(async () => {
    const t = await db.todos.get(id);
    return t ? nextCopyNow(t) : undefined;
  });
}

/**
 * The copy Show Previous Copy goes to (FR-4.4): the latest of a template's
 * copies by date, open or closed, that isn't in the Trash.
 */
export async function previousCopy(templateId: ID): Promise<Todo | undefined> {
  const copies = await db.todos.filter((t) => t.repeatOf === templateId && t.deletedAt === null && !t.trashedAt).toArray();
  return copies.sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1))[0];
}

/**
 * Release every after-completion template left waiting for a copy that is
 * gone: its copy was trashed or deleted, so it would otherwise never get a
 * date or make another copy. It is dated from today, as when its copy is
 * done or cancelled (FR-4.1). Run when a task, project or area is trashed,
 * and at launch, on return and at midnight, which repairs any left stuck.
 */
async function releaseWaitingTemplates(ref: LocalDate): Promise<void> {
  const projects = (await db.projects.toArray()).filter((p) => p.deletedAt === null);
  const gone = new Set(projects.filter((p) => p.trashedAt).map((p) => p.id));
  // A copy counts while it is open and neither it nor its project is in the Trash.
  const live = (c: { status: string; trashedAt: string | null; deletedAt: string | null }, projectId: ID | null) =>
    c.status === 'open' && !c.trashedAt && c.deletedAt === null && !(projectId && gone.has(projectId));
  const waiting = (t: { repeat: RepeatRule | null; status: string; trashedAt: string | null; deletedAt: string | null; startDate: LocalDate | null }) =>
    t.repeat?.mode === 'afterCompletion' && !t.repeat.paused && t.status === 'open' && !t.trashedAt && t.deletedAt === null && t.startDate === null;

  const todos = (await db.todos.toArray()).filter((t) => t.deletedAt === null);
  const withCopy = new Set(todos.filter((c) => c.repeatOf && live(c, c.projectId)).map((c) => c.repeatOf));
  for (const t of todos.filter((t) => waiting(t) && !withCopy.has(t.id))) {
    await patch<Todo>('todos', t.id, { startDate: afterCompletionDate(t.repeat!, ref) });
  }
  const projectWithCopy = new Set(projects.filter((c) => c.repeatOf && live(c, null)).map((c) => c.repeatOf));
  for (const p of projects.filter((p) => waiting(p) && !projectWithCopy.has(p.id))) {
    await patch<Project>('projects', p.id, { startDate: afterCompletionDate(p.repeat!, ref) });
  }
}

/** Make every repeating task's and project's due copy (at launch, on return and at midnight). */
async function makeDueCopies(ref: LocalDate): Promise<void> {
  await releaseWaitingTemplates(ref);
  const templates = await db.todos.filter((t) => t.repeat !== null && t.deletedAt === null).toArray();
  for (const t of templates) await makeDueCopy(t, ref);
  const projects = await db.projects.filter((p) => p.repeat !== null && p.deletedAt === null).toArray();
  for (const p of projects) await makeDueProjectCopy(p, ref);
}

/** Close a copy made early (FR-4.4), as checking it off would. */
async function closeCopy(id: ID, status: Todo['status'], settings: AppSettings): Promise<void> {
  const copy = await db.todos.get(id);
  if (!copy || copy.status !== 'open') return;
  await patch<Todo>('todos', id, statusFields(status, nowIso(), settings));
  if (copy.repeatOf) await copyDone(copy.repeatOf);
}

/** A copy was done: an after-completion repeat dates its next copy from today (FR-4.1). */
async function copyDone(templateId: ID): Promise<void> {
  const template = await db.todos.get(templateId);
  const rule = template?.repeat;
  if (!template || !rule || rule.mode !== 'afterCompletion') return;
  const ref = today();
  await patch<Todo>('todos', templateId, { startDate: afterCompletionDate(rule, ref) });
  await makeDueCopy((await db.todos.get(templateId))!, ref);
}

/**
 * Make a task repeat, or change its rule (FR-4.1, Edit Rule… FR-4.4). The
 * task becomes the template: it leaves Today and the Inbox, and `next` is
 * its first copy's date (after completion: today, or null while a copy
 * waits to be done). If that copy is due, it is made at once. One undo step.
 */
export function setRepeat(id: ID, rule: RepeatRule, next: LocalDate | null): Promise<void> {
  return tx(async () => {
    const t = await db.todos.get(id);
    if (!t || t.deletedAt) return;
    await patch<Todo>('todos', id, {
      repeat: rule,
      repeatOf: null,
      status: 'open',
      completedAt: null,
      loggedAt: null,
      start: 'unscheduled',
      startDate: next,
      todaySortKey: null,
      deadline: null,
      releasedBy: null,
      releasedFrom: null,
      // The template keeps a priority the user chose, for its copies; an automatic one goes.
      ...(t.prioritySource === 'auto' ? { priority: null, prioritySource: null, priorityBeforeAuto: null } : {}),
    });
    await makeDueCopy((await db.todos.get(id))!, today());
  });
}

/** Pause a repeating task, or resume it (FR-4.4). Resumed, a copy that has come due is made. */
export function setRepeatPaused(id: ID, paused: boolean): Promise<void> {
  return tx(async () => {
    const t = await db.todos.get(id);
    if (!t?.repeat) return;
    await patch<Todo>('todos', id, { repeat: { ...t.repeat, paused } });
    if (!paused) await makeDueCopy((await db.todos.get(id))!, today());
  });
}

/**
 * Stop a repeating task (FR-4.4): the template and its copies become
 * ordinary tasks. The template keeps its date, so it shows where that date
 * puts it.
 */
export function stopRepeat(id: ID): Promise<void> {
  return tx(async () => {
    const t = await db.todos.get(id);
    if (!t?.repeat) return;
    await patch<Todo>('todos', id, { repeat: null });
    for (const c of await db.todos.filter((x) => x.repeatOf === id && x.deletedAt === null).toArray()) {
      await patch<Todo>('todos', c.id, { repeatOf: null });
    }
    await applyAutoRules(id);
  });
}

// ---------------------------------------------------------------------------
// Repeating projects (FR-4.6)
// ---------------------------------------------------------------------------

/**
 * Make the copy project `template` is due to make for `date`, unless it
 * exists already: the project with its notes, tags and area, every heading
 * that isn't archived, and every task in it (not those in the Trash or under
 * an archived heading) with its checklist, in the same order, just above the
 * template among its siblings. A copy is the whole project, its
 * tasks open and its checklists unchecked. Every id comes from the template
 * record's id and the date (`copyId`), so two devices making the same copy
 * end up with one set of records. Made by hand (Create Next Copy) where that
 * date's copy was trashed or deleted, they come from the date and a new id.
 * Returns that key. Copies are never refused by the task limit
 * (NFR-7), as for repeating tasks.
 */
async function makeProjectCopy(template: Project, rule: RepeatRule, date: LocalDate, byHand = false): Promise<string> {
  // The ids come from `key`: the date, or, for a copy made by hand where that date's copy was trashed or deleted, the date with a new id after it.
  let key: string = date;
  const existing = await db.projects.get(copyId(template.id, key));
  if (existing) {
    const dead = existing.deletedAt !== null || existing.trashedAt !== null;
    if (!byHand || !dead) return key;
    key = `${date}#${uuidv7()}`;
  }
  const id = copyId(template.id, key);
  const keys = await siblingKeys<Project>(
    'projects',
    (x) => (x.areaId ?? null) === (template.areaId ?? null) && x.sortKey < template.sortKey,
  );
  const before = keys.length ? keys.sort().at(-1)! : null;
  const at = nowIso();
  const stamp = (recordId: ID, sortKey: string) => ({ id: copyId(recordId, key), createdAt: at, modifiedAt: at, deletedAt: null, sortKey });
  await db.projects.add({
    ...template,
    ...stamp(template.id, keyBetween(before, template.sortKey)),
    tagIds: [...template.tagIds],
    status: 'open',
    start: 'unscheduled',
    startDate: copyStart(rule, date),
    deadline: rule.deadlineDays !== null ? date : null,
    completedAt: null,
    loggedAt: null,
    trashedAt: null,
    repeat: null,
    repeatOf: template.id,
  });

  const headings = (await db.headings.where('projectId').equals(template.id).toArray()).filter((h) => h.deletedAt === null);
  const archived = new Set(headings.filter((h) => h.archived).map((h) => h.id));
  for (const h of headings.filter((x) => !x.archived)) {
    await db.headings.add({ ...h, ...stamp(h.id, h.sortKey), projectId: id });
  }
  const todos = (await db.todos.where('projectId').equals(template.id).toArray()).filter(
    (t) => t.deletedAt === null && t.trashedAt === null && !(t.headingId && archived.has(t.headingId)),
  );
  for (const t of todos) {
    const userPriority = t.prioritySource === 'user';
    const taskId = copyId(t.id, key);
    await db.todos.add({
      ...t,
      ...stamp(t.id, t.sortKey),
      tagIds: [...t.tagIds],
      projectId: id,
      headingId: t.headingId ? copyId(t.headingId, key) : null,
      status: 'open',
      todaySortKey: null,
      priority: userPriority ? t.priority : null,
      prioritySource: userPriority ? 'user' : null,
      priorityBeforeAuto: null,
      completedAt: null,
      loggedAt: null,
      trashedAt: null,
      releasedBy: null,
      releasedFrom: null,
      repeat: null,
      repeatOf: null,
    });
    for (const item of await liveChecklist(t.id)) {
      await db.checklistItems.add({ ...item, ...stamp(item.id, item.sortKey), todoId: taskId, completed: false });
    }
    await applyAutoRules(taskId);
  }
  return key;
}

/**
 * Make `template`'s copy for `date`, then move the template on to `then.next`,
 * or, when the repeat has ended, stop it and send it to Completed (FR-4.2).
 * Returns the copy's id and the key its records' ids come from.
 */
async function projectCopyAndMoveOn(
  template: Project,
  rule: RepeatRule,
  date: LocalDate,
  then: { next: LocalDate | null; finished: boolean },
  byHand = false,
): Promise<{ id: ID; key: string }> {
  const key = await makeProjectCopy(template, rule, date, byHand);
  if (then.finished) {
    const at = nowIso();
    await patch<Project>('projects', template.id, { repeat: null, startDate: null, status: 'completed', completedAt: at, loggedAt: at });
  } else {
    await patch<Project>('projects', template.id, { startDate: then.next, repeat: { ...rule, made: rule.made + 1 } });
  }
  const id = copyId(template.id, key);
  await release(id, null);
  return { id, key };
}

/** Make the copy a repeating project is due to make now, if any (at launch, on return, at midnight). */
async function makeDueProjectCopy(template: Project, ref: LocalDate): Promise<void> {
  const rule = template.repeat;
  if (!rule || template.status !== 'open' || template.trashedAt || template.deletedAt) return;
  const due = dueCopy(rule, template.startDate, ref);
  if (due) await projectCopyAndMoveOn(template, rule, due.date, due);
}

/** A project's copy was completed: an after-completion repeat dates its next copy from today (FR-4.1). */
async function projectCopyDone(templateId: ID): Promise<void> {
  const template = await db.projects.get(templateId);
  const rule = template?.repeat;
  if (!template || !rule || rule.mode !== 'afterCompletion') return;
  const ref = today();
  await patch<Project>('projects', templateId, { startDate: afterCompletionDate(rule, ref) });
  await makeDueProjectCopy((await db.projects.get(templateId))!, ref);
}

/**
 * Make a project repeat, or change its rule (FR-4.6). The project becomes
 * the template and `next` is its first copy's date. A first
 * copy due now is made from the project as it is, its tasks' dates
 * included; the template's tasks then lose their start dates and deadlines
 * (the dates belong to copies), and a repeating task inside it stops
 * repeating, its copies becoming ordinary tasks. One undo step.
 */
export function setProjectRepeat(id: ID, rule: RepeatRule, next: LocalDate | null): Promise<void> {
  return tx(async () => {
    const p = await db.projects.get(id);
    if (!p || p.deletedAt) return;
    await patch<Project>('projects', id, {
      repeat: rule,
      repeatOf: null,
      status: 'open',
      completedAt: null,
      loggedAt: null,
      start: 'unscheduled',
      startDate: next,
      deadline: null,
    });
    await makeDueProjectCopy((await db.projects.get(id))!, today());
    for (const t of await db.todos.where('projectId').equals(id).toArray()) {
      if (t.deletedAt) continue;
      await patch<Todo>('todos', t.id, {
        start: t.start === 'deferred' ? 'deferred' : 'unscheduled',
        startDate: null,
        deadline: null,
        todaySortKey: null,
        releasedBy: null,
        releasedFrom: null,
        ...(t.prioritySource === 'auto' ? { priority: null, prioritySource: null, priorityBeforeAuto: null } : {}),
        ...(await endRepeat(t)),
      });
    }
  });
}

/**
 * Make a repeating project's next copy now, as for a task (FR-4.4): a fixed
 * schedule's copy keeps its date and the template moves on; after
 * completion, the copy is for its waiting date, or today. Returns the copy's
 * id and the key its records' ids come from (`makeProjectCopy`), or nothing
 * when the template has no copy to make.
 */
async function nextProjectCopyNow(template: Project): Promise<{ id: ID; key: string } | undefined> {
  const rule = template.repeat;
  if (!rule || template.status !== 'open') return undefined;
  const ref = today();
  const date = template.startDate ?? (rule.mode === 'fixed' ? firstDate(rule, ref) : ref);
  if (!date) return undefined;
  return projectCopyAndMoveOn(template, rule, date, afterCopy(rule, date), true);
}

/** Create Next Copy on a repeating project (FR-4.6): one undo step. Returns the copy's id. */
export function createNextProjectCopy(id: ID): Promise<ID | undefined> {
  return tx(async () => {
    const template = await db.projects.get(id);
    return template ? (await nextProjectCopyNow(template))?.id : undefined;
  });
}

/** Of `ids`, the tasks in a repeating project's template (FR-4.6), in the same order. */
export async function templateTaskIds(ids: ID[]): Promise<ID[]> {
  const todos = await db.todos.bulkGet(ids);
  const projectIds = [...new Set(todos.map((t) => t?.projectId).filter((p): p is ID => !!p))];
  const templates = new Set(
    (await db.projects.bulkGet(projectIds)).filter((p) => p?.repeat && !p.deletedAt).map((p) => p!.id),
  );
  return todos.filter((t) => t?.projectId && templates.has(t.projectId)).map((t) => t!.id);
}

/**
 * Create Copy Now (FR-4.6): a change that would give a
 * template's task a date, or close it, goes to the next copy instead. Makes
 * the next copy of each template the tasks `ids` belong to, and returns the
 * copies' ids and, in the order of `ids`, the ids of their tasks made from
 * them. The template is left as it was, apart from moving on to its next date.
 */
export function copyNowForTasks(ids: ID[]): Promise<{ projectIds: ID[]; taskIds: ID[] }> {
  return tx(async () => {
    const todos = (await db.todos.bulkGet(ids)).filter((t): t is Todo => !!t?.projectId);
    const dates = new Map<ID, string>();
    const projectIds: ID[] = [];
    for (const projectId of new Set(todos.map((t) => t.projectId!))) {
      const template = await db.projects.get(projectId);
      const made = template?.repeat ? await nextProjectCopyNow(template) : undefined;
      if (!made) continue;
      dates.set(projectId, made.key);
      projectIds.push(made.id);
    }
    const taskIds: ID[] = [];
    for (const t of todos) {
      const date = dates.get(t.projectId!);
      const id = date && copyId(t.id, date);
      if (id && (await db.todos.get(id))) taskIds.push(id);
    }
    return { projectIds, taskIds };
  });
}

/** Pause a repeating project, or resume it (FR-4.6, as FR-4.4). Resumed, a copy that has come due is made. */
export function setProjectRepeatPaused(id: ID, paused: boolean): Promise<void> {
  return tx(async () => {
    const p = await db.projects.get(id);
    if (!p?.repeat) return;
    await patch<Project>('projects', id, { repeat: { ...p.repeat, paused } });
    if (!paused) await makeDueProjectCopy((await db.projects.get(id))!, today());
  });
}

/**
 * Stop a repeating project (FR-4.6, as FR-4.4): the template and its copies
 * become ordinary projects, and the template's tasks show in the lists
 * again. The template keeps its date, so it shows where that date puts it.
 */
export function stopProjectRepeat(id: ID): Promise<void> {
  return tx(async () => {
    const p = await db.projects.get(id);
    if (!p?.repeat) return;
    await patch<Project>('projects', id, { repeat: null });
    for (const c of await db.projects.filter((x) => x.repeatOf === id && x.deletedAt === null).toArray()) {
      await patch<Project>('projects', c.id, { repeatOf: null });
    }
    for (const t of await db.todos.where('projectId').equals(id).toArray()) {
      if (!t.deletedAt) await applyAutoRules(t.id);
    }
  });
}

/** The copy Show Previous Copy goes to: the latest of a template's copies by date that isn't in the Trash. */
export async function previousProjectCopy(templateId: ID): Promise<Project | undefined> {
  const copies = await db.projects.filter((p) => p.repeatOf === templateId && p.deletedAt === null && !p.trashedAt).toArray();
  return copies.sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1))[0];
}

// ---------------------------------------------------------------------------
// To-do invariants
// ---------------------------------------------------------------------------

/**
 * Keep `start` consistent with a to-do's container and When date:
 * a to-do leaves the Inbox once it gets a container or a When date.
 * (A to-do may be Unscheduled with no container.)
 */
function normalizeStart(t: Pick<Todo, 'start' | 'startDate' | 'areaId' | 'projectId'>): TodoStart {
  const contained = t.areaId !== null || t.projectId !== null;
  if (t.start === 'inbox' && (contained || t.startDate !== null)) return 'unscheduled';
  return t.start;
}

/** Where a new or moved to-do goes. `null` everywhere means the Inbox. */
export interface TodoPlacement {
  areaId?: ID | null;
  projectId?: ID | null;
  headingId?: ID | null;
}

// ---------------------------------------------------------------------------
// To-dos
// ---------------------------------------------------------------------------

/** Options for a new to-do. */
export interface NewTodo extends TodoPlacement {
  title?: string;
  /** Start state for a to-do with no container; defaults to the Inbox. */
  start?: TodoStart;
  startDate?: LocalDate | null;
  deferred?: boolean;
  /** Put the new to-do at the top of its container instead of the bottom. */
  atStart?: boolean;
  /** Fields filled in Quick Entry (FR-8.1). */
  notes?: string;
  deadline?: LocalDate | null;
  tagIds?: ID[];
  /** A priority the user chose; `null` means they chose None. Omit for no choice. */
  priority?: Priority | null;
  contextId?: ID | null;
  checklist?: { title: string; completed: boolean }[];
}

/** How many tasks this device holds toward the limit: every one not deleted (model/limits.ts). */
export function taskCount(): Promise<number> {
  return db.todos.filter((t) => t.deletedAt === null).count();
}

/** Throw TaskLimitError unless `adding` more tasks fit under MAX_TASKS (NFR-7). */
export async function ensureRoom(adding = 1): Promise<void> {
  const count = await taskCount();
  if (!hasRoom(count, adding)) throw new TaskLimitError(count, adding);
}

/**
 * Create a to-do with everything set in one transaction and return its id
 * (FR-1.1, FR-8.1). The automatic priority rules then run as for any change.
 */
export async function createTodo(opts: NewTodo = {}): Promise<ID> {
  return tx(async () => {
    await ensureRoom();
    const projectId = opts.projectId ?? null;
    const project = projectId ? await db.projects.get(projectId) : undefined;
    const areaId = projectId ? null : (opts.areaId ?? null);
    const headingId = projectId ? (opts.headingId ?? null) : null;
    const keys = await siblingKeys<Todo>('todos', (t) =>
      projectId ? t.projectId === projectId : areaId ? t.areaId === areaId && !t.projectId : !t.projectId && !t.areaId,
    );
    const startDate = opts.deferred ? null : (opts.startDate ?? null);
    const todo: Todo = {
      ...base(opts.atStart ? keyAtStart(keys) : keyAtEnd(keys)),
      title: opts.title ?? '',
      notes: opts.notes ?? '',
      status: 'open',
      start: normalizeStart({
        start: opts.deferred ? 'deferred' : (opts.start ?? 'inbox'),
        startDate,
        areaId,
        projectId,
      }),
      startDate,
      todaySortKey: null,
      deadline: opts.deadline ?? null,
      priority: opts.priority ?? null,
      prioritySource: opts.priority === undefined ? null : 'user',
      priorityBeforeAuto: null,
      tagIds: opts.tagIds ?? [],
      contextId: opts.contextId ?? null,
      areaId,
      projectId: project ? projectId : null,
      headingId,
      completedAt: null,
      loggedAt: null,
      trashedAt: null,
      releasedBy: null,
      releasedFrom: null,
      repeat: null,
      repeatOf: null,
    };
    await db.todos.add(todo);
    let key: string | null = null;
    for (const c of opts.checklist ?? []) {
      key = keyBetween(key, null);
      const item: ChecklistItem = { ...base(key), todoId: todo.id, title: c.title, completed: c.completed };
      await db.checklistItems.add(item);
    }
    await applyAutoRules(todo.id);
    return todo.id;
  });
}

/** Edit title or notes. */
export function updateTodoText(id: ID, changes: Partial<Pick<Todo, 'title' | 'notes'>>): Promise<void> {
  return tx(() => patch<Todo>('todos', id, changes));
}

/** When choices from the When picker (FR-3.1). */
export type WhenChoice =
  | { kind: 'today' }
  | { kind: 'date'; date: LocalDate }
  | { kind: 'deferred' }
  /** Available with no date, even for an unfiled to-do. */
  | { kind: 'unscheduled' }
  | { kind: 'clear' };

/** Apply a When choice to a to-do. */
export function setWhen(id: ID, choice: WhenChoice): Promise<void> {
  return tx(async () => {
    const t = await db.todos.get(id);
    if (!t) return;
    let start: TodoStart = t.start === 'deferred' ? 'unscheduled' : t.start;
    let startDate: LocalDate | null = null;
    if (choice.kind === 'today') startDate = today();
    else if (choice.kind === 'date') startDate = choice.date;
    else if (choice.kind === 'deferred') start = 'deferred';
    else if (choice.kind === 'unscheduled') start = 'unscheduled';
    // Clearing returns an unfiled to-do to the Inbox for processing.
    else start = t.areaId || t.projectId ? 'unscheduled' : 'inbox';
    start = normalizeStart({ start, startDate, areaId: t.areaId, projectId: t.projectId });
    // A start date chosen by hand replaces where a release would return it (FR-17.5).
    const released: Partial<Todo> = t.releasedBy || t.releasedFrom ? { releasedBy: null, releasedFrom: null } : {};
    await patch<Todo>('todos', id, { start, startDate, ...released });
    await applyAutoRules(id);
  });
}

/**
 * The tasks Reset Other Tasks would return for `todo` (FR-17.6): its
 * sequential project's other open tasks in Today without a deadline. Empty
 * when `todo` isn't in Today or its project isn't sequential.
 */
export function tasksToReset(todo: Todo, s: { todos: Todo[]; headings: Heading[]; projects: Project[] }, settings: AppSettings): Todo[] {
  const ref = today();
  const project = todo.projectId ? s.projects.find((p) => p.id === todo.projectId) : undefined;
  if (!project || !sequentialRule(project, settings.sequentialTags) || !inToday(todo, ref)) return [];
  return othersToReset(todo, projectOrder(project.id, s.todos, s.headings), ref);
}

/** Reset Other Tasks (FR-17.6): return `ids` to where they were, keeping the chosen task in Today. */
export function resetOtherTasks(ids: ID[]): Promise<void> {
  return tx(async () => {
    for (const id of ids) {
      const t = await db.todos.get(id);
      if (t) await returnTask(t);
    }
  });
}

/** The When date that "Move When to the deadline" gives (FR-3.6): the deadline, or today once it has passed. */
function whenAtDeadline(deadline: LocalDate): LocalDate {
  const ref = today();
  return deadline < ref ? ref : deadline;
}

/**
 * Set or clear a deadline (FR-3.3). With `moveWhen`, the When date moves to
 * the deadline in the same step (FR-3.6).
 */
export function setDeadline(id: ID, deadline: LocalDate | null, moveWhen = false): Promise<void> {
  return tx(async () => {
    const when: Partial<Todo> = moveWhen && deadline ? { startDate: whenAtDeadline(deadline) } : {};
    await patch<Todo>('todos', id, { deadline, ...when });
    await applyAutoRules(id);
  });
}

/** Set or clear a project's deadline, moving its When date with `moveWhen` (FR-3.6). */
export function setProjectDeadline(id: ID, deadline: LocalDate | null, moveWhen = false): Promise<void> {
  const when: Partial<Project> = moveWhen && deadline ? { startDate: whenAtDeadline(deadline) } : {};
  return tx(() => patch<Project>('projects', id, { deadline, ...when }));
}

/** Complete, cancel or reopen a to-do (FR-1.3, FR-1.4, FR-12.1). */
export function setTodoStatus(id: ID, status: Todo['status']): Promise<void> {
  return tx(async () => {
    const settings = await loadSettings();
    const before = await db.todos.get(id);
    // Checking off a template completes (or cancels) its next copy early (FR-4.4); it isn't done itself.
    if (before?.repeat) {
      if (status === 'open') return;
      const copy = await nextCopyNow(before);
      if (copy) await closeCopy(copy, status, settings);
      return;
    }
    await patch<Todo>('todos', id, statusFields(status, nowIso(), settings));
    if (status !== 'open' && before?.status === 'open' && before.repeatOf) await copyDone(before.repeatOf);
    if (status === 'open') {
      // Unchecking takes back the task this one released (FR-17.5).
      const released = await db.todos.filter((t) => t.releasedBy === id && t.status === 'open').toArray();
      for (const t of released) await returnTask(t);
      // Closed to-dos keep their priority (FR-14.12); a reopened one is checked again.
      await applyAutoRules(id);
    } else if (before?.status === 'open' && before.projectId) {
      await release(before.projectId, id);
    }
  });
}

/** Move a to-do to Trash, or restore it (FR-1.5, FR-12.3). */
export function setTodoTrashed(id: ID, trashed: boolean): Promise<void> {
  return tx(async () => {
    await patch<Todo>('todos', id, { trashedAt: trashed ? nowIso() : null });
    // A repeat's copy in the Trash no longer holds its template back.
    if (trashed) await releaseWaitingTemplates(today());
  });
}

/** Duplicate a to-do just after the original (FR-1.5). */
export async function duplicateTodo(id: ID): Promise<ID | undefined> {
  return tx(async () => {
    const t = await db.todos.get(id);
    if (!t) return undefined;
    await ensureRoom();
    // Place the copy between the original and its next sibling.
    const keys = await siblingKeys<Todo>(
      'todos',
      (x) => x.projectId === t.projectId && x.areaId === t.areaId && x.sortKey > t.sortKey,
    );
    const next = keys.length ? keys.sort()[0] : null;
    const copy: Todo = {
      ...t,
      ...base(keyBetween(t.sortKey, next)),
      status: 'open',
      completedAt: null,
      loggedAt: null,
      trashedAt: null,
      releasedBy: null,
      releasedFrom: null,
      // Always an ordinary task (review C4): a repeating task's duplicate
      // would make every copy twice, and a copy's would claim its template.
      repeat: null,
      repeatOf: null,
      todaySortKey: null,
    };
    await db.todos.add(copy);
    await copyChecklist(id, copy.id);
    return copy.id;
  });
}

/** Move a to-do into a project, heading, area, or the Inbox (FR-1.5). */
export function moveTodo(id: ID, to: TodoPlacement): Promise<void> {
  return tx(async () => {
    const t = await db.todos.get(id);
    if (!t) return;
    const projectId = to.projectId ?? null;
    const areaId = projectId ? null : (to.areaId ?? null);
    const headingId = projectId ? (to.headingId ?? null) : null;
    const keys = await siblingKeys<Todo>('todos', (x) =>
      x.id !== id &&
      (projectId ? x.projectId === projectId : areaId ? x.areaId === areaId && !x.projectId : !x.projectId && !x.areaId),
    );
    // Moving to "Inbox" (no container) files an undated, active to-do back there.
    const toInbox = !projectId && !areaId && t.start !== 'deferred' && t.startDate === null;
    const start = toInbox ? 'inbox' : normalizeStart({ start: t.start, startDate: t.startDate, areaId, projectId });
    await patch<Todo>('todos', id, { projectId, areaId, headingId, start, sortKey: keyAtEnd(keys) });
  });
}

/**
 * Place a to-do at its position in `order`, the ids of its siblings in display
 * order after a drag or a keyboard move (FR-10.3, FR-10.6). Today orders by
 * `todaySortKey`; every other list by `sortKey`. Giving `headingId` also moves
 * the to-do under that heading (null: no heading).
 */
export function placeTodo(
  id: ID,
  opts: { order: ID[]; field?: 'sortKey' | 'todaySortKey'; headingId?: ID | null },
): Promise<void> {
  const field = opts.field ?? 'sortKey';
  const extra: Partial<Todo> = opts.headingId === undefined ? {} : { headingId: opts.headingId };
  const keyOf = (t: Todo) => (field === 'todaySortKey' ? (t.todaySortKey ?? t.sortKey) : t.sortKey);
  return tx(() => place<Todo>('todos', id, opts.order, field, keyOf, extra));
}

/** Turn a to-do into a project with the same title, notes and dates (FR-1.5). */
export function convertTodoToProject(id: ID): Promise<ID | undefined> {
  return tx(async () => {
    const t = await db.todos.get(id);
    // A repeating task isn't converted: its repeat would be lost (review C4; not on its menu either).
    if (!t || t.repeat) return undefined;
    // Its checklist items become tasks and the task itself goes: one fewer than the items.
    await ensureRoom((await liveChecklist(id)).length - 1);
    const areaId = t.projectId ? ((await db.projects.get(t.projectId))?.areaId ?? null) : t.areaId;
    const projectId = await insertProject({
      title: t.title,
      notes: t.notes,
      areaId,
      startDate: t.startDate,
      deadline: t.deadline,
      deferred: t.start === 'deferred',
      tagIds: t.tagIds,
    });
    // Checklist items become the new project's to-dos.
    const at = nowIso();
    let prev: string | null = null;
    for (const item of await liveChecklist(id)) {
      prev = keyBetween(prev, null);
      const todo: Todo = {
        ...t,
        ...base(prev),
        title: item.title,
        notes: '',
        status: item.completed ? 'completed' : 'open',
        completedAt: item.completed ? at : null,
        // Never shown as an open to-do, so it goes straight to Completed.
        loggedAt: item.completed ? at : null,
        start: 'unscheduled',
        startDate: null,
        deadline: null,
        todaySortKey: null,
        priority: null,
        prioritySource: null,
        priorityBeforeAuto: null,
        tagIds: [],
        areaId: null,
        projectId,
        headingId: null,
        trashedAt: null,
        releasedBy: null,
        releasedFrom: null,
        repeat: null,
        repeatOf: null,
      };
      await db.todos.add(todo);
      await bury('checklistItems', [item.id], at);
    }
    await bury('todos', [id], at);
    return projectId;
  });
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/** Options for a new project. */
interface NewProject {
  title?: string;
  notes?: string;
  areaId?: ID | null;
  startDate?: LocalDate | null;
  deadline?: LocalDate | null;
  deferred?: boolean;
  tagIds?: ID[];
  sortByDate?: boolean;
}

/** Insert a project; caller must already be inside a transaction. */
async function insertProject(opts: NewProject): Promise<ID> {
  const areaId = opts.areaId ?? null;
  const keys = await siblingKeys<Project>('projects', (p) => (p.areaId ?? null) === areaId);
  const project: Project = {
    ...base(keyAtEnd(keys)),
    title: opts.title ?? '',
    notes: opts.notes ?? '',
    status: 'open',
    start: opts.deferred ? 'deferred' : 'unscheduled',
    startDate: opts.deferred ? null : (opts.startDate ?? null),
    deadline: opts.deadline ?? null,
    tagIds: opts.tagIds ? [...opts.tagIds] : [],
    areaId,
    completedAt: null,
    loggedAt: null,
    trashedAt: null,
    sortByDate: opts.sortByDate ?? false,
    repeat: null,
    repeatOf: null,
  };
  await db.projects.add(project);
  return project.id;
}

/** Create a project (FR-2.1). */
export function createProject(opts: NewProject = {}): Promise<ID> {
  return tx(() => insertProject(opts));
}

/** Edit project fields. */
export function updateProject(
  id: ID,
  changes: Partial<Pick<Project, 'title' | 'notes' | 'deadline' | 'startDate' | 'start' | 'areaId'>>,
): Promise<void> {
  return tx(() => patch<Project>('projects', id, changes));
}

/**
 * Place a project at its position in `order` (its sibling projects in display
 * order) inside area `areaId`, or with no area when null. Moving it to another
 * area takes its headings and to-dos along (FR-10.8, FR-10.9).
 */
export function placeProject(id: ID, opts: { order: ID[]; areaId: ID | null }): Promise<void> {
  return tx(async () => {
    const p = await db.projects.get(id);
    const extra: Partial<Project> = p && (p.areaId ?? null) !== opts.areaId ? { areaId: opts.areaId } : {};
    await place<Project>('projects', id, opts.order, 'sortKey', (x) => x.sortKey, extra);
  });
}

/** Apply a When choice to a project (FR-2.1), using the same picker as to-dos. */
export function setProjectWhen(id: ID, choice: WhenChoice): Promise<void> {
  const changes: Pick<Project, 'start' | 'startDate'> =
    choice.kind === 'deferred'
      ? { start: 'deferred', startDate: null }
      : { start: 'unscheduled', startDate: choice.kind === 'today' ? today() : choice.kind === 'date' ? choice.date : null };
  return tx(() => patch<Project>('projects', id, changes));
}

/**
 * Complete or cancel a project (FR-2.3). Open to-dos inside are completed or
 * canceled according to `openTodos`.
 */
export function closeProject(id: ID, status: 'completed' | 'canceled', openTodos: 'completed' | 'canceled'): Promise<void> {
  return tx(async () => {
    const project = await db.projects.get(id);
    // Completing a repeating project's template closes its next copy early,
    // and the template moves on (FR-4.6); it isn't closed itself.
    if (project?.repeat) {
      const copy = await nextProjectCopyNow(project);
      if (copy) await closeProjectNow(copy.id, status, openTodos);
      return;
    }
    await closeProjectNow(id, status, openTodos);
  });
}

/** Close a project and its open tasks, inside the caller's transaction (closeProject). */
async function closeProjectNow(id: ID, status: 'completed' | 'canceled', openTodos: 'completed' | 'canceled'): Promise<void> {
  const at = nowIso();
  const settings = await loadSettings();
  const todos = await db.todos.where('projectId').equals(id).toArray();
  for (const t of todos.filter((x) => x.status === 'open' && x.deletedAt === null && x.trashedAt === null)) {
    await patch<Todo>('todos', t.id, { ...statusFields(openTodos, at, settings), ...(await endRepeat(t)) });
  }
  await patch<Project>('projects', id, statusFields(status, at, settings));
  const project = await db.projects.get(id);
  if (project?.repeatOf) await projectCopyDone(project.repeatOf);
}

/**
 * A repeating task closed with its project or heading stops repeating (review
 * C4, Michael's choice): it goes to Completed as an ordinary task, as when a
 * repeat reaches its end (FR-4.2), rather than staying paused where no one
 * sees it; its copies become ordinary tasks, as Stop… makes them. The dialogs
 * say so first. Returns the fields to write on the task with its new status.
 */
async function endRepeat(t: Todo): Promise<Partial<Todo>> {
  if (!t.repeat) return {};
  for (const c of await db.todos.filter((x) => x.repeatOf === t.id && x.deletedAt === null).toArray()) {
    await patch<Todo>('todos', c.id, { repeatOf: null });
  }
  return { repeat: null, startDate: null };
}

/**
 * Duplicate a project with its headings, open to-dos and their checklists.
 * The copy is placed right after the original. Returns the new project's id.
 */
export function duplicateProject(id: ID): Promise<ID | undefined> {
  return tx(async () => {
    const p = await db.projects.get(id);
    if (!p) return undefined;
    const todos = (await db.todos.where('projectId').equals(id).toArray()).filter(
      (t) => t.deletedAt === null && t.trashedAt === null && t.status === 'open',
    );
    await ensureRoom(todos.length);
    const siblings = bySortKey(
      (await db.projects.toArray()).filter((x) => x.deletedAt === null && (x.areaId ?? null) === (p.areaId ?? null)),
    );
    const next = siblings[siblings.findIndex((x) => x.id === id) + 1];
    const copy: Project = {
      ...p,
      ...base(keyBetween(p.sortKey, next?.sortKey ?? null)),
      tagIds: [...p.tagIds],
      status: 'open',
      completedAt: null,
      loggedAt: null,
      trashedAt: null,
      // Always an ordinary project: duplicating a repeating one's template or copy doesn't repeat it (FR-4.6).
      repeat: null,
      repeatOf: null,
    };
    await db.projects.add(copy);

    const headingIds = new Map<ID, ID>();
    for (const h of (await db.headings.where('projectId').equals(id).toArray()).filter((x) => x.deletedAt === null)) {
      const hc: Heading = { ...h, ...base(h.sortKey), projectId: copy.id };
      headingIds.set(h.id, hc.id);
      await db.headings.add(hc);
    }

    for (const t of todos) {
      const tc: Todo = {
        ...t,
        ...base(t.sortKey),
        tagIds: [...t.tagIds],
        projectId: copy.id,
        headingId: t.headingId ? (headingIds.get(t.headingId) ?? null) : null,
        todaySortKey: null,
      };
      await db.todos.add(tc);
      await copyChecklist(t.id, tc.id);
    }
    return copy.id;
  });
}

/** Reopen a closed project. */
export function reopenProject(id: ID): Promise<void> {
  return tx(() => patch<Project>('projects', id, { status: 'open', completedAt: null, loggedAt: null }));
}

/** Move a project (and its to-dos) to Trash, or restore it. */
export function setProjectTrashed(id: ID, trashed: boolean): Promise<void> {
  return tx(async () => {
    await patch<Project>('projects', id, { trashedAt: trashed ? nowIso() : null });
    // A repeat's copy in the Trash, or in a trashed project, no longer holds its template back.
    if (trashed) await releaseWaitingTemplates(today());
  });
}

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

/** Add a heading at the end of a project (FR-2.4). */
export function createHeading(projectId: ID, title = ''): Promise<ID> {
  return tx(async () => {
    const keys = await siblingKeys<Heading>('headings', (h) => h.projectId === projectId);
    const heading: Heading = { ...base(keyAtEnd(keys)), title, projectId, archived: false, collapsed: false, sortByDate: false };
    await db.headings.add(heading);
    return heading.id;
  });
}

export function renameHeading(id: ID, title: string): Promise<void> {
  return tx(() => patch<Heading>('headings', id, { title }));
}

/**
 * Collapse or expand a heading on its project page (FR-2.7). It syncs like
 * any change, but isn't an undo step: it changes the view, not the tasks.
 */
export function setHeadingCollapsed(id: ID, collapsed: boolean): Promise<void> {
  return tx(() => patch<Heading>('headings', id, { collapsed }), { track: false });
}

/** List a heading's tasks by start date, or in manual order (FR-2.8). Syncs; not an undo step. */
export function setHeadingSortByDate(id: ID, sortByDate: boolean): Promise<void> {
  return tx(() => patch<Heading>('headings', id, { sortByDate }), { track: false });
}

/** List a project's tasks under no heading by start date, or in manual order (FR-2.8). Syncs; not an undo step. */
export function setProjectSortByDate(id: ID, sortByDate: boolean): Promise<void> {
  return tx(() => patch<Project>('projects', id, { sortByDate }), { track: false });
}

/** Place a heading at its position in `order`; its to-dos move with it (FR-10.7). */
export function placeHeading(id: ID, order: ID[]): Promise<void> {
  return tx(() => place<Heading>('headings', id, order, 'sortKey', (h) => h.sortKey));
}

/**
 * Archive a heading; its to-dos are completed with it, and go
 * straight to Completed, since the heading they would wait under is hidden.
 */
export function archiveHeading(id: ID): Promise<void> {
  return tx(async () => {
    const at = nowIso();
    const todos = await db.todos.where('headingId').equals(id).toArray();
    for (const t of todos.filter((x) => x.status === 'open')) {
      await patch<Todo>('todos', t.id, { status: 'completed', completedAt: at, loggedAt: at, ...(await endRepeat(t)) });
    }
    await patch<Heading>('headings', id, { archived: true });
  });
}

/** Delete a heading; its to-dos stay in the project without a heading. */
export function deleteHeading(id: ID): Promise<void> {
  return tx(async () => {
    const todos = await db.todos.where('headingId').equals(id).toArray();
    for (const t of todos) await patch<Todo>('todos', t.id, { headingId: null });
    await bury('headings', [id], nowIso());
  });
}

/** Turn a heading into a new project holding its to-dos (FR-2.4). */
export function convertHeadingToProject(id: ID): Promise<ID | undefined> {
  return tx(async () => {
    const h = await db.headings.get(id);
    if (!h) return undefined;
    const parent = await db.projects.get(h.projectId);
    const projectId = await insertProject({ title: h.title, areaId: parent?.areaId ?? null, sortByDate: h.sortByDate });
    const todos = await db.todos.where('headingId').equals(id).toArray();
    for (const t of todos) await patch<Todo>('todos', t.id, { projectId, headingId: null });
    await bury('headings', [id], nowIso());
    return projectId;
  });
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

/** Create an area at the end of the sidebar (FR-2.5). */
export function createArea(title = ''): Promise<ID> {
  return tx(async () => {
    const keys = await siblingKeys<Area>('areas', () => true);
    const area: Area = { ...base(keyAtEnd(keys)), title, tagIds: [], collapsed: false };
    await db.areas.add(area);
    return area.id;
  });
}

export function renameArea(id: ID, title: string): Promise<void> {
  return tx(() => patch<Area>('areas', id, { title }));
}

/** Collapse or expand an area in the sidebar (FR-2.7); synced, not an undo step. */
export function setAreaCollapsed(id: ID, collapsed: boolean): Promise<void> {
  return tx(() => patch<Area>('areas', id, { collapsed }), { track: false });
}

/** Place an area at its position in the sidebar `order` (FR-10.8). */
export function placeArea(id: ID, order: ID[]): Promise<void> {
  return tx(() => place<Area>('areas', id, order, 'sortKey', (a) => a.sortKey));
}

/**
 * Delete an area (FR-2.5). `contents` decides what happens to its projects
 * and to-dos: `keep` moves them out of the area, `trash` moves them to Trash.
 */
export function deleteArea(id: ID, contents: 'keep' | 'trash'): Promise<void> {
  return tx(async () => {
    const at = nowIso();
    const projects = await db.projects.where('areaId').equals(id).toArray();
    const todos = await db.todos.where('areaId').equals(id).toArray();
    for (const p of projects) {
      await patch<Project>('projects', p.id, contents === 'trash' ? { trashedAt: at, areaId: null } : { areaId: null });
    }
    for (const t of todos) {
      const start = normalizeStart({ start: t.start, startDate: t.startDate, areaId: null, projectId: t.projectId });
      await patch<Todo>('todos', t.id, contents === 'trash' ? { trashedAt: at, areaId: null } : { areaId: null, start });
    }
    await bury('areas', [id], at);
    if (contents === 'trash') await releaseWaitingTemplates(today());
  });
}

// ---------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------

/**
 * Permanently delete everything in Trash (FR-12.3), with the headings of
 * emptied projects. Only tombstones stay, for sync (model/tombstone.ts).
 * It cannot be undone: the change is not tracked and the undo
 * step is cleared, so undoing an earlier change (such as a move to Trash)
 * cannot bring the items back either.
 */
export async function emptyTrash(): Promise<void> {
  await tx(
    async () => {
      // Read everything first, then write with bulk calls. Awaiting the
      // nested per-record helpers in a loop here made Dexie commit the
      // transaction too early (PrematureCommitError) with several items.
      const at = nowIso();
      const projects = (await db.projects.toArray()).filter((p) => p.trashedAt && !p.deletedAt);
      const inTrashedProject = new Set(projects.map((p) => p.id));
      const todos = (await db.todos.toArray()).filter(
        (t) => !t.deletedAt && (t.trashedAt || (t.projectId && inTrashedProject.has(t.projectId))),
      );
      const todoIds = new Set(todos.map((t) => t.id));
      const items = (await db.checklistItems.toArray()).filter((c) => !c.deletedAt && todoIds.has(c.todoId));
      const headings = (await db.headings.toArray()).filter((h) => !h.deletedAt && inTrashedProject.has(h.projectId));
      const ids = (rows: { id: ID }[]) => rows.map((r) => r.id);
      await bury('projects', ids(projects), at);
      await bury('headings', ids(headings), at);
      await bury('todos', ids(todos), at);
      await bury('checklistItems', ids(items), at);
    },
    { track: false },
  );
  clearUndo();
}

/** Mark a to-do and its checklist deleted (tombstones, so the deletion syncs). Call inside a transaction. */
async function deleteTodoRecords(todoId: ID, at: string): Promise<void> {
  await bury('todos', [todoId], at);
  await bury('checklistItems', (await liveChecklist(todoId)).map((c) => c.id), at);
}

/**
 * Delete one to-do in the Trash permanently (Delete Immediately, FR-1.7).
 * It asks first and cannot be undone: the undo step is cleared too, so
 * undoing an earlier change (such as the move to Trash) cannot restore it.
 */
export async function deleteTodoForever(id: ID): Promise<void> {
  await tx(() => deleteTodoRecords(id, nowIso()), { track: false });
  clearUndo();
}

// ---------------------------------------------------------------------------
// Tags (FR-6.1, FR-6.2)
// ---------------------------------------------------------------------------

/** Create a tag at the end of the Manage Tags list. */
export function createTag(title: string): Promise<ID> {
  return tx(async () => {
    const keys = await siblingKeys<Tag>('tags', () => true);
    const tag: Tag = { ...base(keyAtEnd(keys)), title: title.trim(), shortcut: null, parentTagId: null };
    await db.tags.add(tag);
    return tag.id;
  });
}

export function renameTag(id: ID, title: string): Promise<void> {
  return tx(() => patch<Tag>('tags', id, { title: title.trim() }));
}

/** Live tags, read inside the caller's transaction. A read helper: see `liveChecklist`. */
async function liveTags(): Promise<Tag[]> {
  return (await db.tags.toArray()).filter((t) => t.deletedAt === null);
}

/** Move a tag one place up or down among the tags at its level (same parent) in Manage Tags. */
export function moveTag(id: ID, direction: 'up' | 'down'): Promise<void> {
  return tx(async () => {
    const tag = await db.tags.get(id);
    if (!tag) return;
    const key = await shiftedKey<Tag>('tags', id, (t) => t.parentTagId === tag.parentTagId, direction);
    if (key) await patch<Tag>('tags', id, { sortKey: key });
  });
}

/**
 * Nest a tag under another, at the end of its tags, or move it back to the
 * top level with `parentId` null (FR-6.1b). The tags nested under it come
 * along. Refused (false) when `parentId` is the tag itself or nested under it.
 */
export function nestTag(id: ID, parentId: ID | null): Promise<boolean> {
  return tx(async () => {
    const tags = await liveTags();
    const tag = tags.find((t) => t.id === id);
    if (!tag || (parentId !== null && (!tags.some((t) => t.id === parentId) || descendantIds(id, tags).has(parentId)))) return false;
    if (tag.parentTagId === parentId) return true;
    const keys = tags.filter((t) => t.parentTagId === parentId).map((t) => t.sortKey);
    await patch<Tag>('tags', id, { parentTagId: parentId, sortKey: keyAtEnd(keys) });
    return true;
  });
}

/**
 * Give a tag a one-key shortcut (FR-6.4): a letter A–Z or digit 0–9, or null
 * to clear it. Returns the tag already using the key, without changing
 * anything, or null once set.
 */
export function setTagShortcut(id: ID, key: string | null): Promise<Tag | null> {
  return tx(async () => {
    const shortcut = key === null ? null : key.toUpperCase();
    if (shortcut !== null && !/^[A-Z0-9]$/.test(shortcut)) throw new Error(`Not a tag shortcut: ${key}`);
    const taken = shortcut === null ? undefined : (await liveTags()).find((t) => t.shortcut === shortcut && t.id !== id);
    if (taken) return taken;
    await patch<Tag>('tags', id, { shortcut });
    return null;
  });
}

/**
 * Delete a tag, and the tags nested under it (FR-6.1b), removing them from
 * every to-do, project, area and saved search.
 */
export function deleteTag(id: ID): Promise<void> {
  return tx(async () => {
    const family = descendantIds(id, await liveTags());
    for (const entity of ['todos', 'projects', 'areas', 'savedSearches'] as const) {
      const rows = (await db.table(entity).toArray()) as (Todo | Project | Area | SavedSearch)[];
      // Deleted records keep no tagIds (model/tombstone.ts).
      for (const r of rows.filter((x) => !x.deletedAt && x.tagIds.some((t) => family.has(t)))) {
        await patch<Todo | Project | Area | SavedSearch>(entity, r.id, { tagIds: r.tagIds.filter((t) => !family.has(t)) });
      }
    }
    await bury('tags', [...family], nowIso());
  });
}

/**
 * Add or remove one tag on a to-do, project or area. Reads the record inside
 * the transaction, so quick successive changes never overwrite each other.
 */
export function toggleTag(entity: 'todos' | 'projects' | 'areas', id: ID, tagId: ID, on: boolean): Promise<void> {
  return tx(async () => {
    const r = (await db.table(entity).get(id)) as Todo | Project | Area | undefined;
    if (!r || r.tagIds.includes(tagId) === on) return;
    const tagIds = on ? [...r.tagIds, tagId] : r.tagIds.filter((t) => t !== tagId);
    await patch<Todo | Project | Area>(entity, id, { tagIds });
    // A project given a listed tag becomes sequential (FR-17.2).
    if (entity === 'projects' && on) await release(id, null);
  });
}

// ---------------------------------------------------------------------------
// Contexts (FR-18.2)
// ---------------------------------------------------------------------------

/** Create a context at the end of the Settings list. */
export function createContext(title: string): Promise<ID> {
  return tx(async () => {
    const keys = await siblingKeys<Context>('contexts', () => true);
    const context: Context = { ...base(keyAtEnd(keys)), title: title.trim() };
    await db.contexts.add(context);
    return context.id;
  });
}

export function renameContext(id: ID, title: string): Promise<void> {
  return tx(() => patch<Context>('contexts', id, { title: title.trim() }));
}

/** Move a context one place up or down in Settings. */
export function moveContext(id: ID, direction: 'up' | 'down'): Promise<void> {
  return tx(async () => {
    const key = await shiftedKey<Context>('contexts', id, () => true, direction);
    if (key) await patch<Context>('contexts', id, { sortKey: key });
  });
}

/** Delete a context and clear it from every to-do and saved search; one undo step. */
export function deleteContext(id: ID): Promise<void> {
  return tx(async () => {
    for (const entity of ['todos', 'savedSearches'] as const) {
      const rows = (await db.table(entity).filter((r: Todo | SavedSearch) => r.contextId === id).toArray()) as (
        | Todo
        | SavedSearch
      )[];
      for (const r of rows) await patch<Todo | SavedSearch>(entity, r.id, { contextId: null });
    }
    await bury('contexts', [id], nowIso());
  });
}

// ---------------------------------------------------------------------------
// Checklists (FR-7.1, FR-7.2)
// ---------------------------------------------------------------------------

/** Copy a to-do's checklist onto another to-do; caller is inside a transaction. */
async function copyChecklist(fromTodoId: ID, toTodoId: ID): Promise<void> {
  for (const item of await liveChecklist(fromTodoId)) {
    const c: ChecklistItem = { ...item, ...base(item.sortKey), todoId: toTodoId };
    await db.checklistItems.add(c);
  }
}

/**
 * A to-do's live checklist items in order.
 *
 * Read helpers like this one return Dexie's own promise (`then`) instead of
 * being `async`. Inside a transaction, a read awaited through two levels of
 * `async` helpers more than once (here: `copyChecklist` in a loop) makes Dexie
 * commit the transaction too early (PrematureCommitError).
 */
function liveChecklist(todoId: ID): Promise<ChecklistItem[]> {
  return db.checklistItems
    .where('todoId')
    .equals(todoId)
    .toArray()
    .then((rows) => bySortKey(rows.filter((c) => c.deletedAt === null)));
}

/**
 * Add checklist items after `afterId` (or at the end when null), in order.
 * Returns the new ids. Several titles come from a multi-line paste (FR-7.2).
 */
export function addChecklistItems(todoId: ID, titles: string[], afterId: ID | null = null): Promise<ID[]> {
  return tx(async () => {
    const items = await liveChecklist(todoId);
    const i = afterId ? items.findIndex((c) => c.id === afterId) : items.length - 1;
    let before = i >= 0 ? items[i].sortKey : null;
    const after = items[i + 1]?.sortKey ?? null;
    const ids: ID[] = [];
    for (const title of titles) {
      before = keyBetween(before, after);
      const item: ChecklistItem = { ...base(before), todoId, title, completed: false };
      await db.checklistItems.add(item);
      ids.push(item.id);
    }
    return ids;
  });
}

export function updateChecklistItem(id: ID, changes: Partial<Pick<ChecklistItem, 'title' | 'completed'>>): Promise<void> {
  return tx(() => patch<ChecklistItem>('checklistItems', id, changes));
}

export function deleteChecklistItem(id: ID): Promise<void> {
  return tx(() => bury('checklistItems', [id], nowIso()).then(() => undefined));
}

/** Move a checklist item one place up or down. */
export function moveChecklistItem(id: ID, direction: 'up' | 'down'): Promise<void> {
  return tx(async () => {
    const item = await db.checklistItems.get(id);
    if (!item) return;
    const key = await shiftedKey<ChecklistItem>('checklistItems', id, (c) => c.todoId === item.todoId, direction);
    if (key) await patch<ChecklistItem>('checklistItems', id, { sortKey: key });
  });
}

/** Put a checklist item where `order` (its to-do's item ids, in stored order) says, as dragged (FR-7.1). */
export function placeChecklistItem(id: ID, order: ID[]): Promise<void> {
  return tx(() => place<ChecklistItem>('checklistItems', id, order, 'sortKey', (c) => c.sortKey));
}

// ---------------------------------------------------------------------------
// Saved searches (FR-15)
// ---------------------------------------------------------------------------

/** The editable fields of a saved search. */
export type SavedSearchFields = Pick<SavedSearch, 'title' | 'query' | 'tagIds'> & { contextId?: ID | null };

/** Save a search at the end of the sidebar section and return its id (FR-15.1). */
export function createSavedSearch(fields: SavedSearchFields): Promise<ID> {
  return tx(async () => {
    const keys = await siblingKeys<SavedSearch>('savedSearches', () => true);
    const saved: SavedSearch = {
      ...base(keyAtEnd(keys)),
      title: fields.title.trim(),
      query: fields.query.trim(),
      tagIds: [...fields.tagIds],
      contextId: fields.contextId ?? null,
    };
    await db.savedSearches.add(saved);
    return saved.id;
  });
}

/** Rename a saved search or change its search text or tags (FR-15.5). */
export function updateSavedSearch(id: ID, fields: Partial<SavedSearchFields>): Promise<void> {
  const changes: Partial<SavedSearch> = { ...fields };
  if (fields.title !== undefined) changes.title = fields.title.trim();
  if (fields.query !== undefined) changes.query = fields.query.trim();
  // A plain copy: IndexedDB cannot store reactive proxies.
  if (fields.tagIds !== undefined) changes.tagIds = [...fields.tagIds];
  return tx(() => patch<SavedSearch>('savedSearches', id, changes));
}

/** Place a saved search at its position in the sidebar `order` (FR-15.5). */
export function placeSavedSearch(id: ID, order: ID[]): Promise<void> {
  return tx(() => place<SavedSearch>('savedSearches', id, order, 'sortKey', (x) => x.sortKey));
}

/** Delete a saved search. To-dos are never affected (FR-15.5). */
export function deleteSavedSearch(id: ID): Promise<void> {
  return tx(() => bury('savedSearches', [id], nowIso()).then(() => undefined));
}

// ---------------------------------------------------------------------------
// Import (FR-12.6)
// ---------------------------------------------------------------------------

/** What the device holds now, for import's matching: live records. A read helper: see `liveChecklist`. */
export async function importExisting(): Promise<Existing> {
  const live = <T extends BaseRecord>(rows: T[]) => rows.filter((r) => r.deletedAt === null);
  return {
    areas: live(await db.areas.toArray()),
    projects: live(await db.projects.toArray()),
    headings: live(await db.headings.toArray()),
    todos: live(await db.todos.toArray()),
    checklistItems: live(await db.checklistItems.toArray()),
    tags: live(await db.tags.toArray()),
    contexts: live(await db.contexts.toArray()),
  };
}

/**
 * Import checked rows (FR-12.6): build the plan against what the device
 * holds now and add it all in one transaction, one undo step. Refused with
 * TaskLimitError, changing nothing, past the task limit (NFR-7). Repeating
 * tasks and projects make a copy that has come due; the automatic rules (a
 * reached deadline, the priority rules) run on the rest, as for a new task.
 */
export function importRows(rows: ImportRow[]): Promise<ImportPlan> {
  return tx(async () => {
    const ref = today();
    const plan = buildPlan(rows, await importExisting(), ref, nowIso(), uuidv7);
    const a = plan.add;
    await ensureRoom(a.todos.length);
    await db.areas.bulkAdd(a.areas);
    await db.tags.bulkAdd(a.tags);
    await db.contexts.bulkAdd(a.contexts);
    await db.projects.bulkAdd(a.projects);
    await db.headings.bulkAdd(a.headings);
    await db.todos.bulkAdd(a.todos);
    await db.checklistItems.bulkAdd(a.checklistItems);
    for (const p of plan.tagPatches) await patch<Area | Project>(p.entity, p.id, { tagIds: p.tagIds });
    const settings = await loadSettings();
    const projects = new Map(a.projects.map((p) => [p.id, p]));
    for (const t of a.todos) {
      if (t.status !== 'open') continue;
      if (t.repeat) {
        await makeDueCopy(t, ref);
        continue;
      }
      const project = t.projectId ? (projects.get(t.projectId) ?? (await db.projects.get(t.projectId))) : undefined;
      if (project?.repeat) continue; // a template's tasks take no automatic rules; its copies' do (FR-4.6)
      const changes = autoChanges(t, ref, settings, project);
      if (changes) await patch<Todo>('todos', t.id, changes);
    }
    // A repeating project whose first copy is due gets it now, with its tasks (FR-4.6).
    for (const p of a.projects) if (p.repeat) await makeDueProjectCopy(p, ref);
    return plan;
  });
}

// ---------------------------------------------------------------------------
// Archive (FR-12.11)
// ---------------------------------------------------------------------------

/**
 * Remove archived items for good, after their file was saved: tombstones,
 * so the removal syncs, as Empty Trash. Final: not an undo step, and it
 * clears undo and redo, so nothing undoes them back after they're in the
 * file. An item changed since it was selected (reopened on another device,
 * say) is left alone. Returns how many tasks were removed.
 */
export async function archiveItems(sel: ArchiveSelection): Promise<number> {
  let removed = 0;
  await tx(
    async () => {
      const at = nowIso();
      const still = async (entity: EntityName, rows: BaseRecord[]): Promise<ID[]> => {
        const now = await db.table(entity).bulkGet(rows.map((r) => r.id));
        return rows.filter((r, i) => now[i] && !now[i].deletedAt && now[i].modifiedAt === r.modifiedAt).map((r) => r.id);
      };
      const todos = await still('todos', sel.todos);
      removed = todos.length;
      await bury('projects', await still('projects', sel.projects), at);
      await bury('headings', await still('headings', sel.headings), at);
      await bury('todos', todos, at);
      await bury('checklistItems', await still('checklistItems', sel.checklistItems), at);
    },
    { track: false },
  );
  clearUndo();
  return removed;
}

// ---------------------------------------------------------------------------
// Settings › Sync's overview (v1.4.3)
// ---------------------------------------------------------------------------

/** Tasks and projects by state, tombstones included: this device's copy of the gist. A read helper. */
export async function gistCounts(): Promise<{ tasks: StateCounts; projects: StateCounts }> {
  return { tasks: stateCounts(await db.todos.toArray()), projects: stateCounts(await db.projects.toArray()) };
}
