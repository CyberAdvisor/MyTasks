<!--
  Natural-language entry while typing (FR-1.12): a layer over a title field
  that highlights the words that will be read, and draws a dotted underline
  under words kept as text. The layer copies the field's font, padding and
  wrapping, so its words sit exactly over the field's; its text is
  transparent, so only the highlights show.

  A click or tap on a highlighted word keeps it as text; on a kept word, it
  is read again. The click doesn't move focus or the caret, so the card
  doesn't treat it as leaving the title. Everywhere else the layer lets
  clicks through to the field.

  The owner places this next to the field inside a positioned box (the
  field's offset parent).
-->
<script lang="ts">
  import type { TitleSpan, TitleWord } from '../lib/model/titleWords';

  let {
    field,
    value,
    words,
    kept,
    ontoggle,
  }: {
    /** The title field the layer lies over. */
    field: HTMLInputElement | HTMLTextAreaElement | undefined;
    value: string;
    /** The words that will be read. */
    words: TitleWord[];
    /** The parts kept as text. */
    kept: TitleSpan[];
    /** A highlighted word clicked (keep it) or a kept one (read it again). */
    ontoggle: (span: TitleSpan, keep: boolean) => void;
  } = $props();

  type Segment = { text: string; mark?: 'read' | 'kept'; span?: TitleSpan };

  /** The title cut into plain text, words to be read and kept words, in order. */
  let segments = $derived.by((): Segment[] => {
    const marks = [
      ...words.map((w) => ({ from: w.from, to: w.to, mark: 'read' as const })),
      ...kept.filter((k) => k.to <= value.length).map((k) => ({ from: k.from, to: k.to, mark: 'kept' as const })),
    ].sort((a, b) => a.from - b.from);
    const out: Segment[] = [];
    let at = 0;
    for (const m of marks) {
      if (m.from < at) continue;
      if (m.from > at) out.push({ text: value.slice(at, m.from) });
      out.push({ text: value.slice(m.from, m.to), mark: m.mark, span: { from: m.from, to: m.to } });
      at = m.to;
    }
    out.push({ text: value.slice(at) });
    return out;
  });

  /** The field's box and text style, copied onto the layer. */
  let box = $state('');
  /** How far a one-line field has scrolled its text. */
  let scrollX = $state(0);

  const COPIED = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'text-indent',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'box-sizing',
  ];

  function measure() {
    if (!field) return;
    const css = getComputedStyle(field);
    const style = COPIED.map((p) => `${p}:${css.getPropertyValue(p)}`);
    style.push(
      `left:${field.offsetLeft}px`,
      `top:${field.offsetTop}px`,
      `width:${field.offsetWidth}px`,
      `height:${field.offsetHeight}px`,
      `white-space:${field instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre'}`,
    );
    box = style.join(';');
    scrollX = field.scrollLeft;
  }

  // Follow the field's size (wrapping, a resized window) and its scrolling.
  $effect(() => {
    const f = field;
    if (!f) return;
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(f);
    const follow = () => requestAnimationFrame(() => (scrollX = f.scrollLeft));
    const events = ['scroll', 'input', 'keyup', 'select', 'focus'];
    for (const e of events) f.addEventListener(e, follow);
    void document.fonts?.ready.then(measure);
    return () => {
      watch.disconnect();
      for (const e of events) f.removeEventListener(e, follow);
    };
  });

  // A changed title can change the field's height before the observer sees it.
  $effect(() => {
    void value;
    requestAnimationFrame(measure);
  });

  /** Keep focus and the caret in the field: the click is on the layer, not a move out of the title. */
  function hold(e: Event) {
    e.preventDefault();
    if (field && document.activeElement !== field) field.focus({ preventScroll: true });
  }
</script>

<div class="layer" aria-hidden="true" style={box}>
  <!-- A mouse or touch shortcut only: from the keyboard, quotes keep a word as text, so the layer stays hidden from assistive tech. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="text" class:wrap={field instanceof HTMLTextAreaElement} style="transform: translateX({-scrollX}px)">
    {#each segments as seg, i (i)}{#if seg.mark}<span
          class={seg.mark}
          title={seg.mark === 'read' ? 'Click to keep as text' : 'Click to read it again'}
          onpointerdown={hold}
          onmousedown={hold}
          onclick={() => ontoggle(seg.span!, seg.mark === 'read')}>{seg.text}</span
        >{:else}{seg.text}{/if}{/each}
  </div>
</div>

<style>
  .layer {
    position: absolute;
    overflow: hidden;
    pointer-events: none;
    border-style: solid;
    border-color: transparent;
    color: transparent;
    z-index: 1;
  }
  .text.wrap {
    overflow-wrap: anywhere;
  }
  span {
    pointer-events: auto;
    cursor: pointer;
    border-radius: 3px;
  }
  .read {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .kept {
    text-decoration: underline dotted;
    text-decoration-color: var(--text-3);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 3px;
  }
</style>
