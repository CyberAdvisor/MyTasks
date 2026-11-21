#!/usr/bin/env python3
"""
Calendar events for My Tasks (FR-21.1, FR-21.2, Milestone 13).

Reads the Mac's calendars you choose through EventKit (as Do Things does)
and writes them, encrypted like your tasks, to a second file in your gist,
calendar.json. My Tasks reads that file on every device; it never changes
the calendars.

    python3 calendar_sync.py setup             # once: token, passphrase, calendars, months
    python3 calendar_sync.py start --every 15  # read every 15 minutes (5 to 60), in the background
    python3 calendar_sync.py stop
    python3 calendar_sync.py status            # running or not, last write, any error
    python3 calendar_sync.py check             # read calendar.json back and decrypt it

Runs with the Mac's own Python 3 and no admin rights. The one extra package,
for the encryption, is installed for your user only:

    python3 -m pip install --user cryptography

Start it from a shortcut ("Run Shell Script" with the start command), so the
calendar access macOS gives Shortcuts covers it; a daily Time of Day
automation running that shortcut starts it again after a restart. Running
start again replaces the copy already running (for example to change the
interval).

Where things are kept:
- The GitHub token and the passphrase: your login Keychain, under
  "My Tasks calendar helper".
- Settings (gist, calendars, months) and status: ~/Library/Application
  Support/My Tasks/. Errors go to calendar-helper.log there too.

calendar.json is an envelope like mytasks.json (src/lib/sync/crypto.ts):
the same key (PBKDF2-SHA-256, 600,000 rounds, the salt in mytasks.json),
AES-256-GCM with a fresh 12-byte IV for every write, app "mytasks-calendar".
Inside, encrypted, is:

    {"format": 1, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD",
     "calendars": [{"id", "title", "color"}],
     "events": [{"id", "calendar", "title", "allDay", "start", "end", ...}]}

Timed events' start and end are UTC timestamps as JavaScript's toISOString
writes them; all-day events' are dates (the last day included). Optional
fields, left out when empty: location, notes, url, attendees ([{name,
status}]), organizer, repeat (a line such as "Every 2 weeks on Tue, Thu"),
alerts ([{"before": minutes}] or [{"at": timestamp}]), availability (busy,
free, tentative or unavailable) and travelMinutes. Canceled events are left
out. If the passphrase is changed in the app (a new salt), the helper stops
writing until setup is run again.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import getpass
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

SERVICE = 'My Tasks calendar helper'
TOKEN_ACCOUNT = 'github-token'
PASSPHRASE_ACCOUNT = 'passphrase'

SUPPORT_DIR = os.path.expanduser('~/Library/Application Support/My Tasks')
CONFIG_FILE = 'calendar-helper.json'
STATE_FILE = 'calendar-helper-state.json'
PID_FILE = 'calendar-helper.pid'
LOG_FILE = 'calendar-helper.log'

API = 'https://api.github.com'
RAW_PREFIX = 'https://gist.githubusercontent.com/'
TASKS_FILE = 'mytasks.json'
CALENDAR_FILE = 'calendar.json'
REQUEST_TIMEOUT = 30  # seconds, as the app's REQUEST_TIMEOUT_MS

# The app's encryption (src/lib/sync/crypto.ts).
KDF_ITERATIONS = 600_000
SALT_BYTES = 16
IV_BYTES = 12
ENVELOPE_APP = 'mytasks-calendar'

MIN_EVERY, MAX_EVERY, DEFAULT_EVERY = 5, 60, 15  # minutes
# How far ahead to read: this month and the next 1 to 6 months, 4 by
# default, as far as My Tasks' Scheduled lists events (FR-21.6).
MIN_MONTHS, MAX_MONTHS, DEFAULT_MONTHS = 1, 6, 4
NOT_ASKED = 0  # EKAuthorizationStatusNotDetermined
FULL_ACCESS = 3  # EKAuthorizationStatusFullAccess
CALENDAR_TIMEOUT = 90  # seconds: up to 60 waiting for an answer to macOS's prompt, then the reading
CANCELED = 3  # EKEventStatusCanceled

INSTALL_CRYPTOGRAPHY = 'python3 -m pip install --user cryptography'


class HelperError(Exception):
    """A problem to report in one line, without a traceback."""


class SaltChanged(HelperError):
    """The gist's salt changed: the passphrase was changed in the app."""

    def __init__(self) -> None:
        super().__init__('The passphrase was changed in My Tasks. Run setup again with the new passphrase.')


# ---------------------------------------------------------------------------
# Encryption, matching src/lib/sync/crypto.ts.


def aesgcm(key: bytes):
    """AES-GCM from the cryptography package, with a clear message when it's missing."""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        raise HelperError(f'The cryptography package is needed. Install it with: {INSTALL_CRYPTOGRAPHY}') from None
    return AESGCM(key)


def derive_key(passphrase: str, salt: str) -> bytes:
    """The 256-bit AES key for a passphrase and the gist's base64 salt."""
    return hashlib.pbkdf2_hmac('sha256', passphrase.encode(), base64.b64decode(salt), KDF_ITERATIONS, 32)


def b64_length(text) -> int:
    """How many bytes a base64 string holds, or -1 if it isn't base64."""
    try:
        return len(base64.b64decode(text, validate=True)) if isinstance(text, str) else -1
    except ValueError:
        return -1


def parse_envelope(content: str, app: str):
    """The envelope in a gist file, or None if it isn't one of the app's (same checks as parseEnvelope)."""
    try:
        e = json.loads(content)
    except ValueError:
        return None
    ok = (
        isinstance(e, dict)
        and e.get('app') == app
        and e.get('format') == 1
        and isinstance(e.get('updatedAt'), str)
        and isinstance(e.get('kdf'), dict)
        and e['kdf'].get('name') == 'PBKDF2'
        and e['kdf'].get('hash') == 'SHA-256'
        and e['kdf'].get('iterations') == KDF_ITERATIONS
        and b64_length(e['kdf'].get('salt')) == SALT_BYTES
        and isinstance(e.get('cipher'), dict)
        and e['cipher'].get('name') == 'AES-GCM'
        and b64_length(e['cipher'].get('iv')) == IV_BYTES
        and b64_length(e.get('data')) > 0
    )
    return e if ok else None


def seal(key: bytes, salt: str, plaintext: str, updated_at: str, iv: bytes = None) -> dict:
    """Encrypt `plaintext` into a calendar envelope. `iv` is for tests only; normally random."""
    iv = iv if iv is not None else os.urandom(IV_BYTES)
    data = aesgcm(key).encrypt(iv, plaintext.encode(), None)  # ciphertext + tag, as Web Crypto writes it
    return {
        'app': ENVELOPE_APP,
        'format': 1,
        'updatedAt': updated_at,
        'kdf': {'name': 'PBKDF2', 'hash': 'SHA-256', 'iterations': KDF_ITERATIONS, 'salt': salt},
        'cipher': {'name': 'AES-GCM', 'iv': base64.b64encode(iv).decode()},
        'data': base64.b64encode(data).decode(),
    }


def unseal(key: bytes, envelope: dict) -> str:
    """Decrypt an envelope. A wrong key or a damaged file raises HelperError."""
    try:
        iv = base64.b64decode(envelope['cipher']['iv'])
        return aesgcm(key).decrypt(iv, base64.b64decode(envelope['data']), None).decode()
    except HelperError:
        raise
    except Exception:
        raise HelperError('The file could not be decrypted: wrong passphrase, or a damaged file.') from None


def iso(ts: float) -> str:
    """A Unix time as JavaScript's toISOString writes it (UTC, milliseconds)."""
    t = dt.datetime.fromtimestamp(ts, dt.timezone.utc)
    return t.strftime('%Y-%m-%dT%H:%M:%S.') + f'{t.microsecond // 1000:03d}Z'


def now_iso() -> str:
    return iso(time.time())


# ---------------------------------------------------------------------------
# GitHub's gist API, with the user's token.


class GitHub:
    def __init__(self, token: str, opener=urllib.request.urlopen) -> None:
        self.token = token
        self.opener = opener

    def request(self, method: str, url: str, body=None):
        """Send a request; the answer's JSON (or text for raw files)."""
        headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'mytasks-calendar-helper'}
        if url.startswith(API):
            headers['Authorization'] = f'Bearer {self.token}'
        data = json.dumps(body).encode() if body is not None else None
        if data is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self.opener(req, timeout=REQUEST_TIMEOUT) as res:
                text = res.read().decode()
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise HelperError('GitHub refused the token. Run setup again with a working token.') from None
            if e.code == 404:
                raise HelperError('The gist was not found. If it was recreated in My Tasks, run setup again.') from None
            raise HelperError(f'GitHub answered {e.code}.') from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise HelperError('GitHub could not be reached (offline?).') from None
        return json.loads(text) if url.startswith(API) and text else text

    def task_gists(self) -> list:
        """The user's gists holding mytasks.json: [{id, updated_at}], newest first."""
        found, page = [], 1
        while True:
            batch = self.request('GET', f'{API}/gists?per_page=100&page={page}')
            found += [{'id': g['id'], 'updated_at': g['updated_at']} for g in batch if TASKS_FILE in (g.get('files') or {})]
            if len(batch) < 100:
                return sorted(found, key=lambda g: g['updated_at'], reverse=True)
            page += 1

    def file(self, gist_id: str, name: str):
        """A file's full text in a gist, or None when the gist doesn't have it."""
        gist = self.request('GET', f'{API}/gists/{gist_id}')
        f = (gist.get('files') or {}).get(name)
        if not f:
            return None
        if not f.get('truncated') and isinstance(f.get('content'), str):
            return f['content']
        raw = f.get('raw_url') or ''
        if not raw.startswith(RAW_PREFIX):
            raise HelperError('GitHub gave an unexpected address for the file.')
        return self.request('GET', raw)

    def write(self, gist_id: str, name: str, content: str) -> None:
        """Replace one file in the gist; the others are left as they are."""
        self.request('PATCH', f'{API}/gists/{gist_id}', {'files': {name: {'content': content}}})


def gist_salt(gh: GitHub, gist_id: str) -> str:
    """The salt in the gist's mytasks.json."""
    env = parse_envelope(gh.file(gist_id, TASKS_FILE) or '', 'mytasks')
    if not env:
        raise HelperError('The gist has no My Tasks file the helper can read.')
    return env['kdf']['salt']


# ---------------------------------------------------------------------------
# The Keychain, through macOS's security command.


def security_quote(text: str) -> str:
    """A value quoted for `security -i`, which reads commands from its input."""
    return '"' + text.replace('\\', '\\\\').replace('"', '\\"') + '"'


def keychain_get(account: str, run=subprocess.run):
    """A value kept in the Keychain, or None."""
    r = run(['security', 'find-generic-password', '-s', SERVICE, '-a', account, '-w'], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return r.stdout[:-1] if r.stdout.endswith('\n') else r.stdout  # security adds one newline


def keychain_set(account: str, value: str, run=subprocess.run) -> None:
    """Keep a value in the Keychain. It's passed on standard input, never in the command line."""
    command = f'add-generic-password -U -s {security_quote(SERVICE)} -a {security_quote(account)} -w {security_quote(value)}\n'
    run(['security', '-i'], input=command, capture_output=True, text=True)
    if keychain_get(account, run) != value:
        raise HelperError('The Keychain did not keep the value. Try setup again.')


def secrets(run=subprocess.run):
    """The token and passphrase from the Keychain."""
    token, passphrase = keychain_get(TOKEN_ACCOUNT, run), keychain_get(PASSPHRASE_ACCOUNT, run)
    if not token or not passphrase:
        raise HelperError('The token or passphrase is not in the Keychain. Run setup first.')
    return token, passphrase


# ---------------------------------------------------------------------------
# Reading Calendar through EventKit (JavaScript for Automation, as Do Things).

# Read only: no EventKit save or remove call. Prints JSON: the access status
# and, with full access, the calendars and the events from the start of today
# for the number of days given (EventKit expands repeating events).
CALENDAR_JS = r"""
ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('EventKit');

function text(v) { return v === undefined || v === null || v.isNil() ? '' : ObjC.unwrap(v); }
function list(v) {
  const out = [];
  if (v === undefined || v === null || v.isNil()) return out;
  for (let i = 0; i < v.count; i++) out.push(v.objectAtIndex(i));
  return out;
}
function hexColor(c) {
  if (c === undefined || c.isNil()) return '';
  const rgb = c.colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);
  if (rgb.isNil()) return '';
  const p = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return '#' + p(rgb.redComponent) + p(rgb.greenComponent) + p(rgb.blueComponent);
}
function person(p) {
  const url = p.URL.isNil() ? '' : text(p.URL.absoluteString);
  return { name: text(p.name) || url.replace(/^mailto:/, ''), status: Number(p.participantStatus) };
}
function rule(r) {
  const end = r.recurrenceEnd;
  return {
    frequency: Number(r.frequency),
    interval: Number(r.interval),
    weekdays: list(r.daysOfTheWeek).map((d) => ({ day: Number(d.dayOfTheWeek), week: Number(d.weekNumber) })),
    monthDays: list(r.daysOfTheMonth).map((n) => Number(ObjC.unwrap(n))),
    endCount: end.isNil() ? 0 : Number(end.occurrenceCount),
    endDate: end.isNil() || end.endDate.isNil() ? null : Number(end.endDate.timeIntervalSince1970),
  };
}

function accessStatus() { return Number($.EKEventStore.authorizationStatusForEntityType(0)); }

// Ask for access when macOS hasn't asked yet, so it shows its prompt for the
// app that started the helper (Shortcuts, or Terminal). As in Do Things, the
// request's completion block doesn't reliably arrive in osascript, so this
// waits for the status to change instead, up to 60 seconds.
function requestAccess() {
  const store = $.EKEventStore.alloc.init;
  let answered = false;
  const done = () => { answered = true; };
  try {
    if (typeof store.requestFullAccessToEventsWithCompletion === 'function') store.requestFullAccessToEventsWithCompletion(done);
    else store.requestAccessToEntityTypeCompletion(0, done);
  } catch (err) {
    return;
  }
  const until = Date.now() + 60000;
  while (!answered && accessStatus() === 0 && Date.now() < until) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.25));
  }
}

function run(argv) {
  const days = Number(argv[0] || 14);
  if (accessStatus() === 0) requestAccess();
  const out = { status: accessStatus() };
  if (out.status !== 3) return JSON.stringify(out);
  const store = $.EKEventStore.alloc.init;
  out.calendars = list(store.calendarsForEntityType(0)).map((c) => ({
    id: text(c.calendarIdentifier),
    title: text(c.title),
    source: c.source.isNil() ? '' : text(c.source.title),
    color: hexColor(c.color),
  }));
  const cal = $.NSCalendar.currentCalendar;
  const start = cal.startOfDayForDate($.NSDate.date);
  const end = cal.dateByAddingUnitValueToDateOptions(16, days, start, 0);  // 16 = day unit
  const found = list(store.eventsMatchingPredicate(store.predicateForEventsWithStartDateEndDateCalendars(start, end, $())));
  out.events = found.map((e) => {
    let travel = null;
    try { const t = e.travelTime; if (t !== undefined && t !== null) travel = Number(t); } catch (err) { travel = null; }
    return {
      id: text(e.eventIdentifier),
      calendar: e.calendar.isNil() ? '' : text(e.calendar.calendarIdentifier),
      title: text(e.title),
      allDay: !!(e.allDay !== undefined ? e.allDay : e.isAllDay),
      start: Number(e.startDate.timeIntervalSince1970),
      end: Number(e.endDate.timeIntervalSince1970),
      status: Number(e.status),
      location: text(e.location),
      notes: text(e.notes),
      url: e.URL.isNil() ? '' : text(e.URL.absoluteString),
      attendees: list(e.attendees).map(person),
      organizer: e.organizer.isNil() ? '' : person(e.organizer).name,
      rules: list(e.recurrenceRules).map(rule),
      alarms: list(e.alarms).map((a) => (a.absoluteDate.isNil()
        ? { before: -Number(a.relativeOffset) / 60 }
        : { at: Number(a.absoluteDate.timeIntervalSince1970) })),
      availability: Number(e.availability),
      travel: travel,
    };
  });
  return JSON.stringify(out);
}
"""


def read_calendar(days: int, run=subprocess.run) -> dict:
    """What EventKit gives for the next `days` days (see CALENDAR_JS).

    The first time, macOS asks whether the app that started the helper may
    use Calendar; the script waits up to 60 seconds for the answer.
    """
    try:
        r = run(['osascript', '-l', 'JavaScript', '-', str(days)], input=CALENDAR_JS,
                capture_output=True, text=True, timeout=CALENDAR_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise HelperError('Reading Calendar took too long; trying again at the next reading.') from None
    if r.returncode != 0:
        raise HelperError(f'Calendar could not be read: {r.stderr.strip()[:300]}')
    raw = json.loads(r.stdout)
    status = raw.get('status')
    if status == NOT_ASKED:
        raise HelperError(
            "macOS's calendar prompt wasn't answered. Run the shortcut (or start the helper) "
            'again and click Allow when macOS asks.'
        )
    if status != FULL_ACCESS:
        raise HelperError(
            'No calendar access. In System Settings > Privacy & Security > Calendars, turn on '
            'Shortcuts (or Terminal, when running it there) with full access, then start the helper again.'
        )
    return raw


STATUSES = {0: 'unknown', 1: 'pending', 2: 'accepted', 3: 'declined', 4: 'tentative', 5: 'delegated', 6: 'completed', 7: 'in process'}
AVAILABILITY = {0: 'busy', 1: 'free', 2: 'tentative', 3: 'unavailable'}
UNITS = ['day', 'week', 'month', 'year']  # EKRecurrenceFrequency
WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']  # EKWeekday 1 to 7
ORDINALS = {1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', -1: 'last'}


def us_date(d: dt.date) -> str:
    """A date in US English, as the app writes dates (for example Dec 3, 2026)."""
    return f'{d.strftime("%b")} {d.day}, {d.year}'


def repeat_line(rule: dict) -> str:
    """A short description of a recurrence rule, for example "Every 2 weeks on Tue, Thu"."""
    unit = UNITS[rule['frequency']] if 0 <= rule.get('frequency', -1) < len(UNITS) else 'time'
    n = rule.get('interval') or 1
    line = f'Every {unit}' if n == 1 else f'Every {n} {unit}s'
    days = [(ORDINALS.get(w['week'], '') + ' ' if w.get('week') else '') + WEEKDAYS[w['day'] - 1]
            for w in rule.get('weekdays', []) if 1 <= w.get('day', 0) <= 7]
    if days:
        line += ' on ' + ', '.join(days)
    month_days = ['the last day' if d == -1 else f'day {d}' for d in rule.get('monthDays', [])]
    if month_days:
        line += ' on ' + ', '.join(month_days)
    if rule.get('endCount'):
        line += f', {rule["endCount"]} times'
    elif rule.get('endDate'):
        line += ' until ' + us_date(dt.datetime.fromtimestamp(rule['endDate']).date())
    return line


def local_date(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts).date().isoformat()


def event_entry(e: dict) -> dict:
    """One event as calendar.json holds it; empty optional fields are left out."""
    if e['allDay']:
        start, end = local_date(e['start']), local_date(max(e['start'], e['end'] - 1))  # last day included
    else:
        start, end = iso(e['start']), iso(e['end'])
    out = {'id': e['id'], 'calendar': e['calendar'], 'title': e['title'], 'allDay': e['allDay'], 'start': start, 'end': end}
    for field in ('location', 'notes', 'url', 'organizer'):
        if e.get(field):
            out[field] = e[field]
    attendees = [{'name': p['name'], 'status': STATUSES.get(p['status'], 'unknown')} for p in e.get('attendees', []) if p.get('name')]
    if attendees:
        out['attendees'] = attendees
    if e.get('rules'):
        out['repeat'] = repeat_line(e['rules'][0])
    alerts = [{'before': round(a['before'])} if 'before' in a else {'at': iso(a['at'])} for a in e.get('alarms', [])]
    if alerts:
        out['alerts'] = alerts
    if e.get('availability') in AVAILABILITY:
        out['availability'] = AVAILABILITY[e['availability']]
    if e.get('travel'):
        out['travelMinutes'] = round(e['travel'] / 60)
    return out


def last_day(today: dt.date, months: int) -> dt.date:
    """The last day read: the end of the month `months` months after this one."""
    month = today.month + months  # 1-based, may pass December
    year, month = today.year + (month - 1) // 12, (month - 1) % 12 + 1
    first_after = dt.date(year + (month == 12), month % 12 + 1, 1)
    return first_after - dt.timedelta(days=1)


def config_months(config: dict) -> int:
    """Months ahead from the settings. Setups before months (weeks) read 1 until setup is run again."""
    months = config.get('months')
    return months if isinstance(months, int) and MIN_MONTHS <= months <= MAX_MONTHS else MIN_MONTHS


def build_payload(raw: dict, chosen: list, last: dt.date, today: dt.date) -> dict:
    """calendar.json's contents, from `today` to `last`: the chosen calendars' events, canceled ones left out, in start order."""
    chosen_set = set(chosen)
    calendars = [{'id': c['id'], 'title': c['title'], 'color': c['color']} for c in raw['calendars'] if c['id'] in chosen_set]
    events = [e for e in raw['events'] if e['calendar'] in chosen_set and e.get('status') != CANCELED]
    events.sort(key=lambda e: (e['start'], not e['allDay'], e['title'], e['id']))
    return {
        'format': 1,
        'from': today.isoformat(),
        'to': last.isoformat(),
        'calendars': calendars,
        'events': [event_entry(e) for e in events],
    }


def digest(payload: dict) -> str:
    """A hash of the payload, to write only when something changed."""
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


# ---------------------------------------------------------------------------
# Settings and status files.


def path(name: str) -> str:
    return os.path.join(SUPPORT_DIR, name)


def load_json(name: str):
    try:
        with open(path(name), encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def save_json(name: str, value) -> None:
    os.makedirs(SUPPORT_DIR, exist_ok=True)
    tmp = path(name) + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(value, f, indent=2)
    os.replace(tmp, path(name))


def load_config() -> dict:
    config = load_json(CONFIG_FILE)
    if not config:
        raise HelperError('The helper is not set up yet. Run: python3 calendar_sync.py setup')
    return config


# ---------------------------------------------------------------------------
# One reading, and the loop.


def sync_once(config: dict, key: bytes, gh: GitHub, state: dict, read=read_calendar, today=None) -> bool:
    """Read the calendars and write calendar.json if anything changed. True if it wrote."""
    today = today or dt.date.today()
    last = last_day(today, config_months(config))
    payload = build_payload(read((last - today).days + 1), config['calendars'], last, today)
    h = digest(payload)
    state['lastCheck'] = now_iso()
    if h == state.get('hash'):
        return False
    if gist_salt(gh, config['gist']) != config['salt']:
        raise SaltChanged()
    envelope = seal(key, config['salt'], json.dumps(payload, separators=(',', ':')), now_iso())
    gh.write(config['gist'], CALENDAR_FILE, json.dumps(envelope))
    state.update(hash=h, lastWrite=state['lastCheck'], events=len(payload['events']))
    return True


def run_loop(every: int) -> int:
    """The background reading: every `every` minutes until stopped or the passphrase changes."""
    config = load_config()
    token, passphrase = secrets()
    key = derive_key(passphrase, config['salt'])
    gh = GitHub(token)
    state = load_json(STATE_FILE) or {}
    state.update(pid=os.getpid(), every=every, startedAt=now_iso(), error=None)
    with open(path(PID_FILE), 'w') as f:
        f.write(str(os.getpid()))
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        while True:
            try:
                sync_once(config, key, gh, state)
                state['error'] = None
            except SaltChanged as e:
                state['error'] = str(e)
                save_json(STATE_FILE, state)
                print(f'{now_iso()} {e}', flush=True)
                return 1
            except HelperError as e:
                state['error'] = str(e)
                print(f'{now_iso()} {e}', flush=True)
            save_json(STATE_FILE, state)
            time.sleep(every * 60)
    finally:
        if running_pid() == os.getpid():
            os.remove(path(PID_FILE))


# ---------------------------------------------------------------------------
# Commands.


def running_pid():
    """The pid of the helper running in the background, or None."""
    try:
        with open(path(PID_FILE)) as f:
            pid = int(f.read().strip())
    except (OSError, ValueError):
        return None
    r = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True)
    return pid if r.returncode == 0 and 'calendar_sync.py' in r.stdout else None


def stop() -> bool:
    """Stop the background helper. True if one was running."""
    pid = running_pid()
    if pid is None:
        return False
    os.kill(pid, signal.SIGTERM)
    for _ in range(50):  # up to 5 seconds
        if running_pid() != pid:
            break
        time.sleep(0.1)
    return True


def every_minutes(value: str) -> int:
    """argparse type for --every: whole minutes from 5 to 60."""
    try:
        n = int(value)
    except ValueError:
        n = 0
    if not MIN_EVERY <= n <= MAX_EVERY:
        raise argparse.ArgumentTypeError(f'must be a whole number of minutes from {MIN_EVERY} to {MAX_EVERY}')
    return n


def cmd_start(every: int) -> int:
    load_config()
    secrets()
    aesgcm(bytes(32))  # the package is installed
    replaced = stop()
    os.makedirs(SUPPORT_DIR, exist_ok=True)
    with open(path(LOG_FILE), 'a') as log:
        subprocess.Popen(
            [sys.executable, os.path.abspath(__file__), 'run', '--every', str(every)],
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
    print(f'{"Restarted" if replaced else "Started"}: reading your calendars every {every} minutes.')
    return 0


def cmd_stop() -> int:
    print('Stopped.' if stop() else 'The helper was not running.')
    return 0


def cmd_status() -> int:
    config, state = load_json(CONFIG_FILE), load_json(STATE_FILE) or {}
    if not config:
        print('Not set up. Run: python3 calendar_sync.py setup')
        return 0
    pid = running_pid()
    print(f'Running, every {state.get("every")} minutes.' if pid else 'Not running.')
    months = config_months(config)
    print(f'Calendars: {len(config["calendars"])}, this month and {months} {"month" if months == 1 else "months"} ahead.')
    print(f'Last check: {state.get("lastCheck") or "never"}')
    print(f'Last write: {state.get("lastWrite") or "never"} ({state.get("events", 0)} events)')
    if state.get('error'):
        print(f'Error: {state["error"]}')
    return 0


def cmd_check() -> int:
    config = load_config()
    token, passphrase = secrets()
    content = GitHub(token).file(config['gist'], CALENDAR_FILE)
    if content is None:
        print('The gist has no calendar.json yet.')
        return 1
    env = parse_envelope(content, ENVELOPE_APP)
    if not env:
        raise HelperError('calendar.json is not a calendar file the helper wrote.')
    payload = json.loads(unseal(derive_key(passphrase, env['kdf']['salt']), env))
    print(f'calendar.json: {len(payload["events"])} events from {len(payload["calendars"])} calendars, '
          f'{payload["from"]} to {payload["to"]}, written {env["updatedAt"]}.')
    return 0


def choose(prompt: str, count: int, allow_many: bool):
    """Numbers typed by the user (1-based), or None for Enter."""
    while True:
        answer = input(prompt).strip()
        if not answer:
            return None
        try:
            picks = sorted({int(x) for x in answer.replace(',', ' ').split()})
        except ValueError:
            picks = []
        if picks and all(1 <= p <= count for p in picks) and (allow_many or len(picks) == 1):
            return picks
        print(f'Type {"numbers" if allow_many else "a number"} from 1 to {count}.')


def cmd_setup() -> int:
    aesgcm(bytes(32))  # the package is installed
    print('My Tasks calendar helper setup. Nothing is saved until the end.\n')
    gh = GitHub(getpass.getpass('GitHub token (the one My Tasks uses; typing is hidden): ').strip())
    gists = gh.task_gists()
    if not gists:
        raise HelperError('No My Tasks gist was found for this token.')
    gist = gists[0]
    if len(gists) > 1:
        for i, g in enumerate(gists, 1):
            print(f'  {i}. gist {g["id"][:8]}…, updated {g["updated_at"]}')
        gist = gists[(choose('Which gist? (Enter for 1) ', len(gists), False) or [1])[0] - 1]
    env = parse_envelope(gh.file(gist['id'], TASKS_FILE) or '', 'mytasks')
    if not env:
        raise HelperError('The gist has no My Tasks file the helper can read.')
    salt = env['kdf']['salt']
    for tries in range(3):
        passphrase = getpass.getpass('Passphrase (typing is hidden): ')
        key = derive_key(passphrase, salt)
        try:
            unseal(key, env)
            break
        except HelperError:
            print('That passphrase does not open your tasks.' + (' Try again.' if tries < 2 else ''))
    else:
        return 1
    raw = read_calendar(1)
    print('\nYour calendars:')
    for i, c in enumerate(raw['calendars'], 1):
        print(f'  {i}. {c["title"]}' + (f' ({c["source"]})' if c['source'] else ''))
    picks = choose('Numbers of the calendars to show, separated by commas (Enter for all): ', len(raw['calendars']), True)
    calendars = [raw['calendars'][p - 1]['id'] for p in picks] if picks else [c['id'] for c in raw['calendars']]
    months = (choose(f'Months ahead, {MIN_MONTHS} to {MAX_MONTHS} (Enter for {DEFAULT_MONTHS}): ', MAX_MONTHS, False) or [DEFAULT_MONTHS])[0]
    keychain_set(TOKEN_ACCOUNT, gh.token)
    keychain_set(PASSPHRASE_ACCOUNT, passphrase)
    save_json(CONFIG_FILE, {'gist': gist['id'], 'salt': salt, 'calendars': calendars, 'months': months})
    save_json(STATE_FILE, {})  # the next start writes calendar.json at once
    print(f'\nSaved: {len(calendars)} calendars, this month and {months} months ahead. Start it with:')
    print(f'  {sys.executable} "{os.path.abspath(__file__)}" start --every {DEFAULT_EVERY}')
    if running_pid():
        print('The helper is running with the old settings: start it again to use these.')
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Calendar events for My Tasks: writes calendar.json to your gist.')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('setup', help='token, passphrase, calendars and months ahead')
    for name, text in (('start', 'read in the background, every N minutes'), ('run', argparse.SUPPRESS)):
        p = sub.add_parser(name, help=text)
        p.add_argument('--every', type=every_minutes, default=DEFAULT_EVERY, metavar='MINUTES',
                       help=f'minutes between readings, {MIN_EVERY} to {MAX_EVERY} (default {DEFAULT_EVERY})')
    sub.add_parser('stop', help='stop the background helper')
    sub.add_parser('status', help='running or not, the last write, any error')
    sub.add_parser('check', help='read calendar.json back from the gist and decrypt it')
    args = parser.parse_args(argv)
    try:
        if args.command == 'setup':
            return cmd_setup()
        if args.command == 'start':
            return cmd_start(args.every)
        if args.command == 'run':
            return run_loop(args.every)
        return {'stop': cmd_stop, 'status': cmd_status, 'check': cmd_check}[args.command]()
    except HelperError as e:
        print(e, file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print()
        return 1


if __name__ == '__main__':
    sys.exit(main())
