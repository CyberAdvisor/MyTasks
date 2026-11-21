"""
Tests for things_export.py (FR-12.10), on a small made-up Things database
with the tables and columns the script reads. Run: python3 -m unittest
discover helper (the PR check's build job runs them).
"""
import csv
import io
import os
import plistlib
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import things_export as te  # noqa: E402

TODAY = '2026-11-19'
NEVER = te.NEVER


def packed(d: str) -> int:
    y, m, day = (int(x) for x in d.split('-'))
    return y << 16 | m << 12 | day << 7


def rule(**kw) -> bytes:
    base = {'ed': NEVER, 'fa': 1, 'fu': 256, 'ia': 0.0, 'of': [], 'rc': 0, 'rrv': 4, 'sr': 0.0, 'tp': 0, 'ts': 0}
    base.update(kw)
    return plistlib.dumps(base)


SCHEMA = """
create table TMArea (uuid text, title text, visible integer, "index" integer);
create table TMTag (uuid text, title text, shortcut text, parent text, "index" integer);
create table TMAreaTag (areas text, tags text);
create table TMTaskTag (tasks text, tags text);
create table TMChecklistItem (uuid text, title text, status integer, "index" integer, task text);
create table TMTask (
  uuid text, type integer, status integer, trashed integer, title text, notes text,
  start integer, startDate integer, deadline integer, "index" integer,
  area text, project text, heading text,
  rt1_repeatingTemplate text, rt1_recurrenceRule blob, rt1_instanceCreationStartDate integer,
  rt1_instanceCreationPaused integer, rt1_nextInstanceStartDate integer
);
"""


class Db:
    def __init__(self):
        self.con = sqlite3.connect(':memory:')
        self.con.executescript(SCHEMA)
        self.con.row_factory = sqlite3.Row
        self.n = 0

    def task(self, uuid, title, type=0, **kw):
        self.n += 1
        row = dict(uuid=uuid, type=type, status=0, trashed=0, title=title, notes='', start=1, startDate=None, deadline=None,
                   index=self.n, area=None, project=None, heading=None, rt1_repeatingTemplate=None, rt1_recurrenceRule=None,
                   rt1_instanceCreationStartDate=None, rt1_instanceCreationPaused=0, rt1_nextInstanceStartDate=None)
        row.update(kw)
        cols = ', '.join(f'"{k}"' for k in row)
        self.con.execute(f'insert into TMTask ({cols}) values ({", ".join("?" * len(row))})', list(row.values()))

    def run(self):
        ex = te.Exporter(self.con, TODAY)
        return ex, ex.run()


def by_title(rows, title):
    return next(r for r in rows if r['title'] == title)


class Exporting(unittest.TestCase):
    def setUp(self):
        self.db = Db()
        c = self.db.con
        c.execute("insert into TMArea values ('a1', 'Home', 1, 1)")
        c.execute("insert into TMTag values ('g1', 'Errand', null, null, 1), ('g2', 'Shop', null, 'g1', 2)")
        c.execute("insert into TMAreaTag values ('a1', 'g1')")

    def test_places_and_starts(self):
        d = self.db
        d.task('p1', 'Kitchen', type=1, area='a1', deadline=packed('2026-12-20'), notes='Paint first')
        d.task('h1', 'Choose', type=2, project='p1')
        d.task('t1', 'Inbox one', start=0)
        d.task('t2', 'Today one', start=1, startDate=packed(TODAY), heading='h1', project='p1')
        d.task('t3', 'Overdue start', start=1, startDate=packed('2026-11-01'), area='a1')
        d.task('t4', 'Upcoming one', start=2, startDate=packed('2026-12-03'), project='p1')
        d.task('t5', 'Anytime one', start=1, area='a1')
        d.task('t6', 'Someday one', start=2)
        _, rows = d.run()
        self.assertEqual(by_title(rows, 'Kitchen')['parent_id'], 'a1')
        self.assertEqual(by_title(rows, 'Kitchen')['deadline'], '2026-12-20')
        self.assertEqual(by_title(rows, 'Kitchen')['notes'], 'Paint first')
        self.assertEqual(by_title(rows, 'Choose')['parent_id'], 'p1')
        self.assertEqual(by_title(rows, 'Inbox one')['start'], 'inbox')
        self.assertEqual((by_title(rows, 'Today one')['start'], by_title(rows, 'Today one')['parent_id']), ('today', 'h1'))
        self.assertEqual(by_title(rows, 'Overdue start')['start'], 'today')
        self.assertEqual((by_title(rows, 'Upcoming one')['start'], by_title(rows, 'Upcoming one')['start_date']), ('date', '2026-12-03'))
        self.assertEqual(by_title(rows, 'Anytime one')['start'], 'unscheduled')
        self.assertEqual(by_title(rows, 'Someday one')['start'], 'deferred')
        self.assertEqual(by_title(rows, 'Home')['tags'], 'Errand')

    def test_open_items_only(self):
        d = self.db
        d.task('p1', 'Done project', type=1, status=3)
        d.task('t1', 'In done project', project='p1')
        d.task('t2', 'Done task', status=3)
        d.task('t3', 'Canceled task', status=2)
        d.task('t4', 'Trashed task', trashed=1)
        d.task('h1', 'Archived heading', type=2, status=3, project='p2')
        d.task('p2', 'Open project', type=1)
        d.task('t5', 'Under archived heading', heading='h1', project='p2')
        _, rows = d.run()
        titles = {r['title'] for r in rows}
        self.assertEqual(titles, {'Home', 'Open project'})

    def test_checklists_and_tags(self):
        d = self.db
        d.task('t1', 'Pack')
        c = d.con
        c.execute("insert into TMChecklistItem values ('c2', 'Socks', 0, 5, 't1'), ('c1', 'Passport', 3, -3, 't1')")
        c.execute("insert into TMTaskTag values ('t1', 'g2')")
        _, rows = d.run()
        items = [r for r in rows if r['type'] == 'checklist']
        self.assertEqual([(r['title'], r['checked'], r['parent_id']) for r in items], [('Passport', 'yes', 't1'), ('Socks', 'no', 't1')])
        self.assertEqual(by_title(rows, 'Pack')['tags'], 'Errand/Shop')

    def test_repeats(self):
        d = self.db
        d.task('r1', 'Weekly', start=2, rt1_recurrenceRule=rule(fu=256, of=[{'wd': 0}, {'wd': 3}]), rt1_nextInstanceStartDate=packed('2026-11-22'))
        d.task('r1c', 'Weekly', start=1, startDate=packed('2026-11-18'), rt1_repeatingTemplate='r1')  # Wednesday's, still open
        d.task('r1d', 'Weekly', start=1, startDate=packed('2026-11-15'), status=3, rt1_repeatingTemplate='r1')  # done: not counted
        d.task('r8', 'No open copy', rt1_recurrenceRule=rule(fu=16), rt1_nextInstanceStartDate=packed('2026-11-20'))
        d.task('r8c', 'No open copy', start=1, startDate=packed(TODAY), status=3, rt1_repeatingTemplate='r8')
        d.task('r9', 'Copy in Anytime', rt1_recurrenceRule=rule(fu=16), rt1_nextInstanceStartDate=packed('2026-11-20'))
        d.task('r9c', 'Copy in Anytime', start=1, rt1_repeatingTemplate='r9')
        d.task('r2', 'Second Tuesday', rt1_recurrenceRule=rule(fu=8, of=[{'wd': 2, 'wdo': 2}], rc=5))
        d.task('r3', 'Fifteenth', rt1_recurrenceRule=rule(fu=8, of=[{'dy': 14}]))
        d.task('r4', 'Last day', rt1_recurrenceRule=rule(fu=8, of=[{'dy': -1}], ed=1827532800.0))
        d.task('r5', 'Yearly', rt1_recurrenceRule=rule(fu=4, of=[{'dy': 18, 'mo': 10}]))
        d.task('r6', 'After completion', deadline=262213760, rt1_recurrenceRule=rule(tp=1, fa=2, ts=-3), rt1_instanceCreationPaused=1)
        d.task('r7', 'Daily', rt1_recurrenceRule=rule(fu=16, fa=3, of=[{'dy': 0}]))
        _, rows = d.run()
        self.assertEqual(len([r for r in rows if r['title'] == 'Weekly']), 1, 'the copies are left out')
        w = by_title(rows, 'Weekly')
        self.assertEqual((w['repeat'], w['repeat_unit'], w['repeat_weekdays'], w['repeat_first']), ('regularly', 'week', 'sun;wed', '2026-11-18'),
                         'starts at the open copy, not at Things’ next date')
        self.assertEqual(by_title(rows, 'No open copy')['repeat_first'], '2026-11-20', 'with no open copy, Things’ next date')
        self.assertEqual(by_title(rows, 'Copy in Anytime')['repeat_first'], TODAY, 'an open copy with no date counts as today’s')
        self.assertNotIn('start', w)
        t = by_title(rows, 'Second Tuesday')
        self.assertEqual((t['repeat_month_day'], t['repeat_ends_after']), ('2nd tue', '5'))
        self.assertEqual(by_title(rows, 'Fifteenth')['repeat_month_day'], '15')
        last = by_title(rows, 'Last day')
        self.assertEqual(last['repeat_month_day'], 'last')
        self.assertEqual(last['repeat_ends_on'][:4], '2027')
        y = by_title(rows, 'Yearly')
        self.assertEqual((y['repeat_unit'], y['repeat_month'], y['repeat_month_day']), ('year', 'nov', '19'))
        a = by_title(rows, 'After completion')
        self.assertEqual(
            (a['repeat'], a['repeat_every'], a['repeat_deadline'], a['repeat_start_early'], a['repeat_paused']),
            ('after_completion', '2', 'yes', '3', 'yes'),
        )
        d3 = by_title(rows, 'Daily')
        self.assertEqual((d3['repeat_unit'], d3['repeat_every'], d3.get('repeat_month_day', '')), ('day', '3', ''))

    def test_repeating_projects_come_as_templates_their_copies_left_out(self):
        # As Things stores them (conv. 2026-11-20-A): the template in Someday with the rule and its own heading
        # and to-dos; the copy (the project as it was) points to it with rt1_repeatingTemplate.
        d = self.db
        d.task('p1', 'Monthly review', type=1, start=2, rt1_recurrenceRule=rule(fu=8, of=[{'dy': 0}]),
               rt1_nextInstanceStartDate=packed('2026-12-01'))
        d.task('h1', 'Plan', type=2, project='p1')
        d.task('t1', 'Inside it', project='p1')
        d.task('t2', 'Under the heading', heading='h1')
        d.task('p1c', 'Monthly review', type=1, start=1, startDate=packed('2026-11-01'), rt1_repeatingTemplate='p1')
        d.task('t1c', 'Inside the copy', project='p1c')
        _, rows = d.run()
        reviews = [r for r in rows if r['title'] == 'Monthly review']
        self.assertEqual([r['id'] for r in reviews], ['p1'], 'only the template; the copy is left out')
        p = reviews[0]
        self.assertEqual((p['type'], p['repeat'], p['repeat_unit'], p['repeat_month_day'], p['repeat_first']),
                         ('project', 'regularly', 'month', '1', '2026-11-01'), 'starts at the open copy')
        self.assertNotIn('start', p)
        self.assertEqual(by_title(rows, 'Plan')['parent_id'], 'p1')
        self.assertEqual(by_title(rows, 'Inside it')['parent_id'], 'p1')
        self.assertEqual(by_title(rows, 'Under the heading')['parent_id'], 'h1')
        self.assertFalse(any(r['title'] == 'Inside the copy' for r in rows))

    def test_notes_in_xml_become_plain_text(self):
        self.assertEqual(te.plain_notes('<note xml:space="preserve"><p>One &amp; two</p><p>Three</p></note>'), 'One & two\nThree')
        self.assertEqual(te.plain_notes('Plain'), 'Plain')

    def test_the_file_has_the_template_columns(self):
        here = os.path.dirname(__file__)
        with open(os.path.join(here, '..', 'site', 'assets', 'import', 'mytasks-import-template.csv'), encoding='utf-8') as f:
            header = f.read().strip().split(',')
        self.assertEqual(te.COLUMNS, header)
        self.db.task('t1', 'Has, a comma "and" quotes', notes='Line one\nLine two')
        _, rows = self.db.run()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'out.csv')
            te.write_csv(rows, path)
            with open(path, encoding='utf-8', newline='') as f:
                back = list(csv.DictReader(f))
        self.assertEqual(back[1]['title'], 'Has, a comma "and" quotes')
        self.assertEqual(back[1]['notes'], 'Line one\nLine two')

    def test_main_reports_a_missing_database(self):
        err = io.StringIO()
        old = sys.stderr
        sys.stderr = err
        try:
            code = te.main(['--db', '/nonexistent/main.sqlite', '--out', os.devnull])
        finally:
            sys.stderr = old
        self.assertEqual(code, 1)
        self.assertIn('Couldn’t export', err.getvalue())


if __name__ == '__main__':
    unittest.main()
