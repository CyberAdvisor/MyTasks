"""
Tests for reminders.py (FR-21.10, FR-21.11), with a made-up Reminders list in memory
in place of EventKit, and calendar_sync.py's fake GitHub; nothing touches a
real Reminders list, Keychain or gist.
helper/testdata/ticks-envelope.json is a ticks.json written with a fixed IV:
test_ticks_fixture checks the helper still writes exactly that file, and
tests/ticks.test.ts checks the app opens it.
Run: python3 -m unittest discover helper (the PR check's build job runs them).
"""
import datetime as dt
import io
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import calendar_sync as cs  # noqa: E402
import reminders as rm  # noqa: E402
from test_calendar_sync import IV, PASSPHRASE, SALT, TODAY, FakeGitHub, event, raw  # noqa: E402

LIST = 'L1'
SETTINGS = {'list': LIST, 'title': 'My Tasks'}
TICKS_FIXTURE = os.path.join(os.path.dirname(__file__), 'testdata', 'ticks-envelope.json')
TEMPLATE = '0193a4b2-7c11-7000-8000-000000000001'  # a template id, and its copy for 2026-11-27 as the app makes it
COPY = '6f55af28-0313-854e-b4ba-7a14201cb326'  # copyId(TEMPLATE, '2026-11-27'), also checked in tests/ticks.test.ts
T0, T1, T2, T3 = ('2026-11-25T17:00:00.000Z', '2026-11-25T17:05:00.000Z', '2026-11-25T17:10:00.000Z',
                  '2026-11-25T17:20:00.000Z')


class FakeReminders:
    """REMINDERS_JS's answers, from lists of reminders kept in memory."""

    def __init__(self):
        self.lists = {LIST: 'My Tasks', 'L2': 'Groceries'}
        self.items = {}  # id: {list, title, notes, due, rule, urgent, completed, at}
        self.made = 0
        self.ops = []  # every change asked for, in order
        self.clock = T1  # when the helper's own completions happen

    def add(self, title, due, rule=None, list_id=LIST):
        """A reminder made outside the helper (or by a run whose pairing was lost)."""
        self.made += 1
        rid = f'R{self.made}'
        self.items[rid] = {'list': list_id, 'title': title, 'notes': '', 'due': due, 'rule': rule, 'urgent': False,
                           'completed': False, 'at': None}
        return rid

    def tick(self, rid, at):
        """Ticked in Reminders: a one-off is completed; a repeating one moves on a day and leaves a new completed reminder."""
        r = self.items[rid]
        if not r['rule']:
            r.update(completed=True, at=at)
            return rid
        done = self.add(r['title'], r['due'])
        self.items[done].update(completed=True, at=at)
        day = dt.date.fromisoformat(r['due'][:10]) + dt.timedelta(days=1)
        r['due'] = day.isoformat() + r['due'][10:]
        return done

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
            answer = {'status': rm.FULL_ACCESS, 'open': [
                {'id': rid, 'title': r['title'], 'due': r['due'], 'repeats': bool(r['rule'])} for rid, r in self.open().items()]}
            if request.get('since'):
                answer['done'] = [{'id': rid, 'title': r['title'], 'due': r['due'], 'at': r['at']}
                                  for rid, r in self.items.items()
                                  if r['list'] == LIST and r['completed'] and (r['at'] or '') >= request['since']]
            return answer
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
                r.update(completed=True, at=self.clock)
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


class Ticks(unittest.TestCase):
    """FR-21.11: reminders ticked in Reminders are kept as ticks for their gist's ticks.json."""

    def setUp(self):
        self.list = FakeReminders()
        self.state = {}

    def sync(self, *todos, now, gist='g1'):
        return rm.sync(SETTINGS, {gist: tasks(*todos)}, self.state, js=self.list, now=now)

    def template(self, **kw):
        return task(TEMPLATE, title='Water plants', reminder='08:00', startDate='2026-11-27', repeat=rule(), **kw)

    def test_the_first_run_sends_nothing_ticked_before_it(self):
        old = self.list.add('Call Sam', '2026-11-26T09:00')
        self.list.tick(old, '2026-11-24T10:00:00.000Z')
        self.sync(task(), now=T0)
        self.assertEqual(self.state['ticksSince'], T0)
        self.assertEqual(rm.ticks_for(self.state, 'g1'), [])

    def test_a_one_off_ticked_is_sent_until_its_task_is_closed(self):
        self.sync(task(), now=T0)
        self.list.tick('R1', T1)
        self.sync(task(), now=T2)
        self.assertEqual(rm.ticks_for(self.state, 'g1'), [{'task': 't1', 'at': T1}])
        self.assertEqual(rm.waiting(self.state), {'g1': 1})
        self.assertEqual(self.list.open(), {})  # not made again
        self.sync(task(), now=T3)
        self.assertEqual(len(rm.ticks_for(self.state, 'g1')), 1)  # read once, kept while the task is open
        self.sync(task(status='completed'), now=T3)  # the app applied it
        self.assertEqual(rm.ticks_for(self.state, 'g1'), [])

    def test_a_tick_is_dropped_when_its_task_is_trashed_or_gone_or_after_30_days(self):
        for todos, now in (((task(trashedAt=T2),), T3), ((), T3), ((task(),), '2026-12-26T17:00:00.000Z')):
            with self.subTest(todos=todos, now=now):
                self.setUp()
                self.sync(task(), now=T0)
                self.list.tick('R1', T1)
                self.sync(task(), now=T2)
                self.sync(*todos, now=now)
                self.assertEqual(rm.ticks_for(self.state, 'g1'), [])

    def test_a_repeating_tick_names_the_template_and_its_day_until_that_copy_is_closed(self):
        self.sync(self.template(), now=T0)
        self.list.tick('R1', T1)
        self.sync(self.template(), now=T2)
        self.assertEqual(rm.ticks_for(self.state, 'g1'), [{'task': TEMPLATE, 'at': T1, 'day': '2026-11-27'}])
        copy = task(COPY, title='Water plants', reminder='2026-11-27T08:00', repeatOf=TEMPLATE)
        self.sync(self.template(), copy, now=T3)  # the copy, still open, keeps it
        self.assertEqual(len(rm.ticks_for(self.state, 'g1')), 1)
        self.sync(self.template(), dict(copy, status='completed'), now=T3)
        self.assertEqual(rm.ticks_for(self.state, 'g1'), [])

    def test_a_copys_own_reminder_is_found_by_its_id(self):
        copy = task('c1', title='Water plants', reminder='2026-11-27T08:00', repeatOf='tp')  # an after-completion copy
        self.sync(copy, now=T0)
        self.list.tick('R1', T1)
        self.sync(copy, now=T2)
        self.assertEqual(rm.ticks_for(self.state, 'g1'), [{'task': 'c1', 'at': T1}])

    def test_reminders_the_helper_completed_or_didnt_make_are_not_ticks(self):
        self.sync(task(), now=T0)
        self.sync(task(status='completed'), now=T1)  # completed in My Tasks: the helper completes the reminder
        stranger = self.list.add('Buy milk', '2026-11-26T09:00')
        self.list.tick(stranger, T2)
        self.sync(task(status='completed'), now=T3)
        self.assertEqual(self.state['ticks'], {})

    def test_copy_ids_match_the_app(self):
        self.assertEqual(rm.copy_id(TEMPLATE, '2026-11-27'), COPY)


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

    def ticks(self):
        env = cs.parse_envelope(self.gh.gists['g1'][cs.TICKS_FILE], cs.TICKS_APP)
        return json.loads(cs.unseal(self.keys['g1'], env))

    def test_ticks_json_is_written_once_there_is_a_tick_and_again_only_when_they_change(self):
        self.sync()
        self.assertNotIn(cs.TICKS_FILE, self.gh.gists['g1'])  # nothing ticked yet: no file
        self.list.tick('R1', '2999-01-01T00:00:00.000Z')  # after the first run's start
        self.sync()
        self.assertEqual(self.ticks(), {'format': 1, 'ticks': [{'task': 't1', 'at': '2999-01-01T00:00:00.000Z'}]})
        self.assertIsNone(cs.parse_envelope(self.gh.gists['g1'][cs.TICKS_FILE], cs.ENVELOPE_APP))  # never a calendar file
        written = self.gh.gists['g1'][cs.TICKS_FILE]
        self.sync()
        self.assertEqual(self.gh.gists['g1'][cs.TICKS_FILE], written)  # unchanged: not written again
        with mock.patch.object(cs, 'running_pid', return_value=None):
            lines = cs.status_lines(self.config, self.state, self.pairing)
        self.assertTrue(any(line.endswith(', 1 tick waiting for My Tasks') for line in lines))

    def test_ticks_fixture(self):
        """The shared file: the helper still writes it byte for byte."""
        payload = {'format': 1, 'ticks': [{'task': 't1', 'at': '2026-11-25T17:05:00.000Z'},
                                          {'task': TEMPLATE, 'at': '2026-11-25T17:06:00.000Z', 'day': '2026-11-27'}]}
        env = cs.seal(self.keys['g1'], SALT, json.dumps(payload, separators=(',', ':')), '2026-11-25T17:10:00.000Z',
                      iv=IV, app=cs.TICKS_APP)
        with open(TICKS_FIXTURE, encoding='utf-8') as f:
            self.assertEqual(json.load(f), env)

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


class EarlyKeys(unittest.TestCase):
    """Setup throws away keys pressed while it was busy, so a Return typed early can't answer the next question."""

    def test_a_terminal_is_flushed_before_each_question(self):
        tty = mock.Mock(isatty=lambda: True, fileno=lambda: 7)
        with mock.patch.object(cs.termios, 'tcflush') as flush:
            cs.flush_typed(tty)
        flush.assert_called_once_with(7, cs.termios.TCIFLUSH)

    def test_piped_answers_are_kept(self):
        with mock.patch.object(cs.termios, 'tcflush') as flush:
            cs.flush_typed(io.StringIO('1\n'))
        flush.assert_not_called()

    def test_every_question_goes_through_ask(self):
        with mock.patch.object(cs, 'flush_typed') as flush, mock.patch('builtins.input', return_value='2'), \
                mock.patch.object(cs.getpass, 'getpass', return_value='secret'):
            self.assertEqual(cs.ask('Months ahead: '), '2')
            self.assertEqual(cs.ask_hidden('Passphrase: '), 'secret')
        self.assertEqual(flush.call_count, 2)
        for fn in (cs.choose, cs.pick_calendars):
            self.assertIs(fn.__defaults__[-1], cs.ask)
        self.assertIs(cs.open_gists.__defaults__[-1], cs.ask_hidden)
