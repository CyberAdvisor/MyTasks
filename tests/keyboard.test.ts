/**
 * Keyboard bindings, type-ahead after New Task, and inline New Task (Section 7, FR-1.1).
 */
import { describe, expect, it } from 'vitest';

describe('keyboard bindings (Section 7)', async () => {
  const { KeyResolver, BINDINGS, formatKeys, keysFor } = await import('../src/lib/shortcuts');
  type Ctx = Parameters<InstanceType<typeof KeyResolver>['resolve']>[1];

  /** A key event; letters and digits get their physical code. */
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    code: /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^\d$/.test(k) ? `Digit${k}` : k === ' ' ? 'Space' : k === '/' || k === '?' ? 'Slash' : '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });
  const app: Ctx = { focus: 'none', standalone: true, mac: true, now: 0 };
  const tab: Ctx = { ...app, standalone: false };
  const run = (e: ReturnType<typeof key>, ctx: Ctx) => new KeyResolver().resolve(e, ctx);
  const cmd = (c: string) => ({ command: c });

  it('uses the full bindings in the installed app', () => {
    expect(run(key('n', { metaKey: true }), app)).toEqual(cmd('new-todo'));
    expect(run(key('k', { metaKey: true }), app)).toEqual(cmd('complete'));
    expect(run(key('k', { metaKey: true, altKey: true, code: 'KeyK' }), app)).toEqual(cmd('cancel'));
    expect(run(key('N', { metaKey: true, shiftKey: true }), app)).toEqual(cmd('new-heading'));
    expect(run(key('2', { metaKey: true }), app)).toEqual(cmd('go-today'));
    expect(run(key('g', { metaKey: true }), app)).toEqual(cmd('cycle-grouping'));
  });

  it('uses Ctrl for Mod away from Apple devices', () => {
    const win = { ...app, mac: false };
    expect(run(key('n', { ctrlKey: true }), win)).toEqual(cmd('new-todo'));
    expect(run(key('n', { metaKey: true }), win)).toBeNull();
  });

  it('uses the fallback keys in a browser tab', () => {
    expect(run(key('n', { metaKey: true }), tab)).toBeNull();
    expect(run(key('n'), tab)).toEqual(cmd('new-todo'));
    expect(run(key('x'), tab)).toEqual(cmd('complete'));
    expect(run(key('X', { shiftKey: true }), tab)).toEqual(cmd('cancel'));
    expect(run(key('#', { shiftKey: true }), tab)).toEqual(cmd('tags'));
    // Opt+H types a character on a Mac; the physical key still counts.
    expect(run(key('˙', { altKey: true, code: 'KeyH' }), tab)).toEqual(cmd('new-heading'));
  });

  it('keeps Quick Entry on Ctrl+Space and Cmd+Shift+Space, freeing Cmd+Shift+N', () => {
    expect(run(key(' ', { ctrlKey: true }), { ...app, focus: 'text' })).toEqual(cmd('quick-entry'));
    expect(run(key(' ', { metaKey: true, shiftKey: true }), tab)).toEqual(cmd('quick-entry'));
  });

  it('runs "G then letter" sequences in a tab', () => {
    const r = new KeyResolver();
    expect(r.resolve(key('g'), { ...tab, now: 0 })).toEqual({ pending: true });
    expect(r.resolve(key('i'), { ...tab, now: 500 })).toEqual(cmd('go-inbox'));
    expect(r.resolve(key('g'), { ...tab, now: 1000 })).toEqual({ pending: true });
    expect(r.resolve(key('g'), { ...tab, now: 1200 })).toEqual(cmd('cycle-grouping'));
    // Too slow: the second key is read on its own (T is Today for the selection).
    expect(r.resolve(key('g'), { ...tab, now: 3000 })).toEqual({ pending: true });
    expect(r.resolve(key('t'), { ...tab, now: 9000 })).toEqual(cmd('today'));
  });

  it('reads the key after G as part of the sequence, even when it is a command itself', () => {
    const pairs: [string, string][] = [
      ['i', 'go-inbox'],
      ['t', 'go-today'],
      ['s', 'go-scheduled'],
      ['u', 'go-unscheduled'],
      ['d', 'go-deferred'],
      ['c', 'go-logbook'],
      ['g', 'cycle-grouping'],
    ];
    const r = new KeyResolver();
    let now = 0;
    for (const [second, command] of pairs) {
      expect(r.resolve(key('g'), { ...tab, now: (now += 2000) })).toEqual({ pending: true });
      expect(r.resolve(key(second), { ...tab, now: now + 300 })).toEqual(cmd(command));
    }
    // Without G first, T, U and D are still the item commands.
    expect(run(key('t'), tab)).toEqual(cmd('today'));
    expect(run(key('u'), tab)).toEqual(cmd('unscheduled'));
    expect(run(key('d'), tab)).toEqual(cmd('deadline'));
  });

  it('starts Quick Find by typing in the installed app only', () => {
    expect(run(key('a'), app)).toEqual({ find: 'a' });
    expect(run(key('T', { shiftKey: true }), { ...app, focus: 'row' })).toEqual({ find: 'T' });
    expect(run(key('a'), tab)).toBeNull();
    expect(run(key('/'), tab)).toEqual(cmd('find'));
    expect(run(key('f', { metaKey: true }), { ...tab, focus: 'text' })).toEqual(cmd('find'));
  });

  it('never fires single keys or Alt chords while typing (FR-7.2k, FR-14.6)', () => {
    const text = { ...tab, focus: 'text' as const };
    expect(run(key('x'), text)).toBeNull();
    expect(run(key('/'), text)).toBeNull();
    expect(run(key('1', { altKey: true }), { ...app, focus: 'text' })).toBeNull();
    expect(run(key('z', { metaKey: true }), { ...app, focus: 'text' })).toBeNull();
    expect(run(key('ArrowUp', { metaKey: true }), { ...app, focus: 'text' })).toBeNull();
    // Command chords still work.
    expect(run(key('k', { metaKey: true }), { ...app, focus: 'text' })).toEqual(cmd('complete'));
  });

  it('leaves Space, Enter and the arrows to other focused controls', () => {
    const other = { ...app, focus: 'other' as const };
    expect(run(key(' '), other)).toBeNull();
    expect(run(key('Enter'), other)).toBeNull();
    expect(run(key('ArrowDown'), other)).toBeNull();
    expect(run(key('ArrowDown'), { ...app, focus: 'row' })).toEqual(cmd('select-next'));
    expect(run(key(' '), app)).toEqual(cmd('new-todo'));
  });

  it('selects several tasks with Shift+arrows and Cmd+A, and Escape keeps one (FR-10.1)', () => {
    const row = { ...app, focus: 'row' as const };
    expect(run(key('ArrowDown', { shiftKey: true }), row)).toEqual(cmd('extend-next'));
    expect(run(key('ArrowUp', { shiftKey: true }), tab)).toEqual(cmd('extend-prev'));
    expect(run(key('a', { metaKey: true }), row)).toEqual(cmd('select-all'));
    expect(run(key('a', { ctrlKey: true }), { ...tab, mac: false })).toEqual(cmd('select-all'));
    expect(run(key('Escape'), row)).toEqual(cmd('collapse-selection'));
    // Typing keeps its own Select All and Escape.
    const text = { ...app, focus: 'text' as const };
    expect(run(key('a', { metaKey: true }), text)).toBeNull();
    expect(run(key('Escape'), text)).toBeNull();
    expect(formatKeys('Shift+Down', true)).toBe('⇧↓');
  });

  it('sets priority with Opt+digit and moves items with Cmd+arrows', () => {
    expect(run(key('¡', { altKey: true, code: 'Digit1' }), app)).toEqual(cmd('priority-1'));
    expect(run(key('º', { altKey: true, code: 'Digit0' }), tab)).toEqual(cmd('priority-0'));
    expect(run(key('ArrowUp', { metaKey: true }), app)).toEqual(cmd('move-up'));
    expect(run(key('z', { metaKey: true }), tab)).toEqual(cmd('undo'));
    expect(run(key('z', { metaKey: true, shiftKey: true }), app)).toEqual(cmd('redo'));
    expect(run(key('?', { metaKey: true, shiftKey: true }), app)).toEqual(cmd('help'));
    expect(run(key('?', { shiftKey: true }), tab)).toEqual(cmd('help'));
  });

  it('gives every command a key in both modes, except Trash in a tab', () => {
    for (const b of BINDINGS) {
      expect(keysFor(b, true).length, b.command).toBeGreaterThan(0);
      if (b.command !== 'go-trash') expect(keysFor(b, false).length, b.command).toBeGreaterThan(0);
    }
  });

  it('shows keys the way each platform writes them', () => {
    expect(formatKeys('Mod+Shift+N', true)).toBe('⇧⌘N');
    expect(formatKeys('Mod+Shift+N', false)).toBe('Ctrl+Shift+N');
    expect(formatKeys('Mod+Shift+/', true)).toBe('⌘?');
    expect(formatKeys('G I', false)).toBe('G then I');
    expect(formatKeys('Alt+1', true)).toBe('⌥1');
  });
});

describe('type-ahead after New Task (FR-1.1)', async () => {
  const { typeAheadKey } = await import('../src/lib/shortcuts');
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, ...mods });

  it('adds printable characters, capitals, spaces and Opt characters', () => {
    const typed = ['B', 'u', 'y', ' ', 'é', '€'].reduce((t, k) => typeAheadKey(t, key(k)), '');
    expect(typed).toBe('Buy é€');
  });

  it('removes the last character with Backspace, even an emoji', () => {
    expect(typeAheadKey('ab', key('Backspace'))).toBe('a');
    expect(typeAheadKey('a😀', key('Backspace'))).toBe('a');
    expect(typeAheadKey('', key('Backspace'))).toBe('');
  });

  it('ignores Cmd and Ctrl chords and named keys', () => {
    for (const k of [key('z', { metaKey: true }), key('a', { ctrlKey: true }), key('Enter'), key('Shift'), key('Dead'), key('ArrowLeft')]) {
      expect(typeAheadKey('x', k)).toBe('x');
    }
  });
});

describe('inline New Task (FR-1.1)', async () => {
  const { inlineStart } = await import('../src/lib/actions');
  const { todo } = await import('./helpers');
  const ref = '2026-11-09';

  it('starts in the view, with no selection', () => {
    expect(inlineStart({ kind: 'list', list: 'today' }, ref)).toEqual({ startDate: ref });
    expect(inlineStart({ kind: 'project', id: 'p' }, ref)).toEqual({ projectId: 'p' });
  });

  it('joins the selected task\'s container, and its day in Scheduled', () => {
    const sel = todo({ projectId: 'p', headingId: 'h', startDate: '2026-11-12' });
    expect(inlineStart({ kind: 'list', list: 'today' }, ref, sel)).toMatchObject({ projectId: 'p', headingId: 'h', startDate: ref });
    expect(inlineStart({ kind: 'list', list: 'scheduled' }, ref, sel)).toMatchObject({ projectId: 'p', startDate: '2026-11-12' });
  });
});
