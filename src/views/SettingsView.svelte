<!--
  Settings (design doc, Section 5.10 FR-14.13 and Section 5.4 FR-6.1).
  - Appearance (FR-V.3): System, Light or Dark.
  - Priority Settings: P1–P5 labels and the two automatic-rule switches.
  - Tags: create, rename, reorder and delete (the Manage Tags window).
  - Contexts (FR-18.2): the same, for the contexts a to-do can be in.
  Changes save as soon as a field is left or a switch is flipped.
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ViewHeader from '../components/ViewHeader.svelte';
  import ChoiceDialog from '../components/ChoiceDialog.svelte';
  import NamedList from '../components/NamedList.svelte';
  import Segmented from '../components/Segmented.svelte';
  import { settings, snapshot } from '../lib/state/live';
  import { bySortKey } from '../lib/model/order';
  import { DEFAULT_PRIORITY_LABELS, PRIORITIES, cleanLabels, type Theme } from '../lib/model/settings';
  import * as repo from '../lib/db/repo';
  import type { ID, Priority } from '../lib/model/types';

  const THEME_OPTIONS: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  let tags = $derived(bySortKey($snapshot.tags));
  let contexts = $derived(bySortKey($snapshot.contexts));
  /** The tag or context waiting for delete confirmation. */
  let deleting = $state<{ kind: 'tag' | 'context'; id: ID; title: string } | null>(null);

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

  function onDeleteChoice(v: string | null) {
    const item = deleting;
    deleting = null;
    if (v !== 'delete' || !item) return;
    void (item.kind === 'tag' ? repo.deleteTag(item.id) : repo.deleteContext(item.id));
  }

  /** Enter in a text field saves it by leaving the field. */
  const blurOnEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  };
</script>

<ViewHeader title="Settings">
  {#snippet icon()}<Icon name="settings" size={26} color="var(--text-2)" />{/snippet}
</ViewHeader>

<section aria-labelledby="appearance-heading">
  <h2 id="appearance-heading">Appearance</h2>
  <div class="setting-row">
    <span>Theme</span>
    <Segmented
      label="Theme"
      options={THEME_OPTIONS}
      value={$settings.theme}
      onchange={(v) => repo.setSetting('theme', v)}
    />
  </div>
  <p class="help">System follows your device's light or dark setting.</p>
</section>

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
  <NamedList
    items={tags}
    icon="tag"
    noun="Tag"
    onrename={repo.renameTag}
    onmove={repo.moveTag}
    ondelete={(t) => (deleting = { kind: 'tag', ...t })}
    onadd={repo.createTag}
  />
</section>

<section aria-labelledby="contexts-heading">
  <h2 id="contexts-heading">Contexts</h2>
  <p class="help">Where or how a to-do can be done, such as Home, Office or Phone. A to-do has one context or none.</p>
  <NamedList
    items={contexts}
    icon="context"
    noun="Context"
    onrename={repo.renameContext}
    onmove={repo.moveContext}
    ondelete={(c) => (deleting = { kind: 'context', ...c })}
    onadd={repo.createContext}
  />
</section>

{#if deleting?.kind === 'tag'}
  <ChoiceDialog
    title={`Delete the tag “${deleting.title}”?`}
    message="It will be removed from every to-do, project and area. The items themselves stay."
    choices={[{ label: 'Delete Tag', value: 'delete', danger: true }]}
    onchoose={onDeleteChoice}
  />
{:else if deleting}
  <ChoiceDialog
    title={`Delete the context “${deleting.title}”?`}
    message="It will be cleared from every to-do and saved search that uses it. The to-dos themselves stay."
    choices={[{ label: 'Delete Context', value: 'delete', danger: true }]}
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
    border: 1px solid var(--line);
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
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 6px 0;
    font-size: 14px;
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
    background: var(--switch-off);
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
    background: #fff; /* the knob stays white in both themes, as in macOS */
    transition: transform 0.15s;
  }
  .switch-row input:checked {
    background: var(--accent);
  }
  .switch-row input:checked::after {
    transform: translateX(14px);
  }
  @media (max-width: 767px) {
    section {
      margin-left: 0;
    }
  }
</style>
