<!--
  A gist's name and colour (FR-19.14), as Add Gist… and Rename… ask for
  them: a name field and the six colours as swatches. The caller checks the
  name (`gistNameProblem`) and shows any problem.
-->
<script lang="ts">
  import { GIST_COLOURS, GIST_NAME_MAX, type GistColour } from '../lib/model/settings';

  let { name = $bindable(''), colour = $bindable<GistColour>('blue') }: { name?: string; colour?: GistColour } = $props();

  /** The colours' names, as read out. */
  const NAMES: Record<GistColour, string> = { blue: 'Blue', green: 'Green', tan: 'Tan', red: 'Red', teal: 'Teal', grey: 'Grey' };
</script>

<label class="form-label" for="gist-name">Name</label>
<input id="gist-name" class="form-field" type="text" bind:value={name} maxlength={GIST_NAME_MAX * 2} autocomplete="off" />
<fieldset>
  <legend class="form-label">Colour</legend>
  <div class="swatches">
    {#each GIST_COLOURS as c (c)}
      <label class="swatch" style={`--gist: var(--gist-${c})`} title={NAMES[c]}>
        <input type="radio" name="gist-colour" value={c} bind:group={colour} aria-label={NAMES[c]} />
      </label>
    {/each}
  </div>
</fieldset>

<style>
  fieldset {
    border: 0;
    margin: 0 0 16px;
    padding: 0;
  }
  .swatches {
    display: flex;
    gap: 10px;
  }
  .swatch {
    position: relative;
    display: inline-flex;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--gist);
    cursor: pointer;
  }
  .swatch input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  /* The chosen colour has a ring. */
  .swatch:has(input:checked) {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--gist);
  }
  .swatch:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }
</style>
