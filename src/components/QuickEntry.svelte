<!--
  Quick Entry (FR-8.1): a floating card for writing a new to-do with every
  field: title, notes, checklist, tags, When, deadline, priority and where it
  goes (the Inbox unless opened from another view, FR-10.5).
  Nothing is stored until Save (Enter in the title, or Cmd/Ctrl+Enter);
  Cancel or Escape discards the draft.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';
  import WhenPicker from './WhenPicker.svelte';
  import DeadlinePicker from './DeadlinePicker.svelte';
  import TagPicker from './TagPicker.svelte';
  import PriorityMenu from './PriorityMenu.svelte';
  import Checklist from './Checklist.svelte';
  import DestinationList from './DestinationList.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import { settings, snapshot, todayDate } from '../lib/state/live';
  import { saveDraft } from '../lib/actions';
  import { deadlineLabel, formatRelative } from '../lib/model/dates';
  import { priorityLabel } from '../lib/model/settings';
  import { tagTitles } from '../lib/model/tags';
  import type { TodoDraft } from '../lib/state/draft.svelte';
  import type { TodoPlacement, WhenChoice } from '../lib/db/repo';
  import type { ID, LocalDate, Priority } from '../lib/model/types';

  let { draft }: { draft: TodoDraft } = $props();

  let dialog: HTMLDialogElement;
  let titleInput: HTMLInputElement;

  let whereOpen = $state(false);
  let whenOpen = $state(false);
  let deadlineOpen = $state(false);
  let tagsOpen = $state(false);
  let prioOpen = $state(false);
  let checklistFocus = $state<ID | null>(null);

  let ref = $derived($todayDate);
  let hasWhen = $derived(draft.deferred || draft.startDate !== null);
  let whenLabel = $derived(
    draft.deferred ? 'Deferred' : draft.startDate === null ? '' : draft.startDate <= ref ? 'Today' : formatRelative(draft.startDate, ref),
  );
  let tagNames = $derived(tagTitles(draft.tagIds, $snapshot));
  let where = $derived(placementLabel(draft.placement));

  $effect(() => {
    dialog.showModal();
    titleInput.focus();
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

  function chooseWhen(choice: WhenChoice) {
    whenOpen = false;
    draft.setWhen(choice, ref);
  }

  function chooseDeadline(deadline: LocalDate | null) {
    deadlineOpen = false;
    draft.deadline = deadline;
  }

  function choosePriority(p: Priority | null) {
    prioOpen = false;
    draft.priority = p;
  }

  async function addChecklist() {
    [checklistFocus] = await draft.checklist.add([''], null);
  }
</script>

{#snippet whenPanel()}
  <WhenPicker startDate={draft.startDate} deferred={draft.deferred} {ref} onchoose={chooseWhen} />
{/snippet}
{#snippet deadlinePanel()}
  <DeadlinePicker deadline={draft.deadline} {ref} onchoose={chooseDeadline} />
{/snippet}
{#snippet tagsPanel()}
  <TagPicker tagIds={draft.tagIds} ontoggle={(tagId, on) => draft.toggleTag(tagId, on)} />
{/snippet}
{#snippet prioPanel()}
  <PriorityMenu priority={draft.priority ?? null} onchoose={choosePriority} />
{/snippet}

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
      placeholder="New To-Do"
      autocomplete="off"
    />
  </div>

  <label class="visually-hidden" for="qe-notes">Notes</label>
  <textarea id="qe-notes" class="notes" bind:value={draft.notes} placeholder="Notes" rows="2"></textarea>

  <Checklist items={draft.checklist.items} ops={draft.checklist} bind:focusId={checklistFocus} />

  {#if tagNames.length}
    <div class="tags">
      <Popover bind:open={tagsOpen} label="Tags" align="left">
        {#snippet trigger(toggle)}
          <button type="button" class="tag-list" aria-label="Edit tags" onclick={toggle}>
            {#each tagNames as name, i (i)}<span class="tag-pill">{name}</span>{/each}
          </button>
        {/snippet}
        {@render tagsPanel()}
      </Popover>
    </div>
  {/if}

  <div class="bar">
    <div class="left">
      <Popover bind:open={whereOpen} label="Where" align="left">
        {#snippet trigger(toggle, open)}
          <button type="button" class="chip" aria-label="Where: {where}" aria-expanded={open} onclick={toggle}>
            <Icon name={draft.placement.projectId || draft.placement.areaId ? 'area' : 'inbox'} size={12} />{where}
          </button>
        {/snippet}
        <div class="where"><DestinationList onchoose={chooseWhere} /></div>
      </Popover>
      {#if hasWhen}
        <Popover bind:open={whenOpen} label="When" align="left">
          {#snippet trigger(toggle)}
            <button type="button" class="chip" onclick={toggle}>
              <Icon name={draft.deferred ? 'archive' : draft.startDate && draft.startDate <= ref ? 'star' : 'calendar'} size={12} />{whenLabel}
            </button>
          {/snippet}
          {@render whenPanel()}
        </Popover>
      {/if}
      {#if draft.deadline}
        <Popover bind:open={deadlineOpen} label="Deadline" align="left">
          {#snippet trigger(toggle)}
            <button type="button" class="chip" class:due={draft.deadline! <= ref} onclick={toggle}>
              <Icon name="flag" size={12} />Deadline: {deadlineLabel(draft.deadline!, ref)}
            </button>
          {/snippet}
          {@render deadlinePanel()}
        </Popover>
      {/if}
      {#if draft.priority}
        <Popover bind:open={prioOpen} label="Priority" align="left">
          {#snippet trigger(toggle)}
            <button type="button" class="chip" aria-label="Priority: {priorityLabel(draft.priority!, $settings)}" onclick={toggle}>
              <span class="prio prio-{draft.priority}">{priorityLabel(draft.priority!, $settings)}</span>
            </button>
          {/snippet}
          {@render prioPanel()}
        </Popover>
      {/if}
    </div>

    <div class="right">
      {#if !hasWhen}
        <Popover bind:open={whenOpen} label="When">
          {#snippet trigger(toggle, open)}
            <button type="button" class="icon-btn" aria-label="When" title="When" aria-expanded={open} onclick={toggle}>
              <Icon name="calendar" size={16} />
            </button>
          {/snippet}
          {@render whenPanel()}
        </Popover>
      {/if}
      {#if !tagNames.length}
        <Popover bind:open={tagsOpen} label="Tags">
          {#snippet trigger(toggle, open)}
            <button type="button" class="icon-btn" aria-label="Tags" title="Tags" aria-expanded={open} onclick={toggle}>
              <Icon name="tag" size={16} />
            </button>
          {/snippet}
          {@render tagsPanel()}
        </Popover>
      {/if}
      {#if !draft.checklist.items.length}
        <button type="button" class="icon-btn" aria-label="Add checklist" title="Checklist" onclick={addChecklist}>
          <Icon name="checklist" size={16} />
        </button>
      {/if}
      {#if !draft.deadline}
        <Popover bind:open={deadlineOpen} label="Deadline">
          {#snippet trigger(toggle, open)}
            <button type="button" class="icon-btn" aria-label="Deadline" title="Deadline" aria-expanded={open} onclick={toggle}>
              <Icon name="flag" size={16} />
            </button>
          {/snippet}
          {@render deadlinePanel()}
        </Popover>
      {/if}
      {#if !draft.priority}
        <Popover bind:open={prioOpen} label="Priority">
          {#snippet trigger(toggle, open)}
            <button type="button" class="icon-btn" aria-label="Priority" title="Priority" aria-expanded={open} onclick={toggle}>
              <Icon name="priority" size={16} />
            </button>
          {/snippet}
          {@render prioPanel()}
        </Popover>
      {/if}
    </div>
  </div>

  <div class="actions">
    <button type="button" class="btn-plain" onclick={cancel}>Cancel</button>
    <button type="button" class="save" onclick={save}>Save</button>
  </div>
</dialog>

<style>
  dialog {
    margin: 12vh auto auto;
    border: 1px solid #e5e5e8;
    border-radius: 12px;
    padding: 14px 16px 12px;
    width: min(560px, calc(100% - 24px));
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
    overflow: visible;
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.2);
  }
  .top {
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
  .tags {
    margin-left: 28px;
  }
  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    border: 0;
    background: transparent;
    padding: 0;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-left: 28px;
    padding-top: 6px;
    border-top: 1px solid var(--rule);
  }
  .left,
  .right {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .chip.due {
    color: var(--danger);
    font-weight: 600;
  }
  .icon-btn {
    border: 0;
    background: transparent;
    padding: 8px;
    border-radius: var(--radius);
    display: inline-flex;
    color: var(--text-3);
  }
  .icon-btn:hover {
    background: var(--hover-bg);
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
    color: #fff;
    font-weight: 600;
    padding: 6px 16px;
  }
</style>
