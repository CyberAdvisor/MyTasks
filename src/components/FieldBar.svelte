<!--
  The fields of a task being edited, shared by the expanded card (FR-1.2)
  and Quick Entry (FR-8.1): the tag pills (when it has tags), then the
  bottom bar, with set fields as chips on the left (Start Date, Deadline,
  Reminder, Priority, Context) and buttons for the empty ones on the right
  (Start Date, Tags, Checklist, Deadline, Reminder, Priority, Context). Each
  opens its picker, titled with the field's name and pointing at its button,
  which is highlighted while it's open; the owner saves the choice.

  - `fields`: the values shown.
  - `template`: a repeating task's template, which has no start date or
    deadline of its own, so their buttons are left out (FR-4.1).
  - `reminderByTime`: the Reminder picker asks for a time only (FR-3.8).
  - `reminderField`: whether the Reminder button shows (while reminders are
    on); a set reminder's chip always shows.
  - `leading`: drawn first among the chips (Quick Entry's Where).
  - `between`: drawn between the tag pills and the bar (the card's repeat line).
  - `trailing`: drawn after the buttons (the card's Move and ⋯).
  The open states are bindable, so a keyboard command can open a picker.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';
  import WhenPicker from './WhenPicker.svelte';
  import DeadlinePicker from './DeadlinePicker.svelte';
  import ReminderPicker from './ReminderPicker.svelte';
  import TagPicker from './TagPicker.svelte';
  import PriorityMenu from './PriorityMenu.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { settings, snapshot } from '../lib/state/live';
  import { deadlineLabel, formatRelative } from '../lib/model/dates';
  import { reminderLabel } from '../lib/model/reminder';
  import { priorityLabel } from '../lib/model/settings';
  import { tagTitles } from '../lib/model/tags';
  import { contextTitle } from '../lib/model/contexts';
  import type { WhenChoice } from '../lib/db/repo';
  import type { ID, LocalDate, Priority } from '../lib/model/types';

  /** The values the bar shows. */
  export interface Fields {
    startDate: LocalDate | null;
    deferred: boolean;
    deadline: LocalDate | null;
    reminder: string | null;
    priority: Priority | null;
    contextId: ID | null;
    tagIds: ID[];
    /** Whether the task has checklist items (then no Checklist button). */
    hasChecklist: boolean;
  }

  let {
    fields,
    ref,
    template = false,
    reminderByTime = false,
    reminderField,
    onwhen,
    ondeadline,
    onreminder,
    onpriority,
    oncontext,
    ontoggletag,
    onchecklist,
    leading,
    between,
    trailing,
    whenOpen = $bindable(false),
    deadlineOpen = $bindable(false),
    reminderOpen = $bindable(false),
    tagsOpen = $bindable(false),
  }: {
    fields: Fields;
    ref: LocalDate;
    template?: boolean;
    reminderByTime?: boolean;
    reminderField: boolean;
    onwhen: (choice: WhenChoice) => void;
    ondeadline: (deadline: LocalDate | null, moveWhen: boolean) => void;
    onreminder: (reminder: string | null) => void;
    onpriority: (p: Priority | null) => void;
    oncontext: (contextId: ID | null) => void;
    ontoggletag: (tagId: ID, on: boolean) => void;
    onchecklist: () => void;
    leading?: Snippet;
    between?: Snippet;
    trailing?: Snippet;
    whenOpen?: boolean;
    deadlineOpen?: boolean;
    reminderOpen?: boolean;
    tagsOpen?: boolean;
  } = $props();

  let prioOpen = $state(false);
  let contextOpen = $state(false);

  let hasWhen = $derived(!template && (fields.deferred || fields.startDate !== null));
  let whenLabel = $derived(
    fields.deferred ? 'Deferred' : fields.startDate === null ? '' : fields.startDate <= ref ? 'Today' : formatRelative(fields.startDate, ref),
  );
  let tagNames = $derived(tagTitles(fields.tagIds, $snapshot));
  let contextName = $derived(contextTitle(fields.contextId, $snapshot));

  // Each choice closes its picker, then goes to the owner.
  function chooseWhen(choice: WhenChoice) {
    whenOpen = false;
    onwhen(choice);
  }
  function chooseDeadline(deadline: LocalDate | null, moveWhen: boolean) {
    deadlineOpen = false;
    ondeadline(deadline, moveWhen);
  }
  function chooseReminder(reminder: string | null) {
    reminderOpen = false;
    onreminder(reminder);
  }
  function choosePriority(p: Priority | null) {
    prioOpen = false;
    onpriority(p);
  }
  function chooseContext(contextId: ID | null) {
    contextOpen = false;
    oncontext(contextId);
  }
</script>

{#snippet whenPanel()}
  <WhenPicker startDate={fields.startDate} deferred={fields.deferred} deadline={fields.deadline} {ref} onchoose={chooseWhen} />
{/snippet}
{#snippet deadlinePanel()}
  <DeadlinePicker deadline={fields.deadline} when={fields.startDate} {ref} onchoose={chooseDeadline} />
{/snippet}
{#snippet reminderPanel()}
  <ReminderPicker reminder={fields.reminder} template={reminderByTime} startDate={fields.startDate} {ref} onchoose={chooseReminder} />
{/snippet}
{#snippet tagsPanel()}
  <TagPicker tagIds={fields.tagIds} ontoggle={ontoggletag} ondone={() => (tagsOpen = false)} />
{/snippet}
{#snippet prioPanel()}
  <PriorityMenu priority={fields.priority} onchoose={choosePriority} />
{/snippet}
{#snippet contextPanel()}
  <ContextMenu contextId={fields.contextId} onchoose={chooseContext} />
{/snippet}

{#if tagNames.length}
  <div class="tags">
    <Popover titled bind:open={tagsOpen} label="Tags" align="left">
      {#snippet trigger(toggle, open)}
        <button type="button" class="tag-list" aria-label="Edit tags" aria-expanded={open} onclick={toggle}>
          {#each tagNames as name, i (i)}<span class="tag-pill">{name}</span>{/each}
        </button>
      {/snippet}
      {@render tagsPanel()}
    </Popover>
  </div>
{/if}

{@render between?.()}

<div class="bar">
  <div class="left">
    {@render leading?.()}
    {#if hasWhen}
      <Popover titled bind:open={whenOpen} label="Start Date" align="left">
        {#snippet trigger(toggle, open)}
          <button type="button" class="chip" aria-expanded={open} onclick={toggle}>
            <Icon name={fields.deferred ? 'archive' : fields.startDate && fields.startDate <= ref ? 'star' : 'calendar'} size={12} />{whenLabel}
          </button>
        {/snippet}
        {@render whenPanel()}
      </Popover>
    {/if}
    {#if fields.deadline}
      <Popover titled bind:open={deadlineOpen} label="Deadline" align="left">
        {#snippet trigger(toggle, open)}
          <button type="button" class="chip" aria-expanded={open} class:due={fields.deadline! <= ref} onclick={toggle}>
            <Icon name="flag" size={12} />Deadline: {deadlineLabel(fields.deadline!, ref)}
          </button>
        {/snippet}
        {@render deadlinePanel()}
      </Popover>
    {/if}
    {#if fields.reminder}
      <Popover titled bind:open={reminderOpen} label="Reminder" align="left">
        {#snippet trigger(toggle, open)}
          <button type="button" class="chip reminder" aria-expanded={open} onclick={toggle}>
            <Icon name="bell" size={12} />{reminderLabel(fields.reminder!, ref)}
          </button>
        {/snippet}
        {@render reminderPanel()}
      </Popover>
    {/if}
    {#if fields.priority}
      <Popover titled bind:open={prioOpen} label="Priority" align="left">
        {#snippet trigger(toggle, open)}
          <button type="button" class="chip" aria-expanded={open} aria-label="Priority: {priorityLabel(fields.priority!, $settings)}" onclick={toggle}>
            <span class="prio prio-{fields.priority}">{priorityLabel(fields.priority!, $settings)}</span>
          </button>
        {/snippet}
        {@render prioPanel()}
      </Popover>
    {/if}
    {#if contextName}
      <Popover titled bind:open={contextOpen} label="Context" align="left">
        {#snippet trigger(toggle, open)}
          <button type="button" class="chip" aria-expanded={open} aria-label="Context: {contextName}" onclick={toggle}>
            <Icon name="context" size={12} />{contextName}
          </button>
        {/snippet}
        {@render contextPanel()}
      </Popover>
    {/if}
  </div>

  <div class="right">
    {#if !hasWhen && !template}
      <Popover titled bind:open={whenOpen} label="Start Date">
        {#snippet trigger(toggle, open)}
          <button type="button" class="icon-btn" aria-label="Start Date" title="Start Date" aria-expanded={open} onclick={toggle}>
            <Icon name="calendar" size={16} />
          </button>
        {/snippet}
        {@render whenPanel()}
      </Popover>
    {/if}
    {#if !tagNames.length}
      <Popover titled bind:open={tagsOpen} label="Tags">
        {#snippet trigger(toggle, open)}
          <button type="button" class="icon-btn" aria-label="Tags" title="Tags" aria-expanded={open} onclick={toggle}>
            <Icon name="tag" size={16} />
          </button>
        {/snippet}
        {@render tagsPanel()}
      </Popover>
    {/if}
    {#if !fields.hasChecklist}
      <button type="button" class="icon-btn" aria-label="Add checklist" title="Checklist" onclick={onchecklist}>
        <Icon name="checklist" size={16} />
      </button>
    {/if}
    {#if !fields.deadline && !template}
      <Popover titled bind:open={deadlineOpen} label="Deadline">
        {#snippet trigger(toggle, open)}
          <button type="button" class="icon-btn" aria-label="Deadline" title="Deadline" aria-expanded={open} onclick={toggle}>
            <Icon name="flag" size={16} />
          </button>
        {/snippet}
        {@render deadlinePanel()}
      </Popover>
    {/if}
    {#if !fields.reminder && reminderField}
      <Popover titled bind:open={reminderOpen} label="Reminder">
        {#snippet trigger(toggle, open)}
          <button type="button" class="icon-btn" aria-label="Reminder" title="Reminder" aria-expanded={open} onclick={toggle}>
            <Icon name="bell" size={16} />
          </button>
        {/snippet}
        {@render reminderPanel()}
      </Popover>
    {/if}
    {#if !fields.priority}
      <Popover titled bind:open={prioOpen} label="Priority">
        {#snippet trigger(toggle, open)}
          <button type="button" class="icon-btn" aria-label="Priority" title="Priority" aria-expanded={open} onclick={toggle}>
            <Icon name="priority" size={16} />
          </button>
        {/snippet}
        {@render prioPanel()}
      </Popover>
    {/if}
    {#if !contextName}
      <Popover titled bind:open={contextOpen} label="Context">
        {#snippet trigger(toggle, open)}
          <button type="button" class="icon-btn" aria-label="Context" title="Context" aria-expanded={open} onclick={toggle}>
            <Icon name="context" size={16} />
          </button>
        {/snippet}
        {@render contextPanel()}
      </Popover>
    {/if}
    {@render trailing?.()}
  </div>
</div>

<style>
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
  .chip.reminder {
    color: var(--accent-text);
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
  /* The button whose picker is open, so it's clear which field is being set. */
  .icon-btn[aria-expanded='true'],
  .chip[aria-expanded='true'],
  .tag-list[aria-expanded='true'] {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent-text);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .tag-list {
    border-radius: var(--radius);
  }
</style>
