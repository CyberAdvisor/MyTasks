<!--
  Quick Entry (FR-8.1): a floating card for writing a new to-do with every
  field: title, notes, checklist, then the fields bar shared with the card
  (FieldBar: tags, When, deadline, reminder while reminders are on, priority,
  context), led by where it goes
  (the Inbox unless opened from another view, FR-10.5).
  Nothing is stored until Save (Return in the title or on a field's button,
  or Cmd/Ctrl+Enter); Cancel or Escape discards the draft.
  With Settings › Task Titles on, the words the title will set are
  highlighted as you type, with what they set underneath (FR-1.12).
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { cycleTab } from '../lib/focusCycle';
  import Popover from './Popover.svelte';
  import FieldBar from './FieldBar.svelte';
  import Checklist from './Checklist.svelte';
  import DestinationList from './DestinationList.svelte';
  import TitleHighlights from './TitleHighlights.svelte';
  import TitleHint from './TitleHint.svelte';
  import { previewDraftTitle, readTitles } from '../lib/titleEntry';
  import { shiftKept, type TitleSpan } from '../lib/model/titleWords';
  import { ui } from '../lib/state/ui.svelte';
  import { snapshot, todayDate } from '../lib/state/live';
  import { saveDraft } from '../lib/actions';
  import { remindersOn } from '../lib/calendar/calendar';
  import { newTaskReminder } from '../lib/model/reminder';
  import type { TodoDraft } from '../lib/state/draft.svelte';
  import type { TodoPlacement } from '../lib/db/repo';
  import type { ID, LocalDate } from '../lib/model/types';

  let { draft }: { draft: TodoDraft } = $props();

  let dialog: HTMLDialogElement;

  // Tab moves through every control, in Safari too, and stays inside.
  $effect(() => {
    const onTab = (e: KeyboardEvent) => cycleTab(e, dialog);
    dialog.addEventListener('keydown', onTab);
    return () => dialog.removeEventListener('keydown', onTab);
  });
  let titleInput = $state<HTMLInputElement>();

  /** What the title will set (FR-1.12), for the highlights and the line under it. */
  let reading = $derived($readTitles ? previewDraftTitle(draft) : null);

  // Kept words move with the text typed before them (FR-1.12).
  // svelte-ignore state_referenced_locally
  let lastTitle = draft.title;
  $effect(() => {
    const now = draft.title;
    if (now === lastTitle) return;
    if (draft.kept.length) draft.kept = shiftKept(draft.kept, lastTitle, now);
    lastTitle = now;
  });

  /** A highlighted word clicked: keep it as text, or read a kept one again. */
  function toggleKept(span: TitleSpan, keep: boolean) {
    draft.kept = keep ? [...draft.kept, span] : draft.kept.filter((k) => k.from !== span.from);
  }

  let whereOpen = $state(false);
  let checklistFocus = $state<ID | null>(null);

  let ref = $derived($todayDate);
  let hasWhen = $derived(draft.deferred || draft.startDate !== null);
  let where = $derived(placementLabel(draft.placement));
  /** Placed in a repeating project's template, the reminder is a time on each copy's day (FR-3.8). */
  let reminderByTime = $derived(!!draft.placement.projectId && !!$snapshot.projects.find((p) => p.id === draft.placement.projectId)?.repeat);
  /** The reminder as it will be saved where the draft is placed now. */
  let reminderShown = $derived(newTaskReminder(draft.reminder, reminderByTime));

  $effect(() => {
    dialog.showModal();
    titleInput?.focus();
  });

  /** Name of the destination shown on the bottom-left chip. */
  function placementLabel(p: TodoPlacement): string {
    const s = $snapshot;
    if (p.projectId) {
      const project = s.projects.find((x) => x.id === p.projectId)?.title || 'New Project';
      const heading = p.headingId ? s.headings.find((h) => h.id === p.headingId)?.title : '';
      return heading ? `${project} › ${heading}` : project;
    }
    if (p.areaId) return s.areas.find((a) => a.id === p.areaId)?.title || 'New Area';
    return draft.start === 'inbox' && !hasWhen ? 'Inbox' : 'No project';
  }

  function cancel() {
    ui.draft = null;
  }

  function save() {
    // Commit any checklist text still being typed before reading the draft.
    (document.activeElement as HTMLElement | null)?.blur();
    void saveDraft();
  }

  // Listen on the document, not the dialog: after a menu choice, focus can
  // leave the card. Open popovers take Escape first and stop it.
  $effect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  }

  function onTitleKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      save();
    }
  }

  function chooseWhere(to: TodoPlacement) {
    whereOpen = false;
    draft.placement = to;
  }

  /** A deadline, and the start date moved to it when the picker offered that (FR-3.6). */
  function chooseDeadline(deadline: LocalDate | null, moveWhen: boolean) {
    draft.deadline = deadline;
    if (moveWhen && deadline) draft.setWhen({ kind: 'date', date: deadline }, ref);
  }

  async function addChecklist() {
    [checklistFocus] = await draft.checklist.add([''], null);
  }
</script>

<dialog
  bind:this={dialog}
  aria-label="Quick Entry"
  oncancel={(e) => e.preventDefault()}
  onclose={() => ui.draft === draft && cancel()}
>
  <div class="top">
    <span class="check" aria-hidden="true"></span>
    <label class="visually-hidden" for="qe-title">Title</label>
    <input
      id="qe-title"
      class="title"
      bind:this={titleInput}
      bind:value={draft.title}
      onkeydown={onTitleKey}
      placeholder="New Task"
      autocomplete="off"
    />
    {#if reading}
      <TitleHighlights field={titleInput} value={draft.title} words={reading.words} kept={draft.kept} ontoggle={toggleKept} />
    {/if}
  </div>
  <TitleHint {reading} />

  <label class="visually-hidden" for="qe-notes">Notes</label>
  <textarea id="qe-notes" class="notes" bind:value={draft.notes} placeholder="Notes" rows="2"></textarea>

  <Checklist items={draft.checklist.items} ops={draft.checklist} bind:focusId={checklistFocus} />

  <FieldBar
    fields={{
      startDate: draft.startDate,
      deferred: draft.deferred,
      deadline: draft.deadline,
      reminder: reminderShown,
      priority: draft.priority ?? null,
      contextId: draft.contextId,
      tagIds: draft.tagIds,
      hasChecklist: draft.checklist.items.length > 0,
    }}
    {ref}
    {reminderByTime}
    reminderField={$remindersOn}
    onwhen={(choice) => draft.setWhen(choice, ref)}
    ondeadline={chooseDeadline}
    onreminder={(reminder) => (draft.reminder = reminder)}
    onpriority={(p) => (draft.priority = p)}
    oncontext={(contextId) => (draft.contextId = contextId)}
    ontoggletag={(tagId, on) => draft.toggleTag(tagId, on)}
    onchecklist={addChecklist}
    onfinish={save}
  >
    {#snippet leading()}
      <Popover bind:open={whereOpen} label="Where" align="left">
        {#snippet trigger(toggle, open)}
          <button type="button" class="chip" aria-label="Where: {where}" aria-expanded={open} onclick={toggle}>
            <Icon name={draft.placement.projectId || draft.placement.areaId ? 'area' : 'inbox'} size={12} />{where}
          </button>
        {/snippet}
        <div class="where"><DestinationList onchoose={chooseWhere} /></div>
      </Popover>
    {/snippet}
  </FieldBar>

  <div class="actions">
    <button type="button" class="btn-plain" onclick={cancel}>Cancel</button>
    <button type="button" class="save" onclick={save}>Save</button>
  </div>
</dialog>

<style>
  dialog {
    margin: 12vh auto auto;
    border: 1px solid var(--surface-border);
    border-radius: 12px;
    padding: 14px 16px 12px;
    width: min(560px, calc(100% - 24px));
    box-shadow: var(--shadow-dialog);
    overflow: visible;
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  dialog::backdrop {
    background: var(--overlay);
  }
  .top {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .check {
    width: 16px;
    height: 16px;
    flex: none;
    border: 1.5px solid var(--border);
    border-radius: 4px;
  }
  .title {
    flex: 1;
    border: 0;
    outline: none;
    font-size: 15px;
    font-weight: 600;
    padding: 2px 0;
    background: transparent;
  }
  .notes {
    margin-left: 28px;
    border: 0;
    outline: none;
    resize: vertical;
    font-size: 14px;
    color: var(--text-2);
    line-height: 1.45;
    background: transparent;
  }
  .where {
    width: 260px;
    max-height: 300px;
    overflow-y: auto;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
  .save {
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    padding: 6px 16px;
  }
</style>
