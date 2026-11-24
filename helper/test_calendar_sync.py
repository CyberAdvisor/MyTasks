"""
Tests for calendar_sync.py (FR-21.1, FR-21.2), with made-up EventKit output
and a fake GitHub; nothing touches a real calendar, Keychain or gist.
Run: python3 -m unittest discover helper (the PR check's build job runs them).

helper/testdata/calendar-envelope.json is a calendar.json written with a
fixed IV. test_fixture checks this script still writes exactly that file,
and tests/calendarEnvelope.test.ts checks the app decrypts it.
"""
import base64
import datetime as dt
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stderr
from unittest import mock

# Local times below are Denver's, whatever the machine's own time zone.
os.environ['TZ'] = 'America/Denver'
time.tzset()

sys.path.insert(0, os.path.dirname(__file__))
import calendar_sync as cs  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), 'testdata', 'calendar-envelope.json')
MARKER_FIXTURE = os.path.join(os.path.dirname(__file__), 'testdata', 'calendar-setup-marker.json')
PASSPHRASE = 'correct horse battery staple'
SALT = base64.b64encode(bytes(range(16))).decode()
IV = bytes(range(100, 112))
TODAY = dt.date(2026, 11, 19)


def at(day: int, hour: int, minute: int = 0) -> float:
    """A local time in November 2026, as Unix seconds."""
    return dt.datetime(2026, 11, day, hour, minute).timestamp()


def event(**kw) -> dict:
    """One event as CALENDAR_JS prints it, with defaults."""
    base = {
        'id': 'E1', 'calendar': 'work', 'title': 'Standup', 'allDay': False, 'start': at(19, 9), 'end': at(19, 9, 15),
        'status': 1, 'location': '', 'notes': '', 'url': '', 'attendees': [], 'organizer': '', 'rules': [],
        'alarms': [], 'availability': 0, 'travel': None,
    }
    base.update(kw)
    return base


CALENDARS = [
    {'id': 'work', 'title': 'Work', 'source': 'iCloud', 'color': '#1badf8'},
    {'id': 'home', 'title': 'Home', 'source': 'iCloud', 'color': '#ff2968'},
    {'id': 'holidays', 'title': 'US Holidays', 'source': 'Other', 'color': '#34c759'},
]


def raw(*events) -> dict:
    return {'status': cs.FULL_ACCESS, 'calendars': CALENDARS, 'events': list(events)}


def sample_payload() -> dict:
    """The payload in the shared fixture: one event of each kind."""
    return cs.build_payload(raw(
        event(
            id='E1', title='Design review', start=at(19, 14), end=at(19, 15, 30),
            location='Room 4', notes='Bring the mockups.', url='https://example.com/meet',
            attendees=[{'name': 'Ana', 'status': 2}, {'name': 'Ben', 'status': 3}], organizer='Ana',
            rules=[{'frequency': 1, 'interval': 2, 'weekdays': [{'day': 3, 'week': 0}, {'day': 5, 'week': 0}],
                    'monthDays': [], 'endCount': 0, 'endDate': None}],
            alarms=[{'before': 15}], availability=0, travel=1800,
        ),
        event(id='E2', calendar='home', title='Day off', allDay=True, start=at(20, 0), end=at(20, 23, 59) + 59),
    ), ['work', 'home'], dt.date(2026, 12, 2), TODAY)


class FakeGitHub:
    """The gist API in memory: gists by id, each with mytasks.json and maybe calendar.json."""

    def __init__(self, salts=None):
        salts = salts or {'g1': SALT}
        self.gists = {gid: {cs.TASKS_FILE: json.dumps(self.tasks_envelope(salt))} for gid, salt in salts.items()}
        self.writes = []

    @staticmethod
    def tasks_envelope(salt, passphrase=PASSPHRASE, name=None):
        key = cs.derive_key(passphrase, salt)
        settings = [{'key': 'gistLabel', 'value': {'name': name, 'colour': 'blue'}}] if name else []
        env = cs.seal(key, salt, json.dumps({'app': 'mytasks', 'settings': settings}), '2026-11-19T00:00:00.000Z')
        return dict(env, app='mytasks')

    def task_gists(self):
        return [{'id': gid, 'updated_at': '2026-11-19T00:00:00Z'} for gid in self.gists]

    def file(self, gist_id, name):
        return self.gists[gist_id].get(name)

    def write(self, gist_id, name, content):
        self.writes.append((gist_id, name))
        self.gists[gist_id][name] = content


class Payload(unittest.TestCase):
    def test_keeps_chosen_calendars_and_leaves_out_canceled_events(self):
        p = cs.build_payload(raw(
            event(id='A'), event(id='B', calendar='holidays'), event(id='C', status=cs.CANCELED),
        ), ['work', 'home'], dt.date(2026, 12, 2), TODAY)
        self.assertEqual([e['id'] for e in p['events']], ['A'])
        self.assertEqual([c['title'] for c in p['calendars']], ['Work', 'Home'])
        self.assertNotIn('source', p['calendars'][0])
        self.assertEqual((p['from'], p['to']), ('2026-11-19', '2026-12-02'))

    def test_timed_events_in_utc_and_all_day_events_as_dates_with_the_last_day_included(self):
        p = cs.build_payload(raw(
            event(id='T', start=at(19, 9), end=at(19, 10)),
            event(id='D', allDay=True, start=at(21, 0), end=at(22, 23, 59) + 59),
        ), ['work'], dt.date(2026, 11, 25), TODAY)
        timed, day = p['events']
        self.assertEqual(timed['start'], cs.iso(at(19, 9)))
        self.assertRegex(timed['start'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$')
        self.assertEqual((day['start'], day['end']), ('2026-11-21', '2026-11-22'))

    def test_orders_by_start_with_all_day_events_first(self):
        p = cs.build_payload(raw(
            event(id='late', start=at(19, 15)), event(id='early', start=at(19, 8)),
            event(id='allday', allDay=True, start=at(19, 0), end=at(20, 0)),
        ), ['work'], dt.date(2026, 11, 25), TODAY)
        self.assertEqual([e['id'] for e in p['events']], ['allday', 'early', 'late'])

    def test_details_and_empty_fields_left_out(self):
        e = sample_payload()['events'][0]
        self.assertEqual(e['location'], 'Room 4')
        self.assertEqual(e['attendees'], [{'name': 'Ana', 'status': 'accepted'}, {'name': 'Ben', 'status': 'declined'}])
        self.assertEqual(e['repeat'], 'Every 2 weeks on Tue, Thu')
        self.assertEqual(e['alerts'], [{'before': 15}])
        self.assertEqual((e['availability'], e['travelMinutes']), ('busy', 30))
        plain = cs.event_entry(event(availability=-1))
        self.assertEqual(sorted(plain), ['allDay', 'calendar', 'end', 'id', 'start', 'title'])

    def test_repeat_lines(self):
        def line(**kw):
            rule = {'frequency': 0, 'interval': 1, 'weekdays': [], 'monthDays': [], 'endCount': 0, 'endDate': None}
            rule.update(kw)
            return cs.repeat_line(rule)
        self.assertEqual(line(), 'Every day')
        self.assertEqual(line(frequency=2, monthDays=[-1]), 'Every month on the last day')
        self.assertEqual(line(frequency=2, weekdays=[{'day': 2, 'week': 2}]), 'Every month on 2nd Mon')
        self.assertEqual(line(frequency=3, interval=2, endCount=5), 'Every 2 years, 5 times')
        self.assertEqual(line(frequency=1, endDate=at(30, 12)), 'Every week until Nov 30, 2026')

    def test_digest_changes_only_with_the_events(self):
        a, b = sample_payload(), sample_payload()
        self.assertEqual(cs.digest(a), cs.digest(b))
        b['events'][0]['title'] = 'Changed'
        self.assertNotEqual(cs.digest(a), cs.digest(b))


class Encryption(unittest.TestCase):
    def test_fixture(self):
        """The shared file: this script still writes it byte for byte."""
        env = cs.seal(cs.derive_key(PASSPHRASE, SALT), SALT, json.dumps(sample_payload(), separators=(',', ':')),
                      '2026-11-19T17:00:00.000Z', iv=IV)
        with open(FIXTURE, encoding='utf-8') as f:
            self.assertEqual(json.load(f), env)

    def test_round_trip_and_wrong_passphrase(self):
        key = cs.derive_key(PASSPHRASE, SALT)
        env = cs.seal(key, SALT, 'hello', '2026-11-19T17:00:00.000Z')
        self.assertEqual(cs.unseal(key, env), 'hello')
        with self.assertRaises(cs.HelperError):
            cs.unseal(cs.derive_key('wrong passphrase', SALT), env)

    def test_envelope_checks(self):
        env = cs.seal(cs.derive_key(PASSPHRASE, SALT), SALT, 'x', '2026-11-19T17:00:00.000Z')
        self.assertIsNotNone(cs.parse_envelope(json.dumps(env), cs.ENVELOPE_APP))
        self.assertIsNone(cs.parse_envelope(json.dumps(env), 'mytasks'))
        for bad in ({'kdf': dict(env['kdf'], iterations=1000)}, {'cipher': {'name': 'AES-GCM', 'iv': 'AAAA'}}, {'kdf': 'x'}):
            self.assertIsNone(cs.parse_envelope(json.dumps(dict(env, **bad)), cs.ENVELOPE_APP))
        self.assertIsNone(cs.parse_envelope('not json', cs.ENVELOPE_APP))


class MonthsAhead(unittest.TestCase):
    def test_reads_to_the_end_of_the_month_so_many_months_on(self):
        self.assertEqual(cs.last_day(TODAY, 4), dt.date(2027, 3, 31))
        self.assertEqual(cs.last_day(TODAY, 1), dt.date(2026, 12, 31))
        self.assertEqual(cs.last_day(dt.date(2026, 12, 5), 6), dt.date(2027, 6, 30))
        self.assertEqual(cs.last_day(dt.date(2027, 1, 31), 1), dt.date(2027, 2, 28))

    def test_older_settings_in_weeks_read_one_month(self):
        self.assertEqual(cs.config_months({'weeks': 2}), 1)
        self.assertEqual(cs.config_months({'months': 4}), 4)
        self.assertEqual(cs.config_months({'months': 9}), 1)

    def test_a_reading_covers_the_months_and_says_so(self):
        asked = []
        config = {'gists': [{'id': 'g1', 'salt': SALT}], 'calendars': ['work'], 'months': 4}
        keys = {'g1': cs.derive_key(PASSPHRASE, SALT)}
        cs.sync_once(config, keys, FakeGitHub(), {}, read=lambda days: asked.append(days) or raw(event()), today=TODAY)
        self.assertEqual(asked, [(dt.date(2027, 3, 31) - TODAY).days + 1])


OTHER_SALT = base64.b64encode(bytes(16)).decode()


class Syncing(unittest.TestCase):
    """FR-21.8: one reading written to every set-up gist, each with its own key."""

    def setUp(self):
        self.config = {'gists': [{'id': 'g1', 'salt': SALT, 'name': 'Home'}, {'id': 'g2', 'salt': OTHER_SALT, 'name': 'Work'}],
                       'calendars': ['work'], 'months': 1}
        self.keys = {'g1': cs.derive_key(PASSPHRASE, SALT), 'g2': cs.derive_key(PASSPHRASE, OTHER_SALT)}
        self.events = [event()]

    def sync(self, gh, state):
        return cs.sync_once(self.config, self.keys, gh, state, read=lambda days: raw(*self.events), today=TODAY)

    def opened(self, gh, gist_id):
        env = cs.parse_envelope(gh.gists[gist_id][cs.CALENDAR_FILE], cs.ENVELOPE_APP)
        return json.loads(cs.unseal(self.keys[gist_id], env))

    def test_writes_each_gist_with_its_own_key_only_when_something_changed(self):
        gh, state = FakeGitHub({'g1': SALT, 'g2': OTHER_SALT}), {}
        self.assertEqual(self.sync(gh, state), 2)
        self.assertEqual(self.sync(gh, state), 0)
        self.events = [event(title='Moved')]
        self.assertEqual(self.sync(gh, state), 2)
        self.assertEqual(gh.writes, [('g1', cs.CALENDAR_FILE), ('g2', cs.CALENDAR_FILE)] * 2)
        for gid in ('g1', 'g2'):
            self.assertEqual(self.opened(gh, gid)['events'][0]['title'], 'Moved')
            self.assertEqual((state['gists'][gid]['events'], state['gists'][gid]['lastWrite']), (1, state['lastCheck']))
        with self.assertRaises(cs.HelperError):  # each file needs its own gist's key
            cs.unseal(self.keys['g1'], cs.parse_envelope(gh.gists['g2'][cs.CALENDAR_FILE], cs.ENVELOPE_APP))

    def test_a_changed_passphrase_stops_that_gist_alone(self):
        gh, state = FakeGitHub({'g1': SALT, 'g2': base64.b64encode(bytes([7] * 16)).decode()}), {}
        self.assertEqual(self.sync(gh, state), 1)
        self.assertEqual(gh.writes, [('g1', cs.CALENDAR_FILE)])
        self.assertEqual(state['gists']['g2'], {'name': 'Work', 'stopped': True, 'error': cs.CHANGED_IN_APP})
        self.assertFalse(cs.all_stopped(self.config, state))
        self.config['gists'] = self.config['gists'][1:]
        self.assertTrue(cs.all_stopped(self.config, state))

    def test_a_gist_with_no_passphrase_is_skipped_and_marked_once(self):
        gh, state = FakeGitHub({'g1': SALT, 'g2': OTHER_SALT, 'g3': OTHER_SALT}), {}
        gh.gists['g3'][cs.CALENDAR_FILE] = 'written earlier'
        self.config['gists'] = self.config['gists'][:1]
        self.sync(gh, state)
        self.events = [event(title='Moved')]
        self.sync(gh, state)
        self.assertEqual(gh.writes, [('g1', cs.CALENDAR_FILE), ('g2', cs.CALENDAR_FILE), ('g1', cs.CALENDAR_FILE)])
        marker = json.loads(gh.gists['g2'][cs.CALENDAR_FILE])
        self.assertEqual({k: marker[k] for k in ('app', 'format', 'setupNeeded')}, {'app': cs.ENVELOPE_APP, 'format': 1, 'setupNeeded': True})
        self.assertEqual(gh.gists['g3'][cs.CALENDAR_FILE], 'written earlier')  # an existing file is left as it is
        self.assertEqual(state['gists']['g2']['error'], cs.SKIPPED)
        with mock.patch.object(cs, 'running_pid', return_value=None):
            lines = cs.status_lines(self.config, state)
        self.assertIn('Home (gist g1…): last write ' + state['gists']['g1']['lastWrite'] + ' (1 events)', lines)
        self.assertIn(f'Gist g2…: {cs.SKIPPED}', lines)

    def test_marker_fixture(self):
        # The app reads this file as "set up again" (tests/calendarEnvelope.test.ts).
        with open(MARKER_FIXTURE) as f:
            self.assertEqual(json.load(f), cs.setup_marker('2026-11-24T12:00:00.000Z'))

    def test_settings_from_one_gist_keep_working(self):
        config = cs.upgrade_config({'gist': 'g1', 'salt': SALT, 'calendars': ['work'], 'months': 2})
        self.assertEqual(config, {'gists': [{'id': 'g1', 'salt': SALT, 'legacy': True}], 'calendars': ['work'], 'months': 2})
        asked = []

        def run(args, **kw):
            asked.append(args[args.index('-a') + 1])
            return subprocess.CompletedProcess(args, 0, 'secret\n', '')
        self.assertEqual(cs.secrets(config, run), ('secret', {'g1': 'secret'}))
        self.assertEqual(asked, [cs.TOKEN_ACCOUNT, cs.LEGACY_PASSPHRASE_ACCOUNT])

    def test_setup_tries_typed_passphrases_first_and_enter_skips(self):
        gh = FakeGitHub({'g1': SALT, 'g2': OTHER_SALT, 'g3': SALT})
        gh.gists['g1'][cs.TASKS_FILE] = json.dumps(FakeGitHub.tasks_envelope(SALT, name='Home'))
        gh.gists['g3'][cs.TASKS_FILE] = json.dumps(FakeGitHub.tasks_envelope(SALT, passphrase='another one'))
        answers = iter(['wrong', PASSPHRASE, ''])  # g1: wrong, then right; g2 opens with it; g3: skipped
        with mock.patch('sys.stdout', io.StringIO()):
            opened = cs.open_gists(gh, gh.task_gists(), ask=lambda prompt: next(answers))
        self.assertEqual([(g['id'], g['name']) for g in opened], [('g1', 'Home'), ('g2', 'Default')])
        self.assertEqual(next(answers, 'all used'), 'all used')


class Commands(unittest.TestCase):
    def test_every_is_whole_minutes_from_5_to_60(self):
        self.assertEqual(cs.every_minutes('5'), 5)
        self.assertEqual(cs.every_minutes('60'), 60)
        for bad in ('4', '61', '1.5', 'x'):
            with self.assertRaises(Exception):
                cs.every_minutes(bad)
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            cs.main(['start', '--every', '2'])

    def test_keychain_value_goes_on_standard_input_quoted(self):
        kept = {'args': []}

        def run(args, input=None, **kw):
            kept['args'] += args
            if args[:2] == ['security', '-i']:
                kept['command'] = input
                return subprocess.CompletedProcess(args, 0, '', '')
            return subprocess.CompletedProcess(args, 0, 'pa"ss\\word\n', '')

        cs.keychain_set(cs.passphrase_account('g1'), 'pa"ss\\word', run)
        self.assertIn('-w "pa\\"ss\\\\word"', kept['command'])
        self.assertFalse(any('pa"ss' in a for a in kept['args']))

    def test_keychain_refuses_a_value_it_did_not_keep(self):
        def run(args, input=None, **kw):
            return subprocess.CompletedProcess(args, 0 if args[1] == '-i' else 44, '', '')
        with self.assertRaises(cs.HelperError):
            cs.keychain_set(cs.TOKEN_ACCOUNT, 'ghp_x', run)

    def test_status_before_setup(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(cs, 'SUPPORT_DIR', d):
            out = io.StringIO()
            with mock.patch('sys.stdout', out):
                cs.cmd_status()
            self.assertIn('Not set up', out.getvalue())

    def test_calendar_access_messages(self):
        def answer(status):
            return lambda args, input=None, **kw: subprocess.CompletedProcess(args, 0, json.dumps({'status': status}), '')
        with self.assertRaisesRegex(cs.HelperError, 'click Allow'):
            cs.read_calendar(7, answer(cs.NOT_ASKED))  # the prompt went unanswered
        for refused in (1, 2):  # restricted, denied
            with self.assertRaisesRegex(cs.HelperError, 'Privacy & Security > Calendars'):
                cs.read_calendar(7, answer(refused))

    def test_calendar_script_asks_for_access_when_macos_has_not_asked(self):
        run_fn = cs.CALENDAR_JS[cs.CALENDAR_JS.index('function run(argv)'):]
        self.assertIn('if (accessStatus() === 0) requestAccess();', run_fn)
        self.assertIn('requestFullAccessToEventsWithCompletion', cs.CALENDAR_JS)

    def test_a_stuck_calendar_read_times_out(self):
        def run(args, input=None, timeout=None, **kw):
            self.assertEqual(timeout, cs.CALENDAR_TIMEOUT)
            raise subprocess.TimeoutExpired(args, timeout)
        with self.assertRaisesRegex(cs.HelperError, 'too long'):
            cs.read_calendar(7, run)

    def test_iso_matches_javascript(self):
        self.assertEqual(cs.iso(0.25), '1970-01-01T00:00:00.250Z')


if __name__ == '__main__':
    unittest.main()
