/**
 * Light Markdown in notes (FR-7.4): what `parseNote` and `parseInline` make of a note,
 * and that only http, https and mailto addresses become links.
 */
import { describe, expect, it } from 'vitest';
import { hasLink, parseInline, parseLinks, parseNote, safeHref, type Inline } from '../src/lib/model/markdown';

const text = (t: string): Inline => ({ kind: 'text', text: t });
const link = (href: string, label: string): Inline => ({ kind: 'link', href, children: [text(label)] });

describe('inline styles', () => {
  it('reads bold and italic, and nests them', () => {
    expect(parseInline('a **b** c')).toEqual([text('a '), { kind: 'strong', children: [text('b')] }, text(' c')]);
    expect(parseInline('*i* and _j_')).toEqual([
      { kind: 'em', children: [text('i')] },
      text(' and '),
      { kind: 'em', children: [text('j')] },
    ]);
    expect(parseInline('**bold _both_**')).toEqual([
      { kind: 'strong', children: [text('bold '), { kind: 'em', children: [text('both')] }] },
    ]);
  });

  it('leaves what only looks like a style as typed', () => {
    for (const s of ['snake_case_name', '2 * 3 * 4', 'a ** b', '* not a list here', 'price*2', '__init__']) {
      expect(parseInline(s), s).toEqual([text(s)]);
    }
  });

  it('reads links with a label, and bare addresses', () => {
    expect(parseInline('See [the doc](https://example.com/a?b=1) now')).toEqual([
      text('See '),
      link('https://example.com/a?b=1', 'the doc'),
      text(' now'),
    ]);
    expect(parseInline('Go to https://mytasks.fyi/guide/.')).toEqual([
      text('Go to '),
      link('https://mytasks.fyi/guide/', 'https://mytasks.fyi/guide/'),
      text('.'),
    ]);
    expect(parseInline('(www.example.com)')).toEqual([text('('), link('https://www.example.com/', 'www.example.com'), text(')')]);
    expect(parseInline('https://en.wikipedia.org/wiki/Tea_(meal)')).toEqual([
      link('https://en.wikipedia.org/wiki/Tea_(meal)', 'https://en.wikipedia.org/wiki/Tea_(meal)'),
    ]);
    expect(parseInline('mail mailto:me@example.com')).toEqual([text('mail '), link('mailto:me@example.com', 'mailto:me@example.com')]);
    expect(parseInline('**[bold link](https://a.example)**')).toEqual([
      { kind: 'strong', children: [link('https://a.example/', 'bold link')] },
    ]);
  });

  it('never makes a link of any other kind of address', () => {
    for (const s of [
      '[x](javascript:alert(1))',
      '[x](javascript:alert)',
      '[x](data:text/html,hi)',
      '[x](/relative)',
      '[x](vbscript:msgbox)',
      'javascript:alert(1)',
      '[x](https://)',
    ]) {
      const pieces = parseInline(s);
      expect(JSON.stringify(pieces), s).not.toContain('"link"');
      expect(pieces.map((p) => (p.kind === 'text' ? p.text : '')).join(''), s).toBe(s);
    }
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHref('https://example.com')).toBe('https://example.com/');
  });

  it('keeps no link inside a link’s label', () => {
    expect(parseInline('[see https://a.example](https://b.example)')).toEqual([link('https://b.example/', 'see https://a.example')]);
  });
});

describe('blocks', () => {
  it('makes paragraphs, keeping line breaks, and ends one at a blank line', () => {
    expect(parseNote('one\ntwo\n\nthree')).toEqual([
      { kind: 'p', lines: [[text('one')], [text('two')]] },
      { kind: 'p', lines: [[text('three')]] },
    ]);
  });

  it('makes bullet and numbered lists', () => {
    expect(parseNote('Pack:\n- socks\n* **passport**\n\n3. first\n4) second\nafter')).toEqual([
      { kind: 'p', lines: [[text('Pack:')]] },
      { kind: 'ul', items: [[text('socks')], [{ kind: 'strong', children: [text('passport')] }]] },
      { kind: 'ol', start: 3, items: [[text('first')], [text('second')]] },
      { kind: 'p', lines: [[text('after')]] },
    ]);
  });

  it('shows headings and other marks as typed, and an empty note as nothing', () => {
    expect(parseNote('# Title')).toEqual([{ kind: 'p', lines: [[text('# Title')]] }]);
    expect(parseNote('')).toEqual([]);
    expect(parseNote('\r\n\r\n')).toEqual([]);
  });
});

describe('links in checklist items', () => {
  it('makes only links, leaving style marks as typed', () => {
    expect(parseLinks('**Book** at https://example.com/a, then [pay](https://pay.example)')).toEqual([
      text('**Book** at '),
      link('https://example.com/a', 'https://example.com/a'),
      text(', then '),
      link('https://pay.example/', 'pay'),
    ]);
    expect(parseLinks('[x](javascript:alert(1)) _plain_')).toEqual([text('[x](javascript:alert(1)) _plain_')]);
    expect(hasLink('call www.example.com')).toBe(true);
    expect(hasLink('no links here')).toBe(false);
  });
});
