<!--
  Settings (design doc, Section 5.10 FR-14.13 and Section 5.4 FR-6.1).
  - Priority Settings: P1–P5 labels and the two automatic-rule switches.
  - Tags: create, rename, reorder and delete (the Manage Tags window).
  Changes save as soon as a field is left or a switch is flipped.
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ViewHeader from '../components/ViewHeader.svelte';
  import ChoiceDialog from '../components/ChoiceDialog.svelte';
  import { settings, snapshot } from '../lib/state/live';
  import { bySortKey } from '../lib/model/order';
  import { DEFAULT_PRIORITY_LABELS, PRIORITIES, cleanLabels } from '../lib/model/settings';
  import * as repo from '../lib/db/repo';
  import type { ID, Priority, Tag } from '../lib/model/types';

  let tags = $derived(bySortKey($snapshot.tags));
  let newTag = $state('');
  let deleting = $state<Tag | null>(null);

  /** Save one priority label; an empty label returns to its default (FR-14.3). */
  function saveLabel(p: Priority, input: HTMLInputElement) {
    const labels = [...$settings.priorityLabels];
    labels[p - 1] = input.value;
    const clean = cleanLabels(labels);
    input.value = clean[p - 1];
    void repo.setSetting('priorityLabels', clean);
  }

  function resetLabel(p: Priority) {
    const labels = [...$settings.priorityLabels];
    labels[p - 1] = DEFAULT_PRIORITY_LABELS[p - 1];
    void repo.setSetting('priorityLabels', labels);
  }

  /** Rename a tag; a blank name is not allowed, so the old one comes back. */
  function renameTag(tag: Tag, input: HTMLInputElement) {
    const title = input.value.trim();
    if (!title) input.value = tag.title;
    else if (title !== tag.title) void repo.renameTag(tag.id, title);
  }

  async function addTag(e: SubmitEvent) {
    e.preventDefault();
    if (!newTag.trim()) return;
    await repo.createTag(newTag);
    newTag = '';
  }

  function onDeleteChoice(v: string | null) {
    const tag = deleting;
    deleting = null;
    if (v === 'delete' && tag) void repo.deleteTag(tag.id);
  }

  /** Enter in a text field saves it by leaving the field. */
  const blurOnEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  };

  const moveTag = (id: ID, dir: 'up' | 'down') => repo.moveTag(id, dir);
</script>

<ViewHeader title="Settings">
  {#snippet icon()}<Icon name="settings" size={26} color="var(--text-2)" />{/snippet}
</ViewHeader>

<section aria-labelledby="prio-heading">
  <h2 id="prio-heading">Priority Settings</h2>

  <h3>Labels</h3>
  <p class="help">Give each priority your own name. The order P1 (highest) to P5 never changes.</p>
  <ul class="rows">
    {#each PRIORITIES as p (p)}
      {@const label = $settings.priorityLabels[p - 1]}
      <li>
        <span class="prio prio-{p}">P{p}</span>
        <input
          class="text"
          value={label}
          aria-label="Label for P{p}"
          maxlength="24"
          onchange={(e) => saveLabel(p, e.currentTarget)}
          onkeydown={blurOnEnter}
        />
        {#if label !== DEFAULT_PRIORITY_LABELS[p - 1]}
          <button type="button" class="btn-plain small" onclick={() => resetLabel(p)}>Reset</button>
        {/if}
      </li>
    {/each}
  </ul>

  <h3>Automatic priority</h3>
  <label class="switch-row">
    <input
      type="checkbox"
      role="switch"
      checked={$settings.autoP1}
      onchange={(e) => repo.setSetting('autoP1', e.currentTarget.checked)}
    />
    <span>Set P1 automatically for due and overdue to-dos in Today</span>
  </label>
  <label class="switch-row">
    <input
      type="checkbox"
      role="switch"
      checked={$settings.defaultP2}
      onchange={(e) => repo.setSetting('defaultP2', e.currentTarget.checked)}
    />
    <span>Set P2 by default for to-dos added to Today</span>
  </label>
  <p class="help">
    These rules only fill in a priority you have not chosen yourself. Turning a switch off keeps the
    priorities it already set.
  </p>
</section>

<section aria-labelledby="tags-heading">
  <h2 id="tags-heading">Tags</h2>
  {#if tags.length}
    <ul class="rows">
      {#each tags as tag, i (tag.id)}
        <li>
          <Icon name="tag" size={14} color="var(--text-3)" />
          <input
            class="text"
            value={tag.title}
            aria-label="Tag name"
            onchange={(e) => renameTag(tag, e.currentTarget)}
            onkeydown={blurOnEnter}
          />
          <button type="button" class="btn-plain small" aria-label="Move {tag.title} up" disabled={i === 0} onclick={() => moveTag(tag.id, 'up')}>
            <Icon name="arrow-up" size={14} />
          </button>
          <button type="button" class="btn-plain small" aria-label="Move {tag.title} down" disabled={i === tags.length - 1} onclick={() => moveTag(tag.id, 'down')}>
            <Icon name="arrow-down" size={14} />
          </button>
          <button type="button" class="btn-plain small danger" aria-label="Delete {tag.title}" onclick={() => (deleting = tag)}>
            <Icon name="trash" size={14} />
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="help">No tags yet.</p>
  {/if}
  <form class="add" onsubmit={addTag}>
    <input class="text" bind:value={newTag} placeholder="New tag" aria-label="New tag name" />
    <button type="submit" class="btn-plain" disabled={!newTag.trim()}><Icon name="plus" size={14} /> Add Tag</button>
  </form>
</section>

{#if deleting}
  <ChoiceDialog
    title={`Delete the tag “${deleting.title}”?`}
    message="It will be removed from every to-do, project and area. The items themselves stay."
    choices={[{ label: 'Delete Tag', value: 'delete', danger: true }]}
    onchoose={onDeleteChoice}
  />
{/if}

<style>
  section {
    margin: 0 0 32px 38px;
  }
  h2 {
    font-size: 17px;
    margin: 0 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--rule);
  }
  h3 {
    font-size: 14px;
    margin: 18px 0 4px;
  }
  .help {
    font-size: 13px;
    color: var(--text-3);
    margin: 4px 0 10px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }
  .rows .prio {
    width: 30px;
    justify-content: center;
  }
  .text {
    border: 1px solid #d6d6da;
    border-radius: var(--radius);
    padding: 5px 8px;
    font-size: 14px;
    width: 220px;
    max-width: 100%;
  }
  .small {
    padding: 4px 6px;
    font-size: 13px;
  }
  .danger {
    color: var(--danger);
  }
  .switch-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    font-size: 14px;
  }
  .switch-row input {
    appearance: none;
    width: 34px;
    height: 20px;
    border-radius: 999px;
    background: #c9c9ce;
    position: relative;
    flex: none;
    margin: 0;
    cursor: pointer;
    transition: background 0.15s;
  }
  .switch-row input::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  .switch-row input:checked {
    background: var(--accent);
  }
  .switch-row input:checked::after {
    transform: translateX(14px);
  }
  .add {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  @media (max-width: 767px) {
    section {
      margin-left: 0;
    }
  }
</style>
