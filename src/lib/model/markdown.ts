/**
 * Light Markdown for notes (FR-7.4): bold, italic, bullet and numbered lists,
 * and links. Notes stay plain text; this only decides how a note is shown.
 *
 * The result is a small tree of blocks and inline pieces, which `NoteText.svelte`
 * draws as elements with their text escaped. Nothing here makes HTML, and a link
 * is kept only for http, https and mailto addresses, so a note can't run a script.
 *
 * Supported:
 * - `**bold**`, `*italic*` and `_italic_` (an underscore inside a word, as in
 *   snake_case, stays as typed);
 * - `[label](https://…)`, and bare `https://…`, `http://…`, `mailto:…` and
 *   `www.…` addresses;
 * - lines starting `- `, `* ` or `+ ` as a bullet list, `1. ` or `1) ` as a numbered
 *   list, starting at the first item's number;
 * - other lines as paragraphs, keeping their line breaks; a blank line ends one.
 * Anything else, headings included, shows as typed.
 */

/** An inline piece of a line. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] };

/** A block of a note: a paragraph's lines, or a list's items. */
export type Block =
  | { kind: 'p'; lines: Inline[][] }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'ol'; start: number; items: Inline[][] };

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;

/** The blocks of a note. */
export function parseNote(note: string): Block[] {
  const blocks: Block[] = [];
  let last: Block | null = null;
  for (const line of note.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet) {
      if (last?.kind !== 'ul') blocks.push((last = { kind: 'ul', items: [] }));
      last.items.push(parseInline(bullet[1]));
    } else if (numbered) {
      if (last?.kind !== 'ol') blocks.push((last = { kind: 'ol', start: Number(numbered[1]), items: [] }));
      last.items.push(parseInline(numbered[2]));
    } else if (line.trim() === '') {
      last = null;
    } else {
      if (last?.kind !== 'p') blocks.push((last = { kind: 'p', lines: [] }));
      last.lines.push(parseInline(line));
    }
  }
  return blocks;
}

/**
 * One pattern for every inline form, tried left to right; the first that matches
 * at a place wins. Groups: 1–2 a link's label and address, 3 bold, 4 and 5 italic,
 * 6 a bare address.
 */
const INLINE =
  /\[([^\]\n]+)\]\(([^()\s]+)\)|\*\*(?=\S)(.+?)(?<=\S)\*\*|(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])|(?<![\w_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w_])|((?:https?:\/\/|mailto:|www\.)[^\s<>]+)/g;

/** The inline pieces of a line. Links inside a link's label are left as text. */
export function parseInline(text: string, inLink = false): Inline[] {
  const out: Inline[] = [];
  const addText = (s: string) => {
    if (!s) return;
    const prev = out[out.length - 1];
    if (prev?.kind === 'text') prev.text += s;
    else out.push({ kind: 'text', text: s });
  };
  const re = new RegExp(INLINE.source, 'g');
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const [whole, label, address, bold, star, under, bare] = m;
    let piece: Inline | null = null;
    let used = whole;
    if (label !== undefined) {
      const href = inLink ? null : safeHref(address);
      if (href) piece = { kind: 'link', href, children: parseInline(label, true) };
    } else if (bold !== undefined) {
      piece = { kind: 'strong', children: parseInline(bold, inLink) };
    } else if (star !== undefined || under !== undefined) {
      piece = { kind: 'em', children: parseInline(star ?? under, inLink) };
    } else if (bare !== undefined && !inLink) {
      used = trimAddress(bare);
      const href = safeHref(used.startsWith('www.') ? `https://${used}` : used);
      if (href) piece = { kind: 'link', href, children: [{ kind: 'text', text: used }] };
    }
    if (!piece) {
      // Not a form we show: keep its first character as text and look again after it.
      re.lastIndex = m.index + 1;
      continue;
    }
    addText(text.slice(at, m.index));
    out.push(piece);
    at = m.index + used.length;
    re.lastIndex = at;
  }
  addText(text.slice(at));
  return out;
}

/**
 * Only the links in a line, for checklist items (FR-7.1): `[label](url)` and bare
 * addresses become links; everything else, `**` and `_` included, stays as typed.
 */
const LINKS = /\[([^\]\n]+)\]\(([^()\s]+)\)|((?:https?:\/\/|mailto:|www\.)[^\s<>]+)/g;

export function parseLinks(text: string): Inline[] {
  const out: Inline[] = [];
  const addText = (s: string) => {
    if (!s) return;
    const prev = out[out.length - 1];
    if (prev?.kind === 'text') prev.text += s;
    else out.push({ kind: 'text', text: s });
  };
  const re = new RegExp(LINKS.source, 'g');
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const [whole, label, address, bare] = m;
    const used = bare === undefined ? whole : trimAddress(bare);
    const href = bare === undefined ? safeHref(address) : safeHref(used.startsWith('www.') ? `https://${used}` : used);
    if (!href) {
      re.lastIndex = m.index + 1;
      continue;
    }
    addText(text.slice(at, m.index));
    out.push({ kind: 'link', href, children: [{ kind: 'text', text: label ?? used }] });
    at = m.index + used.length;
    re.lastIndex = at;
  }
  addText(text.slice(at));
  return out;
}

/** Whether a line has a link that `parseLinks` would make. */
export function hasLink(text: string): boolean {
  return parseLinks(text).some((p) => p.kind === 'link');
}

/** A bare address without the punctuation that usually ends the sentence around it. */
function trimAddress(address: string): string {
  let s = address.replace(/[.,;:!?'"*_]+$/, '');
  // A closing bracket belongs to the address only when it opened one.
  while (s.endsWith(')') && (s.match(/\(/g)?.length ?? 0) < (s.match(/\)/g)?.length ?? 0)) {
    s = s.slice(0, -1).replace(/[.,;:!?'"*_]+$/, '');
  }
  return s;
}

/** The address if it is an http, https or mailto link, else null. */
export function safeHref(address: string): string | null {
  try {
    const url = new URL(address);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname ? url.href : null;
    if (url.protocol === 'mailto:') return url.pathname ? url.href : null;
  } catch {
    // Not an absolute address.
  }
  return null;
}
