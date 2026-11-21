#!/usr/bin/env python3
"""
Export Things 3 to a My Tasks import file (FR-12.10, Milestone 12).

Reads Things' own database read-only and writes a CSV file in the format of
the website's Import page (mytasks.fyi/import/): areas, projects, headings,
open tasks with their checklists, tags, notes, dates, and repeating to-dos
and projects.
Open items only. Then, in My Tasks: Settings > Import From Other Apps.

    python3 things_export.py                # writes "Things export YYYY-MM-DD.csv" here
    python3 things_export.py --db COPY      # read a copy of main.sqlite instead
    python3 things_export.py --out FILE.csv

Only Python's standard library is used, and nothing in Things is changed.
macOS asks once to let Terminal read Things' data; allow it, or give
Terminal Full Disk Access, or copy the database and use --db.

Left out, and why:
- Things' copies of repeating to-dos and projects: My Tasks makes its own
  copies from the repeating to-do or project, so they would be duplicates.
  An open copy still sets where the repeat starts: the template's first date
  is the earliest open copy's start date, so a copy in Today comes across
  as today's copy (Things' next date is the one after it).

How Things stores things (checked in Things 3.23, database version 29,
conv. 2026-11-18-A and 2026-11-19):
- TMTask holds to-dos (type 0), projects (1) and headings (2); status 0 is
  open, 2 canceled, 3 completed.
- start: 0 Inbox, 1 Anytime (Today when its start date has come),
  2 Someday (Upcoming when it has a start date).
- Dates (startDate, deadline, rt1_nextInstanceStartDate) are packed
  numbers: year << 16 | month << 12 | day << 7.
- A repeating to-do's rule (rt1_recurrenceRule) is a property list:
  tp 0 on a schedule, 1 after completion; fu the unit (16 day, 256 week,
  8 month, 4 year); fa the interval; of the days: wd a weekday (0 Sunday),
  wdo its place in the month (-1 last), dy a day of the month counted from
  0 (-1 last), mo a month counted from 0; rc an end count (0 none); ed an
  end date (Unix time; the year 4001 means never); ts how many days the
  copy starts before its deadline (negative). Its copies point to it with
  rt1_repeatingTemplate.
- A repeating project (checked conv. 2026-11-20-A) stores its rule the same
  way. Making a project repeat turns it into the first copy and adds a new
  record as the template, in Someday with no start date, with its own
  headings and to-dos; the template's next date is rt1_nextInstanceStartDate
  (or rt1_instanceCreationStartDate). Copies point to it with
  rt1_repeatingTemplate, as for to-dos.
- TMChecklistItem: status 3 (or 2) is ticked; ordered by index.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import glob
import os
import plistlib
import re
import sqlite3
import sys

GROUP = '~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac'
DB_GLOB = 'ThingsData-*/Things Database.thingsdatabase/main.sqlite'

# The import template's columns, in its order (site/assets/import/mytasks-import-template.csv).
COLUMNS = [
    'type', 'id', 'parent_id', 'title', 'notes', 'area', 'project', 'heading', 'tags', 'start', 'start_date',
    'deadline', 'priority', 'context', 'checked', 'status', 'completed_date', 'created_date', 'repeat',
    'repeat_every', 'repeat_unit', 'repeat_weekdays', 'repeat_month_day', 'repeat_month', 'repeat_first',
    'repeat_ends_after', 'repeat_ends_on', 'repeat_deadline', 'repeat_start_early', 'repeat_paused',
]

UNITS = {16: 'day', 256: 'week', 8: 'month', 4: 'year'}
DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
ORDINALS = {1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', -1: 'last'}
# Things writes this end date (the year 4001) on a repeat that never ends.
NEVER = 64092211200


class ExportError(Exception):
    """A problem to show the user, without a traceback."""


def find_database() -> str:
    """Things' database, in its group container."""
    found = glob.glob(os.path.join(os.path.expanduser(GROUP), DB_GLOB))
    if not found:
        raise ExportError('Things’ database wasn’t found. Is Things 3 installed on this Mac?')
    return found[0]


def open_read_only(path: str) -> sqlite3.Connection:
    """Open the database without any chance of changing it."""
    try:
        con = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
        con.execute('select 1 from TMTask limit 1')
    except sqlite3.Error as e:
        if 'unable to open' in str(e) or 'authorization' in str(e) or 'not authorized' in str(e):
            raise ExportError(
                'macOS didn’t let Terminal read Things’ data. Allow it when macOS asks, or give Terminal '
                'Full Disk Access (System Settings > Privacy & Security), or copy the database and use --db.'
            ) from e
        raise ExportError(f'Things’ database couldn’t be read: {e}') from e
    con.row_factory = sqlite3.Row
    return con


def packed_date(v) -> str:
    """A Things date number as YYYY-MM-DD, or '' for none."""
    if not v:
        return ''
    return f'{v >> 16:04d}-{(v >> 12) & 0xF:02d}-{(v >> 7) & 0x1F:02d}'


def unix_date(t) -> str:
    """A Unix time as a local YYYY-MM-DD, or '' for none."""
    if not t:
        return ''
    return dt.datetime.fromtimestamp(t).date().isoformat()


_TAG = re.compile(r'<[^>]+>')


def plain_notes(v) -> str:
    """Notes as plain text. Newer Things versions may keep them as a small XML document."""
    if not v:
        return ''
    if isinstance(v, bytes):
        v = v.decode('utf-8', 'replace')
    v = v.strip()
    if v.startswith('<?xml') or v.startswith('<note'):
        v = _TAG.sub('', v.replace('</p>', '\n').replace('<br/>', '\n'))
        v = v.replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&apos;', "'").replace('&amp;', '&')
    return v.strip()


def repeat_columns(blob, next_date: str, paused, has_deadline: bool) -> dict:
    """The import file's repeat columns from a Things rule. Raises ExportError for a rule it can't express."""
    rule = plistlib.loads(blob)
    unit = UNITS.get(rule.get('fu'))
    if unit is None:
        raise ExportError(f'an unknown repeat unit ({rule.get("fu")})')
    cols = {
        'repeat': 'after_completion' if rule.get('tp') == 1 else 'regularly',
        'repeat_every': str(rule.get('fa') or 1),
        'repeat_unit': unit,
        'repeat_first': next_date,
        'repeat_paused': 'yes' if paused else '',
    }
    if cols['repeat'] == 'regularly':
        weekdays, days, months = [], [], set()
        for o in rule.get('of') or []:
            if 'mo' in o:
                months.add(o['mo'] + 1)
            if unit == 'week' and 'wd' in o:
                weekdays.append(DAYS[o['wd']])
            elif 'wd' in o:
                days.append(f'{ORDINALS.get(o.get("wdo", 1), "1st")} {DAYS[o["wd"]]}')
            elif 'dy' in o:
                days.append('last' if o['dy'] == -1 else str(o['dy'] + 1))
        if weekdays:
            cols['repeat_weekdays'] = ';'.join(weekdays)
        if days and unit in ('month', 'year'):
            cols['repeat_month_day'] = ';'.join(days)
        if months and unit == 'year':
            cols['repeat_month'] = MONTHS[min(months) - 1]
        if rule.get('rc'):
            cols['repeat_ends_after'] = str(rule['rc'])
        elif rule.get('ed') and rule['ed'] < NEVER:
            cols['repeat_ends_on'] = unix_date(rule['ed'])
    if has_deadline:
        cols['repeat_deadline'] = 'yes'
        if rule.get('ts'):
            cols['repeat_start_early'] = str(abs(rule['ts']))
    return cols


class Exporter:
    def __init__(self, con: sqlite3.Connection, today: str):
        self.con = con
        self.today = today
        self.rows: list[dict] = []
        self.counts = {'task': 0, 'project': 0, 'area': 0, 'heading': 0, 'checklist': 0}
        self.tags = {r['uuid']: r for r in con.execute('select uuid, title, parent from TMTag')}

    def q(self, sql: str, *args):
        return self.con.execute(sql, args).fetchall()

    def tag_path(self, uuid: str) -> str:
        names, seen = [], set()
        while uuid and uuid in self.tags and uuid not in seen:
            seen.add(uuid)
            names.insert(0, self.tags[uuid]['title'] or '')
            uuid = self.tags[uuid]['parent']
        return '/'.join(n.replace('/', '-').replace(';', ',') for n in names if n)

    def tags_of(self, table: str, column: str, uuid: str) -> str:
        rows = self.q(f'select tags from {table} where {column} = ?', uuid)
        return '; '.join(p for p in (self.tag_path(r['tags']) for r in rows) if p)

    def add(self, **cols) -> None:
        self.rows.append(cols)
        self.counts[cols['type']] += 1

    def where(self, r) -> dict:
        """start and start_date for a to-do or project."""
        start, date = r['start'], packed_date(r['startDate'])
        if start == 0:
            return {'start': 'inbox'}
        if date:
            return {'start': 'today'} if date <= self.today else {'start': 'date', 'start_date': date}
        return {'start': 'unscheduled' if start == 1 else 'deferred'}

    def first_open_copy(self, uuid: str) -> str | None:
        """The start date of the earliest open copy of a repeating to-do or project, or None.

        A copy with no start date (moved to Anytime) counts as today's."""
        dates = [packed_date(c['startDate']) or self.today
                 for c in self.q('select startDate from TMTask where rt1_repeatingTemplate = ? and status = 0 and trashed = 0', uuid)]
        return min(dates) if dates else None

    def repeat_of(self, r, kind: str) -> dict:
        """The repeat columns of a repeating to-do or project (its template).

        Its first date is that of its earliest open copy, so the copy Things has already made
        (in Today, say) is made again by My Tasks rather than skipped; with no open copy, Things'
        next date."""
        next_date = (self.first_open_copy(r['uuid']) or packed_date(r['rt1_nextInstanceStartDate'])
                     or packed_date(r['rt1_instanceCreationStartDate']) or self.today)
        try:
            return repeat_columns(r['rt1_recurrenceRule'], next_date, r['rt1_instanceCreationPaused'], bool(r['deadline']))
        except (ExportError, plistlib.InvalidFileException, IndexError) as e:
            raise ExportError(f'The repeating {kind} “{r["title"]}” couldn’t be read: {e}.') from e

    def run(self) -> list[dict]:
        for a in self.q('select uuid, title from TMArea order by "index"'):
            self.add(type='area', id=a['uuid'], title=a['title'] or 'Untitled', tags=self.tags_of('TMAreaTag', 'areas', a['uuid']))
        areas = {r[0] for r in self.q('select uuid from TMArea')}

        projects = set()
        for p in self.q('select * from TMTask where type = 1 and status = 0 and trashed = 0 order by "index"'):
            if p['rt1_repeatingTemplate']:
                continue  # a copy of a repeating project: My Tasks makes its own
            projects.add(p['uuid'])
            cols = dict(
                type='project', id=p['uuid'], parent_id=p['area'] if p['area'] in areas else '',
                title=p['title'] or 'Untitled', notes=plain_notes(p['notes']), tags=self.tags_of('TMTaskTag', 'tasks', p['uuid']),
            )
            if p['rt1_recurrenceRule']:
                cols.update(self.repeat_of(p, 'project'))
            else:
                cols.update(self.where(p), deadline=packed_date(p['deadline']))
            self.add(**cols)

        headings = set()
        for h in self.q('select * from TMTask where type = 2 and status = 0 and trashed = 0 order by "index"'):
            if h['project'] in projects:
                headings.add(h['uuid'])
                self.add(type='heading', id=h['uuid'], parent_id=h['project'], title=h['title'] or 'Untitled')

        for t in self.q('select * from TMTask where type = 0 and status = 0 and trashed = 0 order by "index"'):
            if t['rt1_repeatingTemplate']:
                continue  # a copy of a repeating to-do: My Tasks makes its own
            if t['heading']:
                if t['heading'] not in headings:
                    continue  # under an archived or closed heading
                parent = t['heading']
            elif t['project']:
                if t['project'] not in projects:
                    continue  # in a closed or trashed project, or a copy of a repeating one
                parent = t['project']
            else:
                parent = t['area'] if t['area'] in areas else ''
            cols = dict(
                type='task', id=t['uuid'], parent_id=parent, title=t['title'] or 'Untitled',
                notes=plain_notes(t['notes']), tags=self.tags_of('TMTaskTag', 'tasks', t['uuid']),
            )
            if t['rt1_recurrenceRule']:
                cols.update(self.repeat_of(t, 'to-do'))
            else:
                cols.update(self.where(t), deadline=packed_date(t['deadline']))
            self.add(**cols)
            for c in self.q('select title, status from TMChecklistItem where task = ? order by "index"', t['uuid']):
                self.add(type='checklist', parent_id=t['uuid'], title=c['title'] or 'Untitled', checked='yes' if c['status'] in (2, 3) else 'no')
        return self.rows


def write_csv(rows: list[dict], path: str) -> None:
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator='\r\n')
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, '') for k in COLUMNS})


def plural(n: int, word: str) -> str:
    return f'{n} {word}{"" if n == 1 else "s"}'


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='Export Things 3 to a My Tasks import file.')
    ap.add_argument('--db', help='a copy of Things’ main.sqlite to read instead of Things’ own')
    ap.add_argument('--out', help='the file to write (default: "Things export YYYY-MM-DD.csv" here)')
    args = ap.parse_args(argv)
    today = dt.date.today().isoformat()
    try:
        con = open_read_only(os.path.expanduser(args.db) if args.db else find_database())
        ex = Exporter(con, today)
        rows = ex.run()
    except ExportError as e:
        print(f'Couldn’t export: {e}', file=sys.stderr)
        return 1
    out = args.out or f'Things export {today}.csv'
    write_csv(rows, out)
    c = ex.counts
    print(
        f'Wrote {out}: {plural(c["task"], "task")}, {plural(c["project"], "project")}, '
        f'{plural(c["heading"], "heading")}, {plural(c["area"], "area")} and {plural(c["checklist"], "checklist item")}.'
    )
    print('In My Tasks: Settings > Import From Other Apps > Import…')
    return 0


if __name__ == '__main__':
    sys.exit(main())
