/**
 * A to-do being written in Quick Entry (FR-8.1). Nothing is stored until it
 * is saved; then `toNewTodo` hands every field to `repo.createTodo`, which
 * writes the to-do and its checklist in one transaction.
 */
import type { NewTodo, TodoPlacement, WhenChoice } from '../db/repo';
import type { ID, LocalDate, Priority, TodoStart } from '../model/types';
import { DraftChecklist } from './checklist.svelte';

/** Where and when a new draft starts, from the view it was opened in. */
export interface DraftStart {
  placement?: TodoPlacement;
  /** For a draft with no container and no date: Inbox or Unscheduled. */
  start?: TodoStart;
  startDate?: LocalDate | null;
  deferred?: boolean;
}

export class TodoDraft {
  title = $state('');
  notes = $state('');
  placement = $state<TodoPlacement>({});
  start = $state<TodoStart>('inbox');
  startDate = $state<LocalDate | null>(null);
  deferred = $state(false);
  deadline = $state<LocalDate | null>(null);
  /** The user's priority choice; `undefined` until they choose (None is `null`). */
  priority = $state<Priority | null | undefined>(undefined);
  tagIds = $state<ID[]>([]);
  checklist = new DraftChecklist();

  constructor(init: DraftStart = {}) {
    this.placement = init.placement ?? {};
    this.start = init.start ?? 'inbox';
    this.startDate = init.startDate ?? null;
    this.deferred = init.deferred ?? false;
  }

  /** Apply a When picker choice (FR-3.1). `ref` is today's date. */
  setWhen(choice: WhenChoice, ref: LocalDate): void {
    this.deferred = choice.kind === 'deferred';
    this.startDate = choice.kind === 'today' ? ref : choice.kind === 'date' ? choice.date : null;
  }

  toggleTag(tagId: ID, on: boolean): void {
    this.tagIds = on ? [...this.tagIds.filter((t) => t !== tagId), tagId] : this.tagIds.filter((t) => t !== tagId);
  }

  /** Everything `repo.createTodo` needs to store this draft. */
  toNewTodo(): NewTodo {
    return {
      ...this.placement,
      title: this.title.trim(),
      notes: this.notes,
      start: this.start,
      startDate: this.startDate,
      deferred: this.deferred,
      deadline: this.deadline,
      tagIds: [...this.tagIds],
      checklist: this.checklist.toSave(),
      ...(this.priority === undefined ? {} : { priority: this.priority }),
    };
  }
}
