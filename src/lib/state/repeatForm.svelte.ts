/**
 * The Repeat form (FR-4.1, FR-4.2; Edit Rule… FR-4.4; projects FR-4.6),
 * shared by the desktop dialog (RepeatDialog.svelte) and the phone sheet
 * (RepeatSheet.svelte): the fields, the rule they describe, the Next
 * choices, and saving. It starts from the task's or project's rule, or from
 * the default, 1 week after completion.
 */
import * as repo from '../db/repo';
import { formatWeekdayDate, parseLocalDate, weekday } from '../model/dates';
import { firstDate, upcoming } from '../model/repeat';
import type { LocalDate, Project, RepeatDay, RepeatRule, RepeatUnit, Todo } from '../model/types';
import type { Snapshot } from '../model/lists';
import type { RepeatTarget } from './ui.svelte';

/** The kinds of repeat, as the Repeat pop-up lists them. */
export type RepeatKind = 'afterCompletion' | RepeatUnit;

export const KINDS: { value: RepeatKind; label: string }[] = [
  { value: 'afterCompletion', label: 'after completion' },
  { value: 'day', label: 'daily' },
  { value: 'week', label: 'weekly' },
  { value: 'month', label: 'monthly' },
  { value: 'year', label: 'yearly' },
];

export const UNITS: RepeatUnit[] = ['day', 'week', 'month', 'year'];

/** How many dates Next offers. */
const NEXT_CHOICES = 12;

export class RepeatForm {
  readonly target: RepeatTarget;
  /** The task or project the rule is for. */
  readonly item: Todo | Project;
  readonly ref: LocalDate;
  private readonly existing: RepeatRule | null;

  kind = $state<RepeatKind>('afterCompletion');
  interval = $state(1);
  /** After completion: the unit. */
  unit = $state<RepeatUnit>('week');
  weekdays = $state<number[]>([]);
  days = $state<RepeatDay[]>([]);
  month = $state(1);
  ends = $state<'never' | 'after' | 'date'>('never');
  endCount = $state(1);
  endDate = $state<LocalDate>('');
  deadlines = $state(false);
  deadlineDays = $state(0);
  /** The Next date chosen, or null for the schedule's first. */
  next = $state<LocalDate | null>(null);

  constructor(target: RepeatTarget, s: Pick<Snapshot, 'todos' | 'projects'>, ref: LocalDate) {
    const records: (Todo | Project)[] = target.kind === 'todo' ? s.todos : s.projects;
    const item = records.find((x) => x.id === target.id)!;
    this.target = target;
    this.item = item;
    this.ref = ref;
    const r = (this.existing = item.repeat);
    const refDate = parseLocalDate(ref);
    this.kind = r ? (r.mode === 'afterCompletion' ? 'afterCompletion' : r.unit) : 'afterCompletion';
    this.interval = r?.interval ?? 1;
    this.unit = r?.mode === 'afterCompletion' ? r.unit : 'week';
    this.weekdays = r?.weekdays.length ? [...r.weekdays] : [weekday(ref)];
    this.days = r?.days.length ? r.days.map((d) => ({ ...d })) : [{ ordinal: refDate.getDate(), weekday: null }];
    this.month = r?.month ?? refDate.getMonth() + 1;
    this.ends = r?.endCount ? 'after' : r?.endDate ? 'date' : 'never';
    this.endCount = r?.endCount ?? 1;
    this.endDate = r?.endDate ?? ref;
    this.deadlines = r?.deadlineDays != null;
    this.deadlineDays = r?.deadlineDays ?? 0;
    this.next = r ? item.startDate : null;
  }

  /** The rule the form describes now. */
  rule = $derived.by<RepeatRule>(() => {
    const fixed = this.kind !== 'afterCompletion';
    return {
      mode: fixed ? 'fixed' : 'afterCompletion',
      unit: fixed ? (this.kind as RepeatUnit) : this.unit,
      interval: Math.max(1, Math.floor(this.interval) || 1),
      weekdays: this.kind === 'week' ? [...new Set(this.weekdays)].sort() : [],
      // Plain copies: the form's reactive days can't be stored in the database (DataCloneError).
      days: this.kind === 'month' || this.kind === 'year' ? this.days.map((d) => ({ ordinal: d.ordinal, weekday: d.weekday })) : [],
      month: this.kind === 'year' ? this.month : null,
      endCount: fixed && this.ends === 'after' ? Math.max(1, Math.floor(this.endCount) || 1) : null,
      endDate: fixed && this.ends === 'date' ? this.endDate : null,
      made: 0,
      deadlineDays: this.deadlines ? Math.max(0, Math.floor(this.deadlineDays) || 0) : null,
      paused: this.existing?.paused ?? false,
    };
  });

  /** Dates Next offers, from the schedule's first date on or after today. */
  choices = $derived.by(() =>
    this.rule.mode === 'fixed' ? upcoming(this.rule, firstDate(this.rule, this.ref), NEXT_CHOICES) : [],
  );
  /** Next: the date chosen, while the schedule still has it, else its first. */
  nextDate = $derived(this.next && this.choices.includes(this.next) ? this.next : (this.choices[0] ?? null));
  /** The few dates after Next. */
  preview = $derived.by(() => {
    const i = this.choices.indexOf(this.nextDate ?? '');
    return this.choices.slice(i + 1, i + 5);
  });
  /** A fixed schedule needs a Next date before it can be saved. */
  canSave = $derived(this.rule.mode === 'afterCompletion' || this.nextDate !== null);

  /** Another kind of repeat starts again from its first date and never ends. */
  chooseKind(k: RepeatKind): void {
    this.kind = k;
    this.next = null;
    this.ends = 'never';
  }

  /** "Today", or "Wed, Nov 18". */
  dateLabel(d: LocalDate): string {
    return d === this.ref ? 'Today' : formatWeekdayDate(d);
  }

  /** A row's + adds another day after it; − removes it (at least one stays). */
  addWeekday(i: number): void {
    this.weekdays.splice(i + 1, 0, (this.weekdays[i] + 1) % 7);
  }
  addDay(i: number): void {
    this.days.splice(i + 1, 0, { ...this.days[i] });
  }

  /**
   * Save: the task or project becomes the template (repo.setRepeat,
   * repo.setProjectRepeat), one undo step. After completion starts now;
   * editing one that waits keeps its date.
   */
  save(): void {
    if (!this.canSave) return;
    const start =
      this.rule.mode === 'afterCompletion'
        ? this.existing?.mode === 'afterCompletion'
          ? this.item.startDate
          : this.ref
        : this.nextDate;
    if (this.target.kind === 'project') void repo.setProjectRepeat(this.item.id, this.rule, start);
    else void repo.setRepeat(this.item.id, this.rule, start);
  }
}
