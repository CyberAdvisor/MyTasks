"""
Tests for reminders.py (FR-21.10), with a made-up Reminders list in memory
in place of EventKit, and calendar_sync.py's fake GitHub; nothing touches a
real Reminders list, Keychain or gist.
Run: python3 -m unittest discover helper (the PR check's build job runs them).
"""
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import calendar_sync as cs  # noqa: E402
import reminders as rm  # noqa: E402
from test_calendar_sync import PASSPHRASE, SALT, TODAY, FakeGitHub, event, raw  # noqa: E402

LIST = 'L1'
SETTINGS = {'list': LIST, 'title': 'My Tasks'}


class FakeReminders:
    """REMINDERS_JS's answers, from lists of reminders kept in memory."""

    def __init__(self):
        self.lists = {LIST: 'My Tasks', 'L2': 'Groceries'}
        self.items = {}  # id: {list, title, notes, due, rule, urgent, completed}
        self.made = 0
        self.ops = []  # every change asked for, in order

    def add(self, title, due, rule=None, list_id=LIST):
        """A reminder made outside the helper (or by a run whose pairing was lost)."""
        self.made += 1
        rid = f'R{self.made}'
        self.items[rid] = {'list': list_id, 'title': title, 'notes': '', 'due': due, 'rule': rule, 'urgent': False, 'completed': False}
        return rid

    def open(self):
        return {rid: r for rid, r in self.items.items() if r['list'] == LIST and not r['completed']}

    def __call__(self, request):
        action = request['action']
        if action == 'lists':
            return {'status': rm.FULL_ACCESS, 'lists': [{'id': i, 'title': t} for i, t in self.lists.items()]}
        if action == 'create-list':
            self.lists['L9'] = request['title']
            return {'status': rm.FULL_ACCESS, 'id': 'L9'}
        if action == 'read':
            return {'status': rm.FULL_ACCESS, 'open': [
                {'id': rid, 'title': r['title'], 'due': r['due'], 'repeats': bool(r['rule'])} for rid, r in self.open().items()]}
        created, failed = {}, {}
        for op in request['ops']:
            self.ops.append(op)
            if op['op'] == 'create':
                rid = self.add(op['title'], op['due'], op['rule'])
                self.items[rid]['notes'] = op['notes']
                created[op['ref']] = rid
                continue
            r = self.items.get(op['id'])
            if r is None:
                failed[op['id']] = 'missing'
            elif op['op'] == 'delete':
                del self.items[op['id']]
            elif op['op'] == 'complete':
                r['completed'] = True
            else:
                r.update({f: op[f] for f in ('title', 'notes', 'due', 'rule') if f in op})
        return {'status': rm.FULL_ACCESS, 'created': created, 'failed': failed}


def task(tid='t1', title='Call Sam', reminder='2026-11-26T09:00', **kw) -> dict:
    """One task as mytasks.json holds it, with the fields the helper reads."""
    base = {'id': tid, 'title': title, 'status': 'open', 'reminder': reminder, 'projectId': None, 'startDate': None,
            'repeat': None, 'repeatOf': None, 'trashedAt': None, 'deletedAt': None}
    base.update(kw)
    return base


def rule(**kw) -> dict:
    """A repeat rule as the app stores it (RepeatRule)."""
    base = {'mode': 'fixed', 'unit': 'day', 'interval': 1, 'weekdays': [], 'days': [], 'month': None,
            'endCount': None, 'endDate': None, 'made': 0, 'deadlineDays': None, 'paused': False}
    base.update(kw)
    return base


def tasks(*todos, projects=()) -> dict:
    return {'app': 'mytasks', 'schema': 15, 'tables': {'todos': list(todos), 'projects': list(projects)}, 'settings': []}


class Reminders(unittest.TestCase):
    def setUp(self):
        self.list = FakeReminders()
        self.state = {}

    def sync(self, *todos, projects=(), gist='g1'):
        return rm.sync(SETTINGS, {gist: tasks(*todos, projects=projects)}, self.state, js=self.list)

    def only(self):
        (r,) = self.list.open().values()
        return r

    def test_a_task_with_a_reminder_gets_one_with_its_project_in_the_notes(self):
        self.sync(task(projectId='p1'), task('t2', reminder=None), projects=[{'id': 'p1', 'title': 'Vacation'}])
        r = self.only()
        self.assertEqual((r['title'], r['notes'], r['due'], r['rule']), ('Call Sam', 'Vacation', '2026-11-26T09:00', None))
        self.assertEqual(rm.counts(self.state), {'g1': 1})
        self.assertEqual(self.sync(task(projectId='p1'), projects=[{'id': 'p1', 'title': 'Vacation'}]), 0)  # nothing changed

    def test_a_change_changes_only_its_own_fields_and_urgent_stays(self):
        self.sync(task())
        self.only()['urgent'] = True  # marked in Reminders
        self.list.ops.clear()
        self.sync(task(title='Call Sam back', reminder='2026-11-27T10:30'))
        self.assertEqual(self.list.ops, [{'op': 'change', 'id': 'R1', 'title': 'Call Sam back', 'due': '2026-11-27T10:30'}])
        self.assertTrue(self.only()['urgent'])

    def test_completing_completes_it_and_other_endings_remove_it(self):
        for ending, how in (({'status': 'completed'}, 'complete'), ({'status': 'canceled'}, 'delete'),
                            ({'trashedAt': '2026-11-25T00:00:00.000Z'}, 'delete'), ({'reminder': None}, 'delete')):
            with self.subTest(ending=ending):
                self.setUp()
                self.sync(task())
                self.sync(task(**ending))
                self.assertEqual(self.list.ops[-1], {'op': how, 'id': 'R1'})
                self.assertEqual(self.list.open(), {})
                self.assertEqual(self.state['items'], {})
        self.setUp()
        self.sync(task())
        self.sync()  # deleted: gone from the list entirely
        self.assertEqual(self.list.ops[-1], {'op': 'delete', 'id': 'R1'})

    def test_a_task_in_a_trashed_project_has_none(self):
        self.sync(task(projectId='p1'), projects=[{'id': 'p1', 'title': 'Old', 'trashedAt': '2026-11-25T00:00:00.000Z'}])
        self.assertEqual(self.list.open(), {})

    def test_ticked_or_deleted_in_reminders_is_not_made_again_until_the_reminder_changes(self):
        self.sync(task())
        self.list.items['R1']['completed'] = True  # ticked in Reminders
        self.sync(task())
        self.sync(task())
        self.assertEqual(self.list.open(), {})
        self.assertEqual(rm.counts(self.state), {})
        self.sync(task(reminder='2026-11-28T08:00'))  # a new reminder in My Tasks
        self.assertEqual(self.only()['due'], '2026-11-28T08:00')

    def test_a_lost_pairing_finds_the_reminders_again_by_title_and_time(self):
        self.sync(task(), task('t2', title='Pay rent', reminder='2026-12-01T09:00'))
        self.state = {}  # the state file lost, or a second Mac
        self.list.ops.clear()
        self.sync(task(), task('t2', title='Pay rent', reminder='2026-12-01T09:00'))
        self.assertEqual(self.list.ops, [])
        self.assertEqual(len(self.list.open()), 2)
        self.assertEqual(rm.counts(self.state), {'g1': 2})

    def test_a_gist_not_read_this_time_keeps_its_reminders(self):
        self.sync(task(), gist='g1')
        self.sync(task('t9', title='Report'), gist='g2')
        self.assertEqual(len(self.list.open()), 2)
        self.assertEqual(rm.counts(self.state), {'g1': 1, 'g2': 1})

    def test_reminders_in_other_lists_are_left_alone(self):
        self.list.add('Call Sam', '2026-11-26T09:00', list_id='L2')
        self.sync(task())
        self.assertEqual(len(self.list.items), 2)


class Repeats(unittest.TestCase):
    def setUp(self):
        self.list = FakeReminders()
        self.state = {}

    def sync(self, *todos, projects=()):
        return rm.sync(SETTINGS, {'g1': tasks(*todos, projects=projects)}, self.state, js=self.list)

    def template(self, **kw):
        return task('tp', title='Water plants', reminder='08:00', startDate='2026-11-27', repeat=rule(**kw))

    def test_a_regular_repeat_gets_one_repeating_reminder_and_its_copies_none(self):
        copy = task('c1', title='Water plants', reminder='2026-11-26T08:00', repeatOf='tp')
        self.sync(self.template(), copy)
        (r,) = self.list.open().values()
        self.assertEqual(r['due'], '2026-11-26T08:00')  # its open copy's day comes first
        self.assertEqual(r['rule'], {'frequency': 0, 'interval': 1, 'weekdays': [], 'monthDays': [], 'months': [], 'endCount': 0, 'endDate': None})

    def test_a_copy_done_in_my_tasks_moves_the_reminder_on(self):
        copy = task('c1', title='Water plants', reminder='2026-11-26T08:00', repeatOf='tp')
        self.sync(self.template(), copy)
        self.list.ops.clear()
        self.sync(self.template(), dict(copy, status='completed'))
        self.assertEqual(self.list.ops, [{'op': 'change', 'id': 'R1', 'due': '2026-11-27T08:00'}])
        self.list.ops.clear()
        self.list.items['R1']['due'] = '2026-11-28T08:00'  # ticked ahead in Reminders
        self.sync(self.template())
        self.assertEqual(self.list.ops, [])  # never moved back

    def test_a_new_time_or_rule_changes_it_in_place(self):
        self.sync(self.template())
        self.list.ops.clear()
        self.sync(dict(self.template(), reminder='09:15'))
        self.assertEqual([op['op'] for op in self.list.ops], ['change'])
        self.assertEqual(self.list.ops[0]['due'], '2026-11-27T09:15')

    def test_pausing_removes_it_and_resuming_makes_it_again(self):
        self.sync(self.template())
        self.sync(self.template(paused=True))
        self.assertEqual(self.list.open(), {})
        self.sync(self.template())
        self.assertEqual(len(self.list.open()), 1)

    def test_stopping_the_repeat_makes_it_a_one_off(self):
        self.sync(self.template())
        self.sync(task('tp', title='Water plants', reminder='2026-11-27T08:00'))
        (r,) = self.list.open().values()
        self.assertEqual((r['rule'], r['due']), (None, '2026-11-27T08:00'))

    def test_after_completion_repeats_and_repeating_projects_have_one_per_copy(self):
        waiting = task('tp', reminder='08:00', repeat=rule(mode='afterCompletion'))
        copy = task('c1', reminder='2026-11-26T08:00', repeatOf='tp')
        in_template = task('pt', reminder='10:00', projectId='rp')
        in_copy = task('pc', title='Pack', reminder='2026-11-30T10:00', projectId='cp')
        projects = [{'id': 'rp', 'title': 'Trip', 'repeat': rule(unit='week')}, {'id': 'cp', 'title': 'Trip', 'repeatOf': 'rp'}]
        self.sync(waiting, copy, in_template, in_copy, projects=projects)
        self.assertEqual(sorted((r['title'], r['due'], r['rule']) for r in self.list.open().values()),
                         [('Call Sam', '2026-11-26T08:00', None), ('Pack', '2026-11-30T10:00', None)])

    def test_rules(self):
        def spec(**kw):
            return rm.recurrence(rule(**kw))
        self.assertEqual(spec(unit='week', interval=2, weekdays=[2, 4])['weekdays'], [{'day': 3, 'week': 0}, {'day': 5, 'week': 0}])
        last = spec(unit='month', days=[{'ordinal': -1, 'weekday': None}])
        self.assertEqual((last['frequency'], last['monthDays'], last['weekdays']), (2, [-1], []))
        self.assertEqual(spec(unit='month', days=[{'ordinal': 2, 'weekday': 2}])['weekdays'], [{'day': 3, 'week': 2}])
        yearly = spec(unit='year', month=3, days=[{'ordinal': 15, 'weekday': None}])
        self.assertEqual((yearly['frequency'], yearly['months'], yearly['monthDays']), (3, [3], [15]))
        self.assertEqual(spec(endCount=5, made=2)['endCount'], 3)  # the copies still to come
        self.assertIsNone(spec(endCount=5, made=5))
        self.assertEqual(spec(endDate='2027-01-31')['endDate'], '2027-01-31')
        self.assertIsNone(spec(unit='fortnight'))


class Setup(unittest.TestCase):
    def ask(self, *answers):
        replies = iter(answers)
        self.prompts = []
        return lambda prompt: self.prompts.append(prompt) or next(replies)

    def test_choosing_the_list(self):
        fake = FakeReminders()
        with mock.patch('builtins.print'):
            self.assertEqual(rm.choose_list(self.ask(''), js=fake), {'list': LIST, 'title': 'My Tasks'})  # Enter: the one already there
            self.assertIn('Enter to use your list "My Tasks"', self.prompts[0])
            self.assertEqual(rm.choose_list(self.ask('9', '2'), js=fake), {'list': 'L2', 'title': 'Groceries'})
            self.assertIsNone(rm.choose_list(self.ask('0'), js=fake))
            del fake.lists[LIST]
            choice = rm.choose_list(self.ask(''), js=fake)
            self.assertIn('a number from the list above, Enter to make a new list named "My Tasks", or 0 for none', self.prompts[0])
        self.assertEqual(rm.make_list(choice, js=fake), {'list': 'L9', 'title': 'My Tasks'})  # made only now

    def test_access_messages(self):
        for status, words in ((rm.NOT_ASKED, "prompt wasn't answered"), (2, 'Privacy & Security > Reminders')):
            run = mock.Mock(return_value=mock.Mock(returncode=0, stdout=json.dumps({'status': status}), stderr=''))
            with self.assertRaisesRegex(rm.RemindersError, words):
                rm.run_js({'action': 'lists'}, run=run)
        run = mock.Mock(return_value=mock.Mock(returncode=0, stdout=json.dumps({'status': rm.FULL_ACCESS, 'missingList': True}), stderr=''))
        with self.assertRaisesRegex(rm.RemindersError, 'Run setup again'):
            rm.run_js({'action': 'read', 'list': LIST}, run=run)
        self.assertIn('requestFullAccessToRemindersWithCompletion', rm.REMINDERS_JS)


class WithTheCalendar(unittest.TestCase):
    """calendar_sync.py: the mark in calendar.json, the tasks read, a Reminders problem kept apart."""

    def setUp(self):
        self.config = {'gists': [{'id': 'g1', 'salt': SALT, 'name': 'Home', 'calendars': ['work']}], 'months': 1,
                       'reminders': SETTINGS}
        self.keys = {'g1': cs.derive_key(PASSPHRASE, SALT)}
        self.gh = FakeGitHub()
        env = cs.seal(self.keys['g1'], SALT, json.dumps(tasks(task())), '2026-11-25T00:00:00.000Z')
        self.gh.gists['g1'][cs.TASKS_FILE] = json.dumps(dict(env, app='mytasks'))
        self.list, self.state, self.pairing = FakeReminders(), {}, {}

    def sync(self, remind=None):
        return cs.sync_once(self.config, self.keys, self.gh, self.state, read=lambda days: raw(event()), today=TODAY,
                            reminder_state=self.pairing, remind=remind or self.list)

    def calendar(self):
        env = cs.parse_envelope(self.gh.gists['g1'][cs.CALENDAR_FILE], cs.ENVELOPE_APP)
        return json.loads(cs.unseal(self.keys['g1'], env))

    def test_the_mark_and_the_reminders(self):
        self.sync()
        self.assertIs(self.calendar()['reminders'], True)
        self.assertEqual(len(self.list.open()), 1)
        self.assertIsNone(self.state['remindersError'])
        with mock.patch.object(cs, 'running_pid', return_value=None):
            lines = cs.status_lines(self.config, self.state, self.pairing)
        self.assertIn(f'Reminders: in the list "My Tasks", last change {self.pairing["lastSync"]}.', lines)
        self.assertTrue(any(line.endswith(', 1 reminder') for line in lines))
        del self.config['reminders']
        self.sync()
        self.assertNotIn('reminders', self.calendar())  # off: the field hides again

    def test_a_reminders_problem_leaves_the_calendar_alone(self):
        def broken(request):
            raise rm.RemindersError('No Reminders access.')
        self.assertEqual(self.sync(broken), 1)
        self.assertEqual(self.state['remindersError'], 'No Reminders access.')
        self.assertIsNone(self.state['gists']['g1']['error'])

    def test_an_older_download_without_reminders_py_says_so(self):
        with mock.patch.object(cs, 'reminders', None):
            self.sync()
        self.assertEqual(self.state['remindersError'], cs.NO_REMINDERS_FILE)


if __name__ == '__main__':
    unittest.main()
