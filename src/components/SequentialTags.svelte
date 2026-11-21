<!--
  Settings › Sequential projects (FR-17.1): the project tags that make a
  project sequential, each with the priority and context its released tasks
  get. Each change saves the whole list as one synced setting; saving it runs
  the automatic rules, so projects with a newly listed tag release a task.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import * as repo from '../lib/db/repo';
  import { bySortKey } from '../lib/model/order';
  import { PRIORITIES, type SequentialTag } from '../lib/model/settings';
  import type { Priority } from '../lib/model/types';
  import { settings, snapshot } from '../lib/state/live';

  let tags = $derived(bySortKey($snapshot.tags));
  let contexts = $derived(bySortKey($snapshot.contexts));
  /** Rows whose tag still exists (a deleted tag's row is kept but not shown). */
  let rows = $derived($settings.sequentialTags.filter((r) => tags.some((t) => t.id === r.tagId)));
  let unlisted = $derived(tags.filter((t) => !$settings.sequentialTags.some((r) => r.tagId === t.id)));

  /** Save the list with row `i` changed (or removed when `next` is null). */
  function save(i: number, next: SequentialTag | null) {
    const list = [...rows];
    if (next) list[i] = next;
    else list.splice(i, 1);
    void repo.setSetting('sequentialTags', list);
  }

  function add() {
    if (!unlisted.length) return;
    void repo.setSetting('sequentialTags', [...rows, { tagId: unlisted[0].id, priority: null, contextId: null }]);
  }

  const priorityOf = (v: string): Priority | null => (v === '' ? null : (Number(v) as Priority));
</script>

<p class="help">
  A project with one of these tags is sequential: when none of its tasks is in Today, its next task moves there,
  with this priority and context. Unchecking a task takes back the task it moved.
</p>
{#if rows.length}
  <ul class="seq">
    {#each rows as row, i (row.tagId)}
      <li>
        <select
          aria-label="Tag"
          value={row.tagId}
          onchange={(e) => save(i, { ...row, tagId: e.currentTarget.value })}
        >
          {#each tags.filter((t) => t.id === row.tagId || unlisted.includes(t)) as t (t.id)}
            <option value={t.id}>{t.title}</option>
          {/each}
        </select>
        <select
          aria-label="Priority"
          value={row.priority === null ? '' : String(row.priority)}
          onchange={(e) => save(i, { ...row, priority: priorityOf(e.currentTarget.value) })}
        >
          <option value="">No priority</option>
          {#each PRIORITIES as p (p)}
            <option value={String(p)}>{$settings.priorityLabels[p - 1]}</option>
          {/each}
        </select>
        <select
          aria-label="Context"
          value={row.contextId ?? ''}
          onchange={(e) => save(i, { ...row, contextId: e.currentTarget.value || null })}
        >
          <option value="">No context</option>
          {#each contexts as c (c.id)}
            <option value={c.id}>{c.title}</option>
          {/each}
        </select>
        <button type="button" class="icon-btn" aria-label="Remove {tags.find((t) => t.id === row.tagId)?.title}" onclick={() => save(i, null)}>
          <Icon name="x" size={14} />
        </button>
      </li>
    {/each}
  </ul>
{/if}
{#if tags.length}
  <button type="button" class="btn-plain" disabled={!unlisted.length} onclick={add}>
    <Icon name="plus" size={14} /> Add Tag
  </button>
{:else}
  <p class="help">Create a tag first, in Tags below.</p>
{/if}

<style>
  .help {
    font-size: 13px;
    color: var(--text-3);
    margin: 4px 0 10px;
  }
  .seq {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
  }
  .seq li {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    padding: 4px 0;
  }
  select {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 5px 8px;
    font: inherit;
    font-size: 14px;
    background: var(--bg);
    color: var(--text);
  }
</style>
