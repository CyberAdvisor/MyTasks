<!--
  Modal dialog asking the user to pick one of several actions.
  Used for: completing a project with open to-dos, deleting an area,
  emptying the Trash.
-->
<script lang="ts" module>
  export interface Choice {
    label: string;
    value: string;
    danger?: boolean;
  }
</script>

<script lang="ts">
  let {
    title,
    message = '',
    choices,
    onchoose,
  }: {
    title: string;
    message?: string;
    choices: Choice[];
    /** Called with the chosen value, or null when cancelled. */
    onchoose: (value: string | null) => void;
  } = $props();

  let dialog: HTMLDialogElement;

  $effect(() => {
    dialog.showModal();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="choice-title"
  oncancel={(e) => {
    e.preventDefault();
    onchoose(null);
  }}
>
  <h2 id="choice-title">{title}</h2>
  {#if message}<p>{message}</p>{/if}
  <div class="actions">
    <button type="button" class="btn-plain" onclick={() => onchoose(null)}>Cancel</button>
    {#each choices as c (c.value)}
      <button type="button" class="choice" class:danger={c.danger} onclick={() => onchoose(c.value)}>
        {c.label}
      </button>
    {/each}
  </div>
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
    margin: 0 0 8px;
    font-size: 17px;
  }
  p {
    margin: 0 0 16px;
    color: var(--text-2);
    font-size: 14px;
    line-height: 1.45;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  .choice {
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    padding: 8px 14px;
    font-weight: 600;
  }
  .choice.danger {
    background: var(--danger);
    color: var(--on-strong);
  }
</style>
