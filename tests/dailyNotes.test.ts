/**
 * Daily notes (FR-24.1): the notes file's checks and day-by-day merge, and
 * syncing it beside the tasks through a faked GitHub (tests/fakeGitHub.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo } from '../src/lib/db/history';
import { deriveKey, parseEnvelope, unseal } from '../src/lib/sync/crypto';
import { syncOnce } from '../src/lib/sync/cycle';
import { clearConfig, type DeviceConfig } from '../src/lib/sync/device';
import { createList, joinList } from '../src/lib/sync/setup';
import { FIRST_DB, setActiveDbName } from '../src/lib/gists/active';
import { roomWarning } from '../src/lib/model/limits';
import { asBullets, cleanNote, lostNotes, mergeNotes, readNotesFile, type DayNote } from '../src/lib/notes/model';
import { notesDb, readNotes, saveNote } from '../src/lib/notes/store';
import { notesProblem, rewriteNotes } from '../src/lib/notes/sync';
import { FakeGitHub } from './fakeGitHub';

const at = (hhmm: string) => `2026-11-27T${hhmm}:00.000Z`;
const note = (date: string, text: string, time: string): DayNote => ({ date, text, modifiedAt: at(time) });
const tomb = (date: string, time: string): DayNote => ({ date, text: '', modifiedAt: at(time), deletedAt: at(time) });

describe('the notes file (FR-24.1)', () => {
  it('accepts notes and tombstones, each day once', () => {
    const notes = [note('2026-11-26', '- Called Sam', '08:00'), tomb('2026-11-25', '09:00')];
    expect(readNotesFile({ format: 1, notes })).toEqual(notes);
    expect(readNotesFile({ format: 1, notes: [] })).toEqual([]);
  });

  it('refuses a file with anything wrong in it', () => {
    const ok = note('2026-11-26', '- x', '08:00');
    expect(readNotesFile({ format: 2, notes: [ok] })).toBeNull();
    expect(readNotesFile({ format: 1 })).toBeNull();
    expect(readNotesFile({ format: 1, notes: [ok, ok] })).toBeNull();
    expect(readNotesFile({ format: 1, notes: [{ ...ok, date: '2026-13-01' }] })).toBeNull();
    expect(readNotesFile({ format: 1, notes: [{ ...ok, modifiedAt: 'yesterday' }] })).toBeNull();
    expect(readNotesFile({ format: 1, notes: [{ ...ok, extra: 1 }] })).toBeNull();
    expect(readNotesFile({ format: 1, notes: [{ ...tomb('2026-11-26', '08:00'), text: 'left' }] })).toBeNull();
  });

  it('cleans blank bullets and shows every line as a bullet', () => {
    expect(cleanNote('- Called Sam\n- \n\n-   \nBought milk  ')).toBe('- Called Sam\nBought milk');
    expect(cleanNote('- \n')).toBe('');
    expect(asBullets('- Called Sam\nBought **milk**\n1. first')).toBe('- Called Sam\n- Bought **milk**\n1. first');
  });
});

describe('merging notes day by day', () => {
  it('keeps the later change, and pushes only what the gist lacks', () => {
    const r = mergeNotes([note('2026-11-26', 'mine', '09:00')], [note('2026-11-26', 'theirs', '10:00')], at('11:00'));
    expect(r.merged).toEqual([note('2026-11-26', 'theirs', '10:00')]);
    expect(r.toApply).toEqual([note('2026-11-26', 'theirs', '10:00')]);
    expect(r.pushNeeded).toBe(false);

    const back = mergeNotes([note('2026-11-26', 'mine', '10:30')], [note('2026-11-26', 'theirs', '10:00')], at('11:00'));
    expect(back.merged).toEqual([note('2026-11-26', 'mine', '10:30')]);
    expect(back.toApply).toEqual([]);
    expect(back.pushNeeded).toBe(true);
  });

  it('adds days each side lacks', () => {
    const r = mergeNotes([note('2026-11-25', 'a', '09:00')], [note('2026-11-26', 'b', '09:00')], at('11:00'));
    expect(r.merged.map((n) => n.date)).toEqual(['2026-11-25', '2026-11-26']);
    expect(r.toApply.map((n) => n.date)).toEqual(['2026-11-26']);
    expect(r.pushNeeded).toBe(true);
  });

  it('counts a time later than now as now', () => {
    const future = note('2026-11-26', 'clock ahead', '23:00');
    const r = mergeNotes([future], [note('2026-11-26', 'theirs', '10:30')], at('11:00'));
    // Both count as 11:00 or earlier: the gist's 10:30 loses to this device's "now".
    expect(r.merged[0].text).toBe('clock ahead');
  });

  it('drops tombstones past 180 days on both sides', () => {
    const old: DayNote = { date: '2026-01-02', text: '', modifiedAt: '2026-01-02T08:00:00.000Z', deletedAt: '2026-01-02T08:00:00.000Z' };
    const r = mergeNotes([old], [old], at('11:00'));
    expect(r.merged).toEqual([]);
    expect(r.toDrop).toEqual(['2026-01-02']);
    expect(r.pushNeeded).toBe(true);
  });

  it('finds this device’s notes another device’s later change replaced', () => {
    const mine = [note('2026-11-26', 'mine', '09:00'), note('2026-11-25', 'kept', '09:00')];
    const merged = [note('2026-11-26', 'theirs', '10:00'), note('2026-11-25', 'kept', '09:00')];
    expect(lostNotes(mine, merged, at('08:00'))).toEqual(['2026-11-26']);
    // A change from before the last sync read this device was already in the gist.
    expect(lostNotes(mine, merged, at('09:30'))).toEqual([]);
  });
});

let gh: FakeGitHub;
const ACK = { at: '2026-11-12T20:00:00.000Z', limitationsUpdated: '2026-11-12' };

/** Start over as a new device: no tasks, no notes, not connected. */
async function newDevice(): Promise<void> {
  await db.delete();
  await db.open();
  await notesDb.delete();
  await notesDb.open();
  await clearConfig();
}

/** The gist's notes, decrypted with `config`'s key. */
async function gistNotes(config: DeviceConfig): Promise<DayNote[]> {
  const file = gh.file(config.gistId, 'notes.json');
  if (!file) throw new Error('no notes.json');
  const env = parseEnvelope(file, 'mytasks-notes')!;
  return (JSON.parse(await unseal(config.key, env)) as { notes: DayNote[] }).notes;
}

/** Sync and keep the mark, as the engine does. */
async function synced(config: DeviceConfig): Promise<DeviceConfig> {
  return { ...config, lastSync: await syncOnce(config), lastSyncedAt: new Date().toISOString() };
}

beforeEach(async () => {
  setActiveDbName(FIRST_DB);
  await newDevice();
  clearUndo();
  gh = new FakeGitHub();
  vi.stubGlobal('fetch', gh.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('syncing daily notes (FR-24.1)', () => {
  it('writes nothing for notes until there is one', async () => {
    let config = await createList('good', 'correct horse', ACK);
    await repo.createTodo({ title: 'a task' });
    config = await synced(config);
    expect(gh.file(config.gistId, 'notes.json')).toBeUndefined();
    expect(config.lastSync?.notes).toBeUndefined();
  });

  it('takes a note to another device, encrypted, leaving the tasks file alone', async () => {
    let a = await createList('good', 'correct horse', ACK);
    await saveNote('2026-11-27', '- Recorded the intro\n- ');
    a = await synced(a);
    const tasksFile = gh.file(a.gistId)!;
    await expect(gistNotes(a)).resolves.toEqual([expect.objectContaining({ date: '2026-11-27', text: '- Recorded the intro' })]);
    expect(gh.file(a.gistId, 'notes.json')).not.toContain('Recorded');
    expect(JSON.parse(await unseal(a.key, parseEnvelope(tasksFile)!)).schema).toBe(15);

    await newDevice();
    const b = await joinList('good', a.gistId, 'correct horse', ACK);
    await syncOnce(b);
    expect((await readNotes()).map((n) => n.text)).toEqual(['- Recorded the intro']);
  });

  it('doesn’t write an unchanged notes file again', async () => {
    let config = await createList('good', 'correct horse', ACK);
    await saveNote('2026-11-27', '- one');
    config = await synced(config);
    const writes = gh.writes;
    config = await synced(config);
    expect(gh.writes).toBe(writes);
    await saveNote('2026-11-27', '- one\n- two');
    config = await synced(config);
    expect(gh.writes).toBe(writes + 1);
    expect((await gistNotes(config))[0].text).toBe('- one\n- two');
  });

  it('clears a note on every device', async () => {
    let a = await createList('good', 'correct horse', ACK);
    await saveNote('2026-11-27', '- to clear');
    a = await synced(a);
    await saveNote('2026-11-27', '- ');
    a = await synced(a);
    expect(await gistNotes(a)).toEqual([expect.objectContaining({ date: '2026-11-27', text: '', deletedAt: expect.any(String) })]);
    await newDevice();
    const b = await joinList('good', a.gistId, 'correct horse', ACK);
    await syncOnce(b);
    expect((await readNotes()).filter((n) => !n.deletedAt)).toEqual([]);
  });

  it('never writes over a notes file it can’t read, and still syncs the tasks', async () => {
    let config = await createList('good', 'correct horse', ACK);
    await saveNote('2026-11-27', '- mine');
    config = await synced(config);
    gh.gists.get(config.gistId)!.files['notes.json'].content = '{"app":"mytasks-notes"}';
    await saveNote('2026-11-27', '- changed');
    await repo.createTodo({ title: 'still syncs' });
    config = await synced(config);
    expect(get(notesProblem)).toBe('unreadable');
    expect(gh.file(config.gistId, 'notes.json')).toBe('{"app":"mytasks-notes"}');
    expect(gh.file(config.gistId)).toBeDefined();
  });

  it('tells the device whose note another device replaced', async () => {
    let a = await createList('good', 'correct horse', ACK);
    await saveNote('2026-11-27', '- start');
    a = await synced(a);
    const aNotes = await readNotes();
    // Another device changes the same day's note later, and syncs first.
    await newDevice();
    let b = await joinList('good', a.gistId, 'correct horse', ACK);
    b = await synced(b);
    await new Promise((r) => setTimeout(r, 10));
    await saveNote('2026-11-27', '- from B');
    const bTime = Date.parse((await readNotes())[0].modifiedAt);
    await synced(b);
    // Back to the first device, which changed it too after its last sync, but before B did.
    await notesDb.notes.clear();
    await notesDb.notes.bulkPut(aNotes.map((n) => ({ ...n, text: '- from A', modifiedAt: new Date(bTime - 2).toISOString() })));
    const lost: string[] = [];
    await syncOnce({ ...a, lastSync: { ...a.lastSync!, readAt: aNotes[0].modifiedAt } }, async () => {}, (l) => lost.push(...l.map((c) => `${c.kind}:${c.id}:${c.title}`)));
    expect(lost).toEqual(['note:2026-11-27:Daily note, Fri, Nov 27']);
    expect((await readNotes())[0].text).toBe('- from B');
  });

  it('rewrites the notes with a new passphrase', async () => {
    let config = await createList('good', 'correct horse', ACK);
    await saveNote('2026-11-27', '- secret');
    config = await synced(config);
    const salt = 'AAAAAAAAAAAAAAAAAAAAAA==';
    const next = { ...config, salt, key: await deriveKey('new passphrase!', salt) };
    await rewriteNotes(next);
    expect((await gistNotes(next))[0].text).toBe('- secret');
  });
});

describe('the room warning with daily notes', () => {
  it('warns of a notes file near 5 MB, alone or with the tasks', () => {
    const mb = (n: number) => Math.round(n * 1024 * 1024);
    expect(roomWarning(10, mb(1), mb(1))).toBeNull();
    expect(roomWarning(10, mb(1), mb(4.6))).toBe('Your daily notes are 4.6 MB of 5 MB.');
    expect(roomWarning(10, mb(4.6), mb(4.7))).toBe('Your gist is 4.6 MB of 5 MB · daily notes 4.7 MB of 5 MB.');
    expect(roomWarning(10, mb(4.6), null)).toBe('Your gist is 4.6 MB of 5 MB.');
  });
});
