"""
Task reminders in Apple Reminders, for the calendar helper (FR-21.10).

calendar_sync.py calls `sync` on every reading, with each set-up gist's
decrypted mytasks.json. Every open task with a reminder gets a reminder in
the one Reminders list chosen at setup (title, due date with an alert, and
the project's name in the notes):

- a task with a date and time: one reminder;
- a repeating task's template with a regular schedule: one repeating
  reminder, built from its rule, at the template's time on its next date;
  its copies get none of their own;
- an after-completion repeat, and a repeating project's copies: a reminder
  for each copy, since a copy carries the date and time itself.

Only the title, notes, due date and repeat are ever set, and only when the
task's own title, project, reminder or rule changes, so what the user sets in
Reminders (such as Urgent) is left alone. Completing a task completes its
reminder; canceling, trashing, deleting it or clearing its reminder removes
it. A reminder ticked or deleted in Reminders isn't made again until the
task's reminder changes.

Which reminder belongs to which task is kept in reminders-state.json in the
helper's folder, under "<gist id>:<task id>". If that file is lost (or a
second Mac runs the helper), the list's reminders are matched again by title
and time rather than made twice.

EventKit is reached through JavaScript for Automation (osascript), as the
calendar is read. REMINDERS_JS answers one request at a time:

    {"action": "lists"}                    the reminder lists
    {"action": "create-list", "title": t}  make a list
    {"action": "read", "list": id}         the list's open reminders
    {"action": "apply", "list": id, "ops": [...]}

and prints JSON with the access status.
"""
from __future__ import annotations

import json
import re
import subprocess

NOT_ASKED = 0  # EKAuthorizationStatusNotDetermined
FULL_ACCESS = 3  # EKAuthorizationStatusFullAccess
TIMEOUT = 90  # seconds: up to 60 waiting for an answer to macOS's prompt, then the work
DEFAULT_LIST = 'My Tasks'
UNTITLED = 'Untitled task'

AT = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d$')  # a task's reminder: a local date and time
TIME = re.compile(r'^\d\d:\d\d$')  # a template's reminder: a time only
FREQUENCY = {'day': 0, 'week': 1, 'month': 2, 'year': 3}  # EKRecurrenceFrequency


class RemindersError(Exception):
    """A problem with Reminders, reported in one line; the calendar carries on."""


# ---------------------------------------------------------------------------
# EventKit, through JavaScript for Automation.

REMINDERS_JS = r"""
ObjC.import('Foundation');
ObjC.import('EventKit');

const REMINDER = 1;  // EKEntityTypeReminder

function text(v) { return v === undefined || v === null || v.isNil() ? '' : ObjC.unwrap(v); }
function list(v) {
  const out = [];
  if (v === undefined || v === null || v.isNil()) return out;
  for (let i = 0; i < v.count; i++) out.push(v.objectAtIndex(i));
  return out;
}
function pad(n) { return String(n).padStart(2, '0'); }
function wait(done, ms) {
  const until = Date.now() + ms;
  while (!done() && Date.now() < until) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
}

function accessStatus() { return Number($.EKEventStore.authorizationStatusForEntityType(REMINDER)); }

// Ask when macOS hasn't asked yet, so it shows its prompt for the app that
// started the helper; as for Calendar, wait for the status to change, up to
// 60 seconds.
function requestAccess() {
  const store = $.EKEventStore.alloc.init;
  const done = () => {};
  try {
    if (typeof store.requestFullAccessToRemindersWithCompletion === 'function') store.requestFullAccessToRemindersWithCompletion(done);
    else store.requestAccessToEntityTypeCompletion(REMINDER, done);
  } catch (err) {
    return;
  }
  wait(() => accessStatus() !== 0, 60000);
}

// "YYYY-MM-DDTHH:MM" (or a date alone) from a reminder's due date.
function dueOf(r) {
  const c = r.dueDateComponents;
  if (c.isNil()) return null;
  const y = Number(c.year), m = Number(c.month), d = Number(c.day), h = Number(c.hour), mi = Number(c.minute);
  if (!(y > 0 && y < 10000 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = y + '-' + pad(m) + '-' + pad(d);
  return h >= 0 && h < 24 ? date + 'T' + pad(h) + ':' + pad(mi >= 0 && mi < 60 ? mi : 0) : date;
}

// A local date and time as date components, in this Mac's time zone.
function components(due) {
  const [date, time] = due.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = (time || '09:00').split(':').map(Number);
  const c = $.NSDateComponents.alloc.init;
  c.setCalendar($.NSCalendar.currentCalendar);
  c.setTimeZone($.NSTimeZone.localTimeZone);
  c.setYear(y); c.setMonth(m); c.setDay(d); c.setHour(h); c.setMinute(mi);
  return c;
}

// The end of a local day, for a repeat's end date.
function endOfDay(date) {
  const c = components(date + 'T23:59');
  return $.NSCalendar.currentCalendar.dateFromComponents(c);
}

// An EKRecurrenceRule from the helper's description of a task's rule.
function recurrence(spec) {
  const days = spec.weekdays.map((w) => $.EKRecurrenceDayOfWeek.dayOfWeekWeekNumber(w.day, w.week));
  const end = spec.endCount ? $.EKRecurrenceEnd.recurrenceEndWithOccurrenceCount(spec.endCount)
    : spec.endDate ? $.EKRecurrenceEnd.recurrenceEndWithEndDate(endOfDay(spec.endDate)) : $();
  return $.EKRecurrenceRule.alloc.initRecurrenceWithFrequencyIntervalDaysOfTheWeekDaysOfTheMonthMonthsOfTheYearWeeksOfTheYearDaysOfTheYearSetPositionsEnd(
    spec.frequency, spec.interval,
    days.length ? $(days) : $(), spec.monthDays.length ? $(spec.monthDays) : $(), spec.months.length ? $(spec.months) : $(),
    $(), $(), $(), end);
}

function setDue(r, due) {
  r.setDueDateComponents(components(due));
  list(r.alarms).forEach((a) => r.removeAlarm(a));
  r.addAlarm($.EKAlarm.alarmWithRelativeOffset(0));  // at the due time, on every occurrence
}

function entry(r) {
  return { id: text(r.calendarItemIdentifier), title: text(r.title), due: dueOf(r), repeats: !!r.hasRecurrenceRules };
}

function findList(store, id) {
  return list(store.calendarsForEntityType(REMINDER)).find((c) => text(c.calendarIdentifier) === id) || null;
}

function openReminders(store, cal) {
  let found = null;
  store.fetchRemindersMatchingPredicateCompletion(
    store.predicateForIncompleteRemindersWithDueDateStartingEndingCalendars($(), $(), $([cal])),
    (rs) => { found = list(rs); });
  wait(() => found !== null, 30000);
  if (found === null) throw new Error('Reminders did not answer in time.');
  return found;
}

// One change; an error message, or '' when it worked.
function apply(store, cal, op, created) {
  let r;
  if (op.op === 'create') {
    r = $.EKReminder.reminderWithEventStore(store);
    r.setCalendar(cal);
  } else {
    r = store.calendarItemWithIdentifier(op.id);
    if (r.isNil() || text(r.calendar.calendarIdentifier) !== text(cal.calendarIdentifier)) return 'missing';
  }
  const error = Ref();
  if (op.op === 'delete') return store.removeReminderCommitError(r, true, error) ? '' : 'could not be removed';
  if (op.op === 'complete') r.setCompleted(true);
  if ('title' in op) r.setTitle(op.title);
  if ('notes' in op) r.setNotes(op.notes || $());
  if ('rule' in op) r.setRecurrenceRules(op.rule ? $([recurrence(op.rule)]) : $());
  if ('due' in op) setDue(r, op.due);
  if (!store.saveReminderCommitError(r, true, error)) return 'could not be saved';
  if (op.op === 'create') created[op.ref] = text(r.calendarItemIdentifier);
  return '';
}

function run(argv) {
  const req = JSON.parse(argv[0]);
  if (accessStatus() === 0) requestAccess();
  const out = { status: accessStatus() };
  if (out.status !== 3) return JSON.stringify(out);
  const store = $.EKEventStore.alloc.init;
  if (req.action === 'lists') {
    out.lists = list(store.calendarsForEntityType(REMINDER)).map((c) => ({ id: text(c.calendarIdentifier), title: text(c.title) }));
    return JSON.stringify(out);
  }
  if (req.action === 'create-list') {
    const cal = $.EKCalendar.calendarForEntityTypeEventStore(REMINDER, store);
    cal.setTitle(req.title);
    cal.setSource(store.defaultCalendarForNewReminders.source);
    if (!store.saveCalendarCommitError(cal, true, Ref())) throw new Error('The list could not be made.');
    out.id = text(cal.calendarIdentifier);
    return JSON.stringify(out);
  }
  const cal = findList(store, req.list);
  if (!cal) { out.missingList = true; return JSON.stringify(out); }
  if (req.action === 'read') {
    out.open = openReminders(store, cal).map(entry);
    return JSON.stringify(out);
  }
  out.created = {};
  out.failed = {};
  req.ops.forEach((op) => {
    let problem;
    try { problem = apply(store, cal, op, out.created); } catch (err) { problem = String(err); }
    if (problem) out.failed[op.ref || op.id] = problem;
  });
  return JSON.stringify(out);
}
"""


def run_js(request: dict, run=subprocess.run) -> dict:
    """Send one request to REMINDERS_JS; its answer, once access is given."""
    try:
        r = run(['osascript', '-l', 'JavaScript', '-', json.dumps(request)], input=REMINDERS_JS,
                capture_output=True, text=True, timeout=TIMEOUT)
    except subprocess.TimeoutExpired:
        raise RemindersError('Reminders took too long to answer; trying again at the next reading.') from None
    if r.returncode != 0:
        raise RemindersError(f'Reminders could not be reached: {r.stderr.strip()[:300]}')
    answer = json.loads(r.stdout)
    if answer.get('status') == NOT_ASKED:
        raise RemindersError(
            "macOS's Reminders prompt wasn't answered. Run the shortcut (or start the helper) "
            'again and click Allow when macOS asks.'
        )
    if answer.get('status') != FULL_ACCESS:
        raise RemindersError(
            'No Reminders access. In System Settings > Privacy & Security > Reminders, turn on '
            'Shortcuts (or Terminal, when running it there), then start the helper again.'
        )
    if answer.get('missingList'):
        raise RemindersError('The Reminders list the helper uses was not found. Run setup again to choose one.')
    return answer


# ---------------------------------------------------------------------------
# Which reminders the tasks call for.


def records(payload: dict, table: str) -> dict:
    """A table of the decrypted task list by id, leaving out anything that isn't a record."""
    rows = ((payload.get('tables') or {}).get(table)) or []
    return {r['id']: r for r in rows if isinstance(r, dict) and isinstance(r.get('id'), str)}


def is_open(task: dict, projects: dict) -> bool:
    """Open, not in the Trash or deleted, and not in a project that is."""
    if task.get('deletedAt') or task.get('trashedAt') or task.get('status') != 'open':
        return False
    project = projects.get(task.get('projectId'))
    return not (project and (project.get('deletedAt') or project.get('trashedAt')))


def recurrence(rule: dict) -> dict | None:
    """
    A task's repeat rule (RepeatRule in src/lib/model/types.ts) as REMINDERS_JS
    builds an EKRecurrenceRule: weekdays 1 (Sunday) to 7, a day of the month
    (−1 for the last) or a weekday with its week (2nd Tuesday, −1 for the
    last), and the copies still to come when it ends after a number of times.
    None when the rule can't be expressed (or has no copies left).
    """
    if rule.get('unit') not in FREQUENCY:
        return None
    weekdays, month_days = [], []
    if rule['unit'] == 'week':
        weekdays = [{'day': d + 1, 'week': 0} for d in rule.get('weekdays') or [] if isinstance(d, int) and 0 <= d <= 6]
    elif rule['unit'] in ('month', 'year'):
        for day in rule.get('days') or []:
            ordinal, weekday = day.get('ordinal'), day.get('weekday')
            if not isinstance(ordinal, int):
                continue
            if weekday is None:
                month_days.append(ordinal)
            elif isinstance(weekday, int) and 0 <= weekday <= 6:
                weekdays.append({'day': weekday + 1, 'week': ordinal})
    spec = {
        'frequency': FREQUENCY[rule['unit']],
        'interval': max(1, int(rule.get('interval') or 1)),
        'weekdays': weekdays,
        'monthDays': month_days,
        'months': [rule['month']] if rule['unit'] == 'year' and rule.get('month') else [],
        'endCount': 0,
        'endDate': rule.get('endDate'),
    }
    if rule.get('endCount'):
        spec['endCount'] = rule['endCount'] - (rule.get('made') or 0)
        if spec['endCount'] <= 0:
            return None
    return spec


def wanted(gist_id: str, payload: dict) -> tuple[dict, set]:
    """
    The reminders one gist's tasks call for, by key, and the keys of its
    completed tasks (whose reminders are completed rather than removed; a
    canceled task's is removed).
    """
    todos, projects = records(payload, 'todos'), records(payload, 'projects')
    out, completed = {}, set()
    regular = {}  # template id: its repeat reminder's spec, before the date is worked out
    for t in todos.values():
        key = f'{gist_id}:{t["id"]}'
        if t.get('status') == 'completed' and not t.get('trashedAt') and not t.get('deletedAt'):
            completed.add(key)
        reminder, rule = t.get('reminder'), t.get('repeat')
        if not isinstance(reminder, str) or not is_open(t, projects):
            continue
        project = projects.get(t.get('projectId')) or {}
        if project.get('repeat'):
            continue  # a task in a repeating project's template: its copies have their own
        base = {'title': t.get('title') or UNTITLED, 'notes': project.get('title') or '', 'value': reminder}
        if isinstance(rule, dict):
            spec = recurrence(rule)
            if (rule.get('mode') == 'fixed' and not rule.get('paused') and spec and TIME.match(reminder)
                    and isinstance(t.get('startDate'), str)):
                regular[t['id']] = dict(base, kind='repeat', rule=spec, date=t['startDate'], time=reminder)
        elif AT.match(reminder):
            out[key] = dict(base, kind='once', rule=None, due=reminder)
    for t in todos.values():  # a regular repeat's copies are its one reminder's occurrences
        template = t.get('repeatOf')
        if template in regular:
            out.pop(f'{gist_id}:{t["id"]}', None)
            if is_open(t, projects) and isinstance(t.get('reminder'), str) and AT.match(t['reminder']):
                day = t['reminder'][:10]  # its earliest open copy is the occurrence still to come
                regular[template]['date'] = min(regular[template]['date'], day)
    for template, spec in regular.items():
        date, time_ = spec.pop('date'), spec.pop('time')
        out[f'{gist_id}:{template}'] = dict(spec, due=f'{date}T{time_}')
    return out, completed


# ---------------------------------------------------------------------------
# Matching the tasks to the list.


def plan(want: dict, completed: set, items: dict, open_list: list) -> tuple[list, dict]:
    """
    The changes that bring the list in line with `want`, and the pairing
    afterwards. `items` is the pairing from last time ({key: {id, kind, title,
    notes, due, rule, value, done?}}), `open_list` the list's open reminders
    as REMINDERS_JS reads them. Keys of gists not read this time must be left
    out of `want` and `items` by the caller.
    """
    live = {r['id']: r for r in open_list}
    claimed = {e['id'] for e in items.values() if e.get('id')}
    ops, after = [], {}
    for key, e in items.items():
        w = want.get(key)
        if e.get('done'):
            if w and w['value'] == e['value']:
                after[key] = e  # ticked or deleted in Reminders: not made again
            continue
        r = live.get(e['id'])
        if r is None:
            if w:
                after[key] = dict(e, done=True)
            continue
        if not w or w['kind'] != e['kind']:
            how = 'complete' if key in completed and e['kind'] == 'once' and not w else 'delete'
            ops.append({'op': how, 'id': e['id']})
            continue
        change = {f: w[f] for f in ('title', 'notes') if w[f] != e[f]}
        if w['kind'] == 'once':
            if w['due'] != e['due']:
                change['due'] = w['due']
        elif w['rule'] != e['rule'] or w['due'][10:] != e['due'][10:]:
            change.update(rule=w['rule'], due=w['due'])
        elif r['due'] and r['due'][:10] < w['due'][:10]:
            change['due'] = w['due']  # its occurrence was done in My Tasks: on to the next
        if change:
            ops.append(dict(change, op='change', id=e['id']))
        after[key] = dict(e, title=w['title'], notes=w['notes'], rule=w['rule'], value=w['value'],
                          due=change.get('due', e['due']))
    for key, w in want.items():
        if key in after:
            continue
        found = next((r for r in open_list if r['id'] not in claimed and r['title'] == w['title'] and r['due']
                      and (r['due'] == w['due'] if w['kind'] == 'once' else r['repeats'] and r['due'][10:] == w['due'][10:])),
                     None)
        entry = {f: w[f] for f in ('kind', 'title', 'notes', 'due', 'rule', 'value')}
        if found:  # made earlier, by a lost pairing or another Mac
            claimed.add(found['id'])
            after[key] = dict(entry, id=found['id'])
            continue
        ops.append({'op': 'create', 'ref': key, 'title': w['title'], 'notes': w['notes'], 'due': w['due'], 'rule': w['rule']})
        after[key] = dict(entry, id=None)
    return ops, after


def sync(settings: dict, lists: dict, state: dict, js=run_js) -> int:
    """
    Bring the Reminders list in line with the gists read this time (`lists`:
    {gist id: decrypted mytasks.json}). `settings` is the helper's reminders
    setting ({list, title}); `state` the pairing, kept between runs. How many
    changes were made.
    """
    items = state.setdefault('items', {})
    read = set(lists)
    mine = {k: e for k, e in items.items() if k.split(':', 1)[0] in read}
    want, completed = {}, set()
    for gist_id, payload in lists.items():
        w, c = wanted(gist_id, payload)
        want.update(w)
        completed |= c
    open_list = js({'action': 'read', 'list': settings['list']})['open']
    ops, after = plan(want, completed, mine, open_list)
    if ops:
        answer = js({'action': 'apply', 'list': settings['list'], 'ops': ops})
        for key, e in after.items():
            if e['id'] is None:
                e['id'] = answer['created'].get(key)
        failed = answer.get('failed') or {}
        for key, e in list(after.items()):
            if e['id'] is None:
                del after[key]  # not made: tried again next time
            elif failed.get(e['id']) == 'missing':
                after[key] = dict(e, done=True)
    state['items'] = {k: e for k, e in items.items() if k.split(':', 1)[0] not in read}
    state['items'].update(after)
    return len(ops)


def counts(state: dict) -> dict:
    """How many reminders each gist has in the list: {gist id: n}."""
    out = {}
    for key, e in (state.get('items') or {}).items():
        if not e.get('done'):
            gist_id = key.split(':', 1)[0]
            out[gist_id] = out.get(gist_id, 0) + 1
    return out


# ---------------------------------------------------------------------------
# Setup.


def choose_list(ask=input, js=run_js) -> dict | None:
    """
    Setup's question: which list gets the reminders. A number picks one, Enter
    uses (or makes) "My Tasks", 0 leaves reminders off (None).
    """
    lists = js({'action': 'lists'})['lists']
    same = next((entry for entry in lists if entry['title'] == DEFAULT_LIST), None)
    enter = f'Enter to use your list "{DEFAULT_LIST}"' if same else f'Enter to make a new list named "{DEFAULT_LIST}"'
    print('\nReminders: each task with a reminder can get one in Apple Reminders, in one list for all your gists.')
    print('Your Reminders lists:')
    for i, entry in enumerate(lists, 1):
        print(f'  {i}. {entry["title"]}')
    while True:
        answer = ask(f'List for reminders: a number from the list above, {enter}, or 0 for none: ').strip()
        if answer == '0':
            return None
        if not answer:
            return {'list': same['id'], 'title': DEFAULT_LIST} if same else {'list': None, 'title': DEFAULT_LIST}
        if answer.isdigit() and 1 <= int(answer) <= len(lists):
            chosen = lists[int(answer) - 1]
            return {'list': chosen['id'], 'title': chosen['title']}
        print(f'Type a number from 1 to {len(lists)}, Enter, or 0.')


def make_list(choice: dict, js=run_js) -> dict:
    """The chosen list, made now if it's a new one."""
    if choice['list']:
        return choice
    return dict(choice, list=js({'action': 'create-list', 'title': choice['title']})['id'])
