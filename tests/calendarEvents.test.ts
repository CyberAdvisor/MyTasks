/**
 * Calendar events (FR-21.2 to FR-21.4, Milestone 13): checking calendar.json,
 * which day each event is on, the wording of the list and details, the
 * calendar file through a sync (one request, kept on the device, cleared by
 * Disconnect), and the synced setting with its schema version (10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import Dexie from 'dexie';
import { MyTasksDB, SCHEMA_VERSION, db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo } from '../src/lib/db/history';
import {
  alertLine,
  attendeeRows,
  attendeeSummary,
  dateLine,
  eventsOn,
  firstLine,
  hasEventsIn,
  periodLines,
  isEnded,
  listTime,
  readCalendar,
  safeLink,
  timeLine,
  travelLine,
  NO_COLOR,
  type CalendarData,
  type CalendarEvent,
} from '../src/lib/calendar/events';
import { calendar, receiveCalendar, showSavedCalendar } from '../src/lib/calendar/calendar';
import { deriveKey, seal } from '../src/lib/sync/crypto';
import { SyncError, checkList, syncOnce } from '../src/lib/sync/cycle';
import { clearConfig, loadCalendarFile, type DeviceConfig } from '../src/lib/sync/device';
import { createList } from '../src/lib/sync/setup';
import { sync } from '../src/lib/sync/sync.svelte';
import { readSettings } from '../src/lib/model/settings';
import { FakeGitHub } from './fakeGitHub';

/** A local time on 2026-11-19 (or `days` later) as the UTC timestamp the helper writes. */
function at(hours: number, minutes = 0, days = 0): string {
  return new Date(2026, 10, 19 + days, hours, minutes).toISOString();
}

const DAY = '2026-11-19';

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: 'e', calendar: 'work', title: 'Event', allDay: false, start: at(10), end: at(11), ...over };
}

function data(events: CalendarEvent[]): CalendarData {
  return { from: DAY, to: '2026-12-02', calendars: [{ id: 'work', title: 'Work', color: '#1badf8' }], events };
}

describe('checking calendar.json (FR-21.2)', () => {
  const file = (over: object = {}) => ({ format: 1, from: DAY, to: '2026-12-02', calendars: [], events: [], ...over });

  it('accepts format 1 and refuses anything else', () => {
    expect(readCalendar(file())).toEqual({ from: DAY, to: '2026-12-02', calendars: [], events: [] });
    expect(readCalendar(file({ format: 2 }))).toBeNull();
    expect(readCalendar(file({ events: 'x' }))).toBeNull();
    expect(readCalendar(null)).toBeNull();
  });

  it('leaves out a bad event, drops bad optional fields, and keeps only #rrggbb colours', () => {
    const read = readCalendar(
      file({
        calendars: [
          { id: 'a', title: 'A', color: '#00ff00' },
          { id: 'b', title: 'B', color: 'red;background:url(x)' },
        ],
        events: [
          event({ location: 'Room 4' }),
          { ...event(), start: 'tomorrow' },
          { ...event(), allDay: true },
          { ...event(), travelMinutes: 'far', attendees: [{ name: 'Ana', status: 'accepted' }, { status: 'declined' }] },
          // A Mail link isn't a web link; two identical alerts are one.
          { ...event({ id: 'flight' }), url: 'message:%3Cabc@mail%3E', alerts: [{ before: 15 }, { before: 15 }, { before: 60 }] },
        ],
      }),
    )!;
    expect(read.calendars.map((c) => c.color)).toEqual(['#00ff00', NO_COLOR]);
    expect(read.events).toEqual([
      event({ location: 'Room 4' }),
      event({ attendees: [{ name: 'Ana', status: 'accepted' }] }),
      event({ id: 'flight', alerts: [{ before: 15 }, { before: 60 }] }),
    ]);
  });

  it('opens only http and https links', () => {
    expect(safeLink('https://example.com/meet')).toBe('https://example.com/meet');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('not a link')).toBeNull();
  });
});

describe('which day an event is on (FR-21.3)', () => {
  it('lists all-day events first, then by start time', () => {
    const events = [event({ id: 'late', start: at(14), end: at(15) }), event({ id: 'all', allDay: true, start: DAY, end: DAY }), event({ id: 'early', start: at(8), end: at(9) })];
    expect(eventsOn(data(events), DAY).map((e) => e.id)).toEqual(['all', 'early', 'late']);
  });

  it('puts an all-day event on each of its days, and a timed one on each day it overlaps', () => {
    const trip = event({ id: 'trip', allDay: true, start: DAY, end: '2026-11-21' });
    const late = event({ id: 'late', start: at(22), end: at(2, 0, 1) });
    const d = data([trip, late]);
    expect(eventsOn(d, '2026-11-20').map((e) => e.id)).toEqual(['trip', 'late']);
    expect(eventsOn(d, '2026-11-22')).toEqual([]);
    expect(hasEventsIn(d, '2026-11-21', '2026-11-25')).toBe(true);
    expect(hasEventsIn(d, '2026-11-22', '2026-11-25')).toBe(false);
    // An event ending at midnight isn't on the next day.
    expect(eventsOn(data([event({ start: at(23), end: at(0, 0, 1) })]), '2026-11-20')).toEqual([]);
  });

  it('dims an event once it has ended; an all-day one only after its last day', () => {
    const now = new Date(2026, 10, 19, 12);
    expect(isEnded(event({ start: at(8), end: at(9) }), now)).toBe(true);
    expect(isEnded(event({ start: at(11), end: at(13) }), now)).toBe(false);
    expect(isEnded(event({ allDay: true, start: DAY, end: DAY }), now)).toBe(false);
    expect(isEnded(event({ allDay: true, start: '2026-11-18', end: '2026-11-18' }), now)).toBe(true);
  });
});

describe("Scheduled's later groups (FR-21.6)", () => {
  it('lists each event once on its first day in the group, a repeating one with its count', () => {
    // From Nov 19: +8 is Nov 27, +10 is Nov 29, +15 is Dec 4. The group is Nov 27 to 30.
    const lines = periodLines(
      data([
        // Over several days, from before the group: listed on the group's first day.
        event({ id: 'trip', allDay: true, start: '2026-11-25', end: '2026-11-28' }),
        // Repeating (the same id on each occurrence): once, on the first, with the count.
        event({ id: 'yoga', start: at(18, 0, 10), end: at(19, 0, 10) }),
        event({ id: 'yoga', start: at(18, 0, 8), end: at(19, 0, 8) }),
        event({ id: 'dentist', start: at(9, 0, 8), end: at(10, 0, 8) }),
        event({ id: 'later', start: at(9, 0, 15), end: at(10, 0, 15) }),
      ]),
      '2026-11-27',
      '2026-11-30',
    );
    expect(lines.map((l) => [l.event.id, l.day, l.count])).toEqual([
      ['trip', '2026-11-27', 1],
      ['dentist', '2026-11-27', 1],
      ['yoga', '2026-11-27', 2],
    ]);
  });

  it('shows only the first line of a title with text', () => {
    expect(firstLine('\nFrontier\nDEN to TPA')).toBe('Frontier');
    expect(firstLine('Team planning')).toBe('Team planning');
    expect(firstLine(' \n ')).toBe('');
  });
});

describe('wording, in US English', () => {
  it('shows the start time in the list, and "Ends" on a later day', () => {
    const late = event({ start: at(22), end: at(2, 0, 1) });
    expect(listTime(late, DAY)).toBe('10:00 PM');
    expect(listTime(late, '2026-11-20')).toBe('Ends 2:00 AM');
    expect(listTime(event({ allDay: true, start: DAY, end: DAY }), DAY)).toBeNull();
  });

  it('gives the details panel its date and time lines', () => {
    expect(dateLine(event({ start: at(14), end: at(15, 30) }))).toBe('Thursday, Nov 19, 2026');
    expect(timeLine(event({ start: at(14), end: at(15, 30) }))).toBe('2:00 – 3:30 PM');
    expect(timeLine(event({ allDay: true, start: DAY, end: DAY }))).toBe('All day');
    expect(dateLine(event({ allDay: true, start: DAY, end: '2026-11-21' }))).toBe('Thu, Nov 19 – Sat, Nov 21');
    const late = event({ start: at(22), end: at(2, 0, 1) });
    expect(dateLine(late)).toBe('Thu, Nov 19, 10:00 PM – Fri, Nov 20, 2:00 AM');
    expect(timeLine(late)).toBeNull();
  });

  it('words alerts, travel time and attendees as the approved panel does', () => {
    const timed = event();
    expect(alertLine({ before: 15 }, timed)).toBe('15 minutes before');
    expect(alertLine({ before: 0 }, timed)).toBe('At time of event');
    expect(alertLine({ before: 90 }, timed)).toBe('1 hour 30 minutes before');
    expect(alertLine({ before: 1440 }, timed)).toBe('1 day before');
    const allDay = event({ allDay: true, start: DAY, end: DAY });
    expect(alertLine({ before: -540 }, allDay)).toBe('On the day at 9:00 AM');
    expect(alertLine({ before: 900 }, allDay)).toBe('1 day before at 9:00 AM');
    expect(travelLine(30)).toBe('30 min travel time');
    expect(travelLine(75)).toBe('1 hr 15 min travel time');

    const rows = attendeeRows(
      event({
        organizer: 'Ana',
        attendees: [
          { name: 'Ben', status: 'declined' },
          { name: 'Ana', status: 'accepted' },
          { name: 'Chloé', status: 'tentative' },
          { name: 'Dev', status: 'other' },
        ],
      }),
    );
    expect(rows.map((r) => [r.name, r.organizer])).toEqual([['Ana', true], ['Ben', false], ['Chloé', false], ['Dev', false]]);
    expect(attendeeSummary(rows)).toBe('4 attendees · 1 accepted, 1 declined, 1 maybe');
    // An organizer who isn't an attendee is still listed, first.
    expect(attendeeRows(event({ organizer: 'Eve' }))).toEqual([{ name: 'Eve', status: 'other', organizer: true }]);
  });
});

describe('the calendar file through a sync (FR-21.2)', () => {
  let gh: FakeGitHub;
  const ACK = { at: '2026-11-12T20:00:00.000Z', limitationsUpdated: '2026-11-12' };
  const CAL = { format: 1, from: DAY, to: '2026-12-02', calendars: [{ id: 'work', title: 'Work', color: '#1badf8' }], events: [event()] };

  beforeEach(async () => {
    await db.delete();
    await db.open();
    await clearConfig();
    clearUndo();
    gh = new FakeGitHub();
    vi.stubGlobal('fetch', gh.fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** calendar.json as the helper writes it, sealed with `passphrase` and `salt`. */
  async function calendarFile(config: DeviceConfig, contents: object = CAL, passphrase = 'correct horse', salt = config.salt): Promise<string> {
    const key = await deriveKey(passphrase, salt, config.iterations);
    const env = await seal(key, { salt, iterations: config.iterations }, JSON.stringify(contents), '2026-11-19T18:39:16.567Z');
    return JSON.stringify({ ...env, app: 'mytasks-calendar' });
  }

  it('comes with the tasks in one request, is kept on the device, and an unchanged file isn\'t opened again', async () => {
    const config = await createList('good', 'correct horse', ACK);
    const file = await calendarFile(config);
    gh.gists.get(config.gistId)!.files['calendar.json'] = { content: file };
    gh.reads = 0;
    const received: (string | null)[] = [];
    await syncOnce(config, async (f) => void received.push(f));
    expect(received).toEqual([file]);
    expect(gh.reads).toBe(1);

    await receiveCalendar(config, file);
    expect(get(calendar)).toMatchObject({ updatedAt: '2026-11-19T18:39:16.567Z', problem: null });
    expect(get(calendar).data!.events).toEqual([event()]);
    expect(await loadCalendarFile()).toBe(file);
    // The same file with a key that can't open it: not opened again, so still shown.
    const wrongKey = await deriveKey('wrong', config.salt, config.iterations);
    await receiveCalendar({ ...config, key: wrongKey }, file);
    expect(get(calendar).data!.events).toHaveLength(1);
  });

  it('shows the saved file at launch, and none once the gist has none', async () => {
    const config = await createList('good', 'correct horse', ACK);
    await receiveCalendar(config, await calendarFile(config));
    await receiveCalendar(config, null);
    expect(get(calendar)).toEqual({ data: null, updatedAt: null, problem: null });
    expect(await loadCalendarFile()).toBeNull();
    await receiveCalendar(config, await calendarFile(config));
    await showSavedCalendar(config);
    expect(get(calendar).data!.events).toHaveLength(1);
  });

  it('reports a file from another passphrase or one it can\'t read, without failing the sync', async () => {
    const config = await createList('good', 'correct horse', ACK);
    await receiveCalendar(config, await calendarFile(config, CAL, 'another passphrase', 'AAAAAAAAAAAAAAAAAAAAAA=='));
    expect(get(calendar)).toMatchObject({ data: null, problem: 'passphrase' });
    await receiveCalendar(config, await calendarFile(config, { format: 2 }));
    expect(get(calendar)).toMatchObject({ data: null, problem: 'unreadable' });
    await receiveCalendar(config, 'not json');
    expect(get(calendar)).toMatchObject({ data: null, problem: 'unreadable' });
    gh.gists.get(config.gistId)!.files['calendar.json'] = { content: 'not json' };
    await expect(syncOnce(config, (f) => receiveCalendar(config, f))).resolves.toBeDefined();
  });

  it('Disconnect removes the saved calendar file', async () => {
    const config = await createList('good', 'correct horse', ACK);
    sync.connected(config);
    await receiveCalendar(config, await calendarFile(config));
    await sync.disconnect();
    await db.open();
    expect(await loadCalendarFile()).toBeNull();
  });
});

describe('Show Calendar Events, a synced setting (schema 10)', () => {
  it('is on by default, and syncs', async () => {
    expect(readSettings([]).showCalendarEvents).toBe(true);
    expect(readSettings([{ key: 'showCalendarEvents', value: false }]).showCalendarEvents).toBe(false);
  });

  it('is schema 10 or later: a list from version 9 is upgraded, one from a later version refused', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(10);
    const tables = { areas: [], projects: [], headings: [], todos: [], checklistItems: [], tags: [], contexts: [], savedSearches: [] };
    expect(checkList({ app: 'mytasks', schema: 9, tables, settings: [] })).toMatchObject({ schema: SCHEMA_VERSION, upgradedFrom: 9 });
    expect(() => checkList({ app: 'mytasks', schema: SCHEMA_VERSION + 1, tables, settings: [] })).toThrow(SyncError);
  });

  it('upgrades a version-9 database with data in it, the setting keeping its value', async () => {
    const name = 'upgrade-to-10';
    const old = new Dexie(name);
    old.version(9).stores({
      areas: 'id, sortKey',
      projects: 'id, areaId, status, sortKey',
      headings: 'id, projectId, sortKey',
      todos: 'id, projectId, areaId, headingId, status, startDate, deadline, sortKey, contextId',
      checklistItems: 'id, todoId, sortKey',
      tags: 'id, parentTagId, sortKey',
      savedSearches: 'id, sortKey',
      changeLog: '++seq, entity, entityId, at',
      settings: 'key',
      contexts: 'id, sortKey',
    });
    await old.open();
    await old.table('todos').add({ id: 't', title: 'Kept' });
    await old.table('settings').add({ key: 'todayGrouping', value: 'project' });
    old.close();

    const upgraded = new MyTasksDB(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(SCHEMA_VERSION);
    expect(await upgraded.todos.get('t')).toEqual({ id: 't', title: 'Kept' });
    const settings = readSettings(await upgraded.settings.toArray());
    expect(settings).toMatchObject({ todayGrouping: 'project', showCalendarEvents: true });
    upgraded.close();
    await Dexie.delete(name);
  });

  it('can be turned off on this device', async () => {
    await repo.setSetting('showCalendarEvents', false);
    expect(readSettings(await db.settings.toArray()).showCalendarEvents).toBe(false);
  });
});
