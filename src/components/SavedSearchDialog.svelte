<!--
  Name a new saved search, or edit one (FR-15.1, FR-15.5, FR-18.6): its name,
  search text, the tags a to-do must carry and an optional context.
-->
<script lang="ts">
  import { snapshot } from '../lib/state/live';
  import { bySortKey } from '../lib/model/order';
  import { contextsInOrder } from '../lib/model/contexts';
  import { isEmptyFilter } from '../lib/model/search';
  import type { SavedSearchFields } from '../lib/db/repo';
  import type { ID } from '../lib/model/types';

  let {
    title,
    initial,
    onsave,
    oncancel,
  }: {
    /** Dialog heading, e.g. "Save Search". */
    title: string;
    initial: SavedSearchFields;
    onsave: (fields: SavedSearchFields) => void;
    oncancel: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let name = $state(initial.title);
  // svelte-ignore state_referenced_locally
  let query = $state(initial.query);
  // svelte-ignore state_referenced_locally
  let tagIds = $state<ID[]>([...initial.tagIds]);
  // svelte-ignore state_referenced_locally
  let contextId = $state<ID | null>(initial.contextId ?? null);

  let tags = $derived(bySortKey($snapshot.tags));
  let contexts = $derived(contextsInOrder($snapshot));
  let valid = $derived(name.trim() !== '' && !isEmptyFilter({ query, tagIds, contextId }));

  $effect(() => {
    dialog.showModal();
  });

  function toggle(id: ID) {
    tagIds = tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id];
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (valid) onsave({ title: name, query, tagIds, contextId });
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="saved-title"
  oncancel={(e) => {
    e.preventDefault();
    oncancel();
  }}
>
  <form onsubmit={submit}>
    <h2 id="saved-title">{title}</h2>
    <label>
      <span>Name</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={name} autocomplete="off" autofocus />
    </label>
    <label>
      <span>Search for</span>
      <input bind:value={query} autocomplete="off" placeholder="Words to match" />
    </label>
    {#if tags.length}
      <fieldset>
        <legend>Only tasks tagged</legend>
        <div class="tags">
          {#each tags as tag (tag.id)}
            <button type="button" class="pill" aria-pressed={tagIds.includes(tag.id)} onclick={() => toggle(tag.id)}>
              {tag.title || 'Untitled'}
            </button>
          {/each}
        </div>
      </fieldset>
    {/if}
    {#if contexts.length}
      <fieldset>
        <legend>Only tasks in context</legend>
        <div class="tags">
          {#each contexts as c (c.id)}
            <button
              type="button"
              class="pill"
              aria-pressed={contextId === c.id}
              onclick={() => (contextId = contextId === c.id ? null : c.id)}
            >
              {c.title || 'Untitled'}
            </button>
          {/each}
        </div>
      </fieldset>
    {/if}
    {#if !valid}
      <p class="hint">{name.trim() ? 'Enter words to search for, or pick a tag or context.' : 'Enter a name.'}</p>
    {/if}
    <div class="actions">
      <button type="button" class="btn-plain" onclick={oncancel}>Cancel</button>
      <button type="submit" class="save" disabled={!valid}>Save</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    border: 0;
    border-radius: 12px;
    padding: 20px 22px 16px;
    max-width: 420px;
    width: calc(100% - 32px);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  }
  dialog::backdrop {
    background: var(--overlay);
  }
  h2 {
    margin: 0 0 12px;
    font-size: 17px;
  }
  label,
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--text-2);
  }
  fieldset {
    border: 0;
    padding: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 4px;
  }
  input {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 7px 9px;
    font-size: 14px;
    color: var(--text);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pill {
    border: 1px solid var(--line);
    background: var(--field);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 12px;
    color: var(--text-2);
  }
  .pill[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .hint {
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--text-3);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .save {
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    padding: 8px 14px;
    font-weight: 600;
  }
  .save:disabled {
    opacity: 0.5;
  }
</style>
