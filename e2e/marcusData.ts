/**
 * Marcus Reyes's tasks and calendar, for the book's screenshots
 * (`npm run screenshots:book`, e2e/book.shoot.ts). Marcus is fictional: a
 * self-employed tech reviewer in Boulder, Colorado, who hosts the weekly show
 * The Gadget Ledger with three contractors (Priya, producer and editor;
 * Jordan, social media; Dana, sponsorships), and a family man (Elena, a nurse
 * on rotating shifts; Sofia, 12, soccer; Leo, 8, piano; Biscuit the dog).
 *
 * Everything is built for `today`, so Today, Scheduled and the calendar always
 * read as a current week. Every feature the book shows has its example here:
 * his own priority labels and contexts, nested team and family tags,
 * sequential projects, repeating tasks and projects, a project with headings
 * and a checklist, ongoing projects that collect (Admin, Show Ideas, The Car,
 * a deferred Bucket List) so no task sits loose in an area, deferred ideas, waiting-on tasks (P5, tagged Waiting), saved searches and a few
 * completed tasks.
 *
 * tests/backup.test.ts checks that the backup passes Restore's checks and the
 * calendar passes the app's calendar checks.
 */
import { daysUntil, localDate, rule, sampleRecords } from './sampleRecords';

/** Days from `today` back to the latest `weekday` (0 when today is that day), as a negative offset. */
function daysSince(today: Date, weekday: number): number {
  return -((today.getDay() - weekday + 7) % 7);
}

/** Days from `today` to the `date`th of next month. */
function daysToNextMonth(today: Date, date: number): number {
  const next = new Date(today.getFullYear(), today.getMonth() + 1, date);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((next.getTime() - start.getTime()) / 86_400_000);
}

/** Days from `today` to the next January 6 (CES week). */
function daysToCes(today: Date): number {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let ces = new Date(today.getFullYear(), 0, 6);
  if (ces <= start) ces = new Date(today.getFullYear() + 1, 0, 6);
  return Math.round((ces.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Days from `today` to the Aurora X2 embargo: the Tuesday 7 to 13 days away.
 * Parent-teacher conferences fall the same afternoon (the book's Chapter 4 and
 * weekly review mention both).
 */
export function embargoDay(today: Date): number {
  return daysUntil(today, 2) + 7;
}

/** Days from `today` to Leo's recital: the Thursday 14 to 20 days away. */
export function recitalDay(today: Date): number {
  return daysUntil(today, 4) + 14;
}

/** The ongoing project each task that would otherwise sit straight in an area belongs to. */
const ONGOING: Record<string, string> = {
  'biz-1': 'admin', 'biz-2': 'admin', 'biz-3': 'admin', 'biz-4': 'admin', 'biz-5': 'admin', 'biz-6': 'admin',
  'sh-1': 'channel', 'sh-2': 'channel', 'sh-3': 'channel', 'done-1': 'channel', 'done-3': 'channel',
  'sh-4': 'ideas', 'sh-5': 'ideas', 'sh-6': 'ideas',
  'st-4': 'maint', 'st-5': 'maint',
  'fa-1': 'logistics', 'fa-2': 'logistics', 'fa-3': 'logistics', 'fa-4': 'logistics', 'fa-5': 'logistics', 'fa-6': 'logistics', 'done-2': 'logistics',
  'ho-1': 'household', 'ho-2': 'household', 'ho-3': 'household', 'ho-5': 'household',
  'ho-4': 'car',
  'he-1': 'habits', 'he-2': 'habits', 'he-3': 'habits',
};

/** Marcus's backup file's text, built for `today`. */
export function marcusBackup(today = new Date()): string {
  const { day, area, project, heading, todo, context, tag, item, search, backup } = sampleRecords(today);
  const now = day();
  const lastTue = daysSince(today, 2);
  const lastThu = daysSince(today, 4);
  const firstNext = daysToNextMonth(today, 1);
  const embargo = embargoDay(today);
  const recital = recitalDay(today);
  const ces = daysToCes(today);

  // Where things live.
  const show = { areaId: 'show' };
  const biz = { areaId: 'business' };
  const studio = { areaId: 'studio' };
  const family = { areaId: 'family' };
  const home = { areaId: 'home' };
  const health = { areaId: 'health' };
  const inToday = { startDate: now };

  const projects = [
    // A repeating project whose copies are sequential: each Tuesday's copy keeps one step in Today.
    project('episode', 'Weekly Episode', {
      ...show,
      tagIds: ['step'],
      startDate: day(lastTue),
      notes: 'The main review episode. Publishes Friday at 6 a.m.',
      repeat: rule({ unit: 'week', weekdays: [2] }),
    }),
    project('aurora', 'Review: Aurora X2 phone', {
      ...show,
      tagIds: ['step', 'embargo'],
      deadline: day(embargo),
      notes: 'Embargo lifts at 7 a.m. Mountain on the deadline. Review unit goes back to Halcyon Mobile after.',
    }),
    project('rings', 'Quick Takes: Smart Rings Roundup', { ...show, deadline: day(4) }),
    project('lumen', 'Review: Lumen Buds Pro', { ...show, startDate: day(16) }),
    project('ces', 'CES Trip', { ...show, deadline: day(ces), notes: 'Las Vegas. Flying out the day before the show opens.' }),
    project('sponsor-report', 'Monthly Sponsor Report', {
      ...biz,
      startDate: day(firstNext),
      tagIds: ['sponsor'],
      repeat: rule({ unit: 'month', days: [{ ordinal: 1, weekday: null }] }),
    }),
    project('taxes', 'Quarterly Estimated Taxes', {
      ...biz,
      startDate: day(daysToNextMonth(today, 1) + 14),
      repeat: rule({ unit: 'month', interval: 3, days: [{ ordinal: 15, weekday: null }], deadlineDays: 0 }),
    }),
    project('nimbus', 'Nimbus VPN Sponsorship', { ...biz, tagIds: ['sponsor'], deadline: day(12) }),
    project('studio-upgrade', 'Studio Upgrade', { ...studio }),
    project('basement', 'Basement Office Remodel', {
      ...home,
      tagIds: ['step'],
      notes: 'Move the studio downstairs so recording stops waking Leo.',
    }),
    project('winter', 'Winter Break Plans', { ...family, startDate: day(20) }),
    project('birthday', "Sofia's 13th Birthday", { ...family, start: 'deferred' }),
    project('review', 'Friday Review', {
      startDate: day(daysUntil(today, 5) || 7),
      notes: 'Twenty minutes, Friday afternoon, before the weekend starts.',
      repeat: rule({ unit: 'week', weekdays: [5] }),
    }),
    // Ongoing projects: collections that never finish, so no task sits loose in an area.
    project('channel', 'Listeners and Social', { ...show }),
    project('ideas', 'Show Ideas', { ...show }),
    project('admin', 'Admin', { ...biz }),
    project('maint', 'Studio Maintenance', { ...studio }),
    project('logistics', 'Family Logistics', { ...family }),
    project('bucket', 'Bucket List', { ...family, start: 'deferred', notes: 'Things we want to do together, one day.' }),
    project('household', 'Household', { ...home }),
    project('car', 'The Car', { ...home }),
    project('habits', 'Health Habits', { ...health }),
  ];

  const headings = [
    heading('ep-research', 'episode', 'Research'),
    heading('ep-record', 'episode', 'Record'),
    heading('ep-edit', 'episode', 'Edit'),
    heading('ep-publish', 'episode', 'Publish'),
    heading('ep-promote', 'episode', 'Promote'),
    heading('ces-before', 'ces', 'Before I go'),
    heading('ces-pack', 'ces', 'Packing'),
    heading('ces-show', 'ces', 'At the show'),
  ];

  const ep = (h: string) => ({ projectId: 'episode', headingId: `ep-${h}` });
  const ce = (h: string) => ({ projectId: 'ces', headingId: `ces-${h}` });

  const todos = [
    // The Inbox: captured this morning, not yet sorted.
    todo('in-email', 'Reply to Halcyon PR about a second Aurora unit'),
    todo('in-school', "Sign Leo's field trip form"),
    todo('in-idea', 'Idea: episode on repairable phones'),
    todo('in-mic', 'Look at the new Rode mic arm Jordan mentioned'),
    todo('in-car', 'Car making a noise when it turns left'),

    // Weekly Episode (the template; its tasks keep no dates).
    todo('ep-1', 'Pick the main review and two news stories', ep('research')),
    todo('ep-2', 'Write the outline and cold open', ep('research')),
    todo('ep-3', 'Book studio time with Priya', { ...ep('record'), tagIds: ['priya'] }),
    todo('ep-4', 'Record the episode', { ...ep('record'), contextId: 'studio' }),
    todo('ep-5', 'Upload raw audio and video for Priya', { ...ep('record'), contextId: 'desk', tagIds: ['priya'] }),
    todo('ep-6', "Review Priya's cut", { ...ep('edit'), contextId: 'desk' }),
    todo('ep-7', 'Record pickups for any fixes', { ...ep('edit'), contextId: 'studio' }),
    todo('ep-8', 'Write show notes and chapter markers', { ...ep('publish'), contextId: 'desk' }),
    todo('ep-9', 'Schedule the episode for Friday 6 a.m.', { ...ep('publish'), contextId: 'desk' }),
    todo('ep-10', 'Send Jordan three clip timestamps', { ...ep('promote'), tagIds: ['jordan'] }),
    todo('ep-11', 'Answer listener comments', { ...ep('promote'), contextId: 'low' }),

    // The Aurora X2 review: sequential, embargoed.
    todo('au-1', 'Unbox and photograph the Aurora X2', { projectId: 'aurora', status: 'completed', contextId: 'studio' }),
    todo('au-2', 'Use it as my only phone for 7 days', {
      projectId: 'aurora',
      ...inToday,
      priority: 1,
      notes: 'Day 3 of 7. Battery notes in the journal.',
    }),
    todo('au-3', 'Run camera and battery tests', { projectId: 'aurora', contextId: 'studio' }),
    todo('au-4', 'Write the review script', { projectId: 'aurora', contextId: 'desk' }),
    todo('au-5', 'Record the review', { projectId: 'aurora', contextId: 'studio' }),
    todo('au-6', 'Priya: edit the review', { projectId: 'aurora', tagIds: ['priya'] }),
    todo('au-7', 'Publish when the embargo lifts', { projectId: 'aurora', contextId: 'desk' }),

    // Quick Takes.
    todo('qt-1', 'Wear each ring for two nights', { projectId: 'rings', ...inToday, contextId: 'home', priority: 2 }),
    todo('qt-2', 'Compare the sleep scores in a table', { projectId: 'rings', contextId: 'desk' }),
    todo('qt-3', 'Jordan: thumbnail with all four rings', { projectId: 'rings', tagIds: ['jordan', 'waiting'], priority: 5 }),
    todo('qt-4', 'Record Quick Takes', { projectId: 'rings', contextId: 'studio', startDate: day(2) }),

    // Lumen Buds Pro: starts later.
    todo('lb-1', 'Unbox the Lumen Buds Pro', { projectId: 'lumen' }),
    todo('lb-2', 'Two weeks of commuting and gym use', { projectId: 'lumen' }),

    // CES.
    todo('ces-1', 'Book flights to Las Vegas', { ...ce('before'), contextId: 'desk', startDate: day(3), priority: 2 }),
    todo('ces-2', 'Book hotel near the convention center', { ...ce('before'), contextId: 'desk', startDate: day(3) }),
    todo('ces-3', 'Set up meetings with five brands', { ...ce('before'), tagIds: ['dana'], startDate: day(10) }),
    todo('ces-4', 'Packing list', { ...ce('pack') }),
    todo('ces-5', 'Shoot a daily recap video', { ...ce('show'), contextId: 'out' }),
    todo('ces-6', 'Collect press kits for the follow-up episode', { ...ce('show'), contextId: 'out' }),

    // Monthly Sponsor Report (template).
    todo('sr-1', 'Pull download numbers for the month', { projectId: 'sponsor-report' }),
    todo('sr-2', 'Fill in each sponsor’s report', { projectId: 'sponsor-report' }),
    todo('sr-3', 'Send the reports to Dana', { projectId: 'sponsor-report', tagIds: ['dana'] }),

    // Quarterly Estimated Taxes (template).
    todo('tx-1', 'Total income and expenses for the quarter', { projectId: 'taxes' }),
    todo('tx-2', 'Send the numbers to the accountant', { projectId: 'taxes' }),
    todo('tx-3', 'Pay federal and Colorado estimates', { projectId: 'taxes' }),

    // Nimbus VPN sponsorship.
    todo('nv-1', 'Dana: signed contract from Nimbus VPN', { projectId: 'nimbus', tagIds: ['dana', 'waiting'], priority: 5 }),
    todo('nv-2', 'Write the 60-second ad read', { projectId: 'nimbus', contextId: 'desk', startDate: day(1), deadline: day(5) }),
    todo('nv-3', 'Record the ad read', { projectId: 'nimbus', contextId: 'studio', deadline: day(8) }),
    todo('nv-4', 'Send Nimbus the tracking link for show notes', { projectId: 'nimbus', contextId: 'desk' }),

    // Business, loose tasks.
    todo('biz-1', 'Invoice Brightline for October reads', { ...biz, ...inToday, contextId: 'desk', deadline: now, priority: 1 }),
    todo('biz-2', 'Call the bank about the business card limit', { ...biz, ...inToday, contextId: 'phone', priority: 2 }),
    todo('biz-3', 'Pay Priya and Jordan for November', { ...biz, contextId: 'desk', deadline: day(10), startDate: day(8) }),
    todo('biz-4', 'Dana: rate card for next year', { ...biz, tagIds: ['dana', 'waiting'], priority: 5 }),
    todo('biz-5', 'Renew the podcast host plan', { ...biz, startDate: day(14), contextId: 'desk' }),
    todo('biz-6', 'Invoice sponsors for the month', {
      ...biz,
      startDate: day(daysToNextMonth(today, 0)),
      contextId: 'desk',
      repeat: rule({ unit: 'month', days: [{ ordinal: -1, weekday: null }] }),
    }),

    // The Gadget Ledger, loose tasks.
    todo('sh-1', 'Answer the Aurora questions in the listener mailbag', { ...show, ...inToday, contextId: 'low', priority: 3 }),
    todo('sh-2', 'Priya: rough cut of the Quick Takes intro', { ...show, tagIds: ['priya', 'waiting'], priority: 5 }),
    todo('sh-3', 'Jordan: post the Aurora teaser on embargo day', { ...show, tagIds: ['jordan', 'embargo', 'waiting'], priority: 5 }),
    todo('sh-4', 'Plan the end-of-year best gadgets episode', { ...show, startDate: day(12) }),
    todo('sh-5', 'Start a newsletter', { ...show, start: 'deferred' }),
    todo('sh-6', 'Learn colour grading', { ...show, start: 'deferred' }),

    // Studio.
    todo('st-1', 'Order acoustic panels for the back wall', { projectId: 'studio-upgrade', contextId: 'desk', priority: 3 }),
    todo('st-2', 'Replace the flickering key light', { projectId: 'studio-upgrade', contextId: 'out' }),
    todo('st-3', 'Try a second camera angle', { projectId: 'studio-upgrade', start: 'deferred' }),
    todo('st-4', 'Back up the studio drives', {
      ...studio,
      startDate: day(daysUntil(today, 0) || 7),
      contextId: 'studio',
      repeat: rule({ unit: 'week', weekdays: [0] }),
    }),
    todo('st-5', 'Return the Aurora X2 review unit', { ...studio, startDate: day(embargo + 2), tagIds: ['embargo'] }),

    // The basement: sequential.
    todo('bm-1', 'Get three quotes', { projectId: 'basement', status: 'completed' }),
    todo('bm-2', 'Apply for the permit', { projectId: 'basement', ...inToday, contextId: 'desk', priority: 3 }),
    todo('bm-3', 'Book the electrician', { projectId: 'basement', contextId: 'phone' }),
    todo('bm-4', 'Drywall and paint', { projectId: 'basement' }),
    todo('bm-5', 'Move the studio downstairs', { projectId: 'basement' }),

    // Family.
    todo('fa-1', "Pick up Sofia's new cleats", { ...family, ...inToday, contextId: 'out', tagIds: ['sofia'], priority: 2 }),
    todo('fa-2', "Pay Leo's piano lessons for December", { ...family, contextId: 'phone', tagIds: ['leo'], deadline: day(6), startDate: day(3) }),
    todo('fa-3', 'Swap Thursday school pickup with Elena', { ...family, ...inToday, contextId: 'phone', tagIds: ['elena'], priority: 2 }),
    todo('fa-4', "Give Biscuit his heartworm pill", {
      ...family,
      startDate: day(daysToNextMonth(today, 5)),
      contextId: 'home',
      repeat: rule({ unit: 'month', days: [{ ordinal: 5, weekday: null }] }),
    }),
    todo('fa-5', 'Plan date night', {
      ...family,
      startDate: day(daysUntil(today, 3) || 7),
      tagIds: ['elena'],
      notes: 'Check Elena’s shifts first.',
      repeat: rule({ unit: 'week', interval: 2, weekdays: [3] }),
    }),
    todo('fa-6', "Buy Leo's recital outfit", { ...family, startDate: day(recital - 5), contextId: 'out', tagIds: ['leo'] }),
    todo('fa-7', 'Book the cabin for winter break', { projectId: 'winter', contextId: 'desk' }),
    todo('fa-8', 'Ski lessons for Sofia and Leo', { projectId: 'winter', tagIds: ['sofia', 'leo'] }),
    todo('fa-9', 'Ask Sofia what kind of party she wants', { projectId: 'birthday', tagIds: ['sofia'] }),
    todo('fa-10', 'Book the venue', { projectId: 'birthday' }),

    // Home.
    todo('ho-1', 'Recycling out', {
      ...home,
      startDate: day(lastThu),
      contextId: 'home',
      repeat: rule({ unit: 'week', weekdays: [4] }),
    }),
    todo('ho-2', 'Pay the mortgage', {
      ...home,
      startDate: day(firstNext),
      contextId: 'desk',
      repeat: rule({ unit: 'month', days: [{ ordinal: 1, weekday: null }], deadlineDays: 0 }),
    }),
    todo('ho-3', 'Change the furnace filter', {
      ...home,
      startDate: day(5),
      contextId: 'home',
      repeat: rule({ mode: 'afterCompletion', unit: 'month', interval: 3 }),
    }),
    todo('ho-4', 'Get the snow tires on', { ...home, ...inToday, contextId: 'out', deadline: day(1), priority: 2 }),
    todo('ho-5', 'Clean out the garage', { ...home, start: 'deferred' }),

    // Health and Fitness.
    todo('he-1', 'Run 5 miles', {
      ...health,
      startDate: day(daysUntil(today, 6) || 7),
      repeat: rule({ unit: 'week', weekdays: [1, 3, 6] }),
    }),
    todo('he-2', 'Book the dentist cleaning', { ...health, contextId: 'phone', startDate: day(6) }),
    todo('he-3', 'Stretch for 10 minutes', { ...health, ...inToday, contextId: 'low', priority: 4 }),

    // Friday Review (template).
    todo('fr-1', 'Empty the Inbox'),
    todo('fr-2', 'Look through each area'),
    todo('fr-3', 'Check Waiting on team'),
    todo('fr-4', 'Look ahead two weeks in Scheduled'),
    todo('fr-5', 'Revisit what’s deferred'),
    todo('fr-6', 'Pick the top three for Monday'),

    // The family's Bucket List (deferred).
    todo('bl-1', 'See the Northern Lights', { projectId: 'bucket', tagIds: ['fam'] }),
    todo('bl-2', 'Take Leo to hear a real orchestra', { projectId: 'bucket', tagIds: ['leo'] }),
    todo('bl-3', 'Drive the Pacific Coast Highway', { projectId: 'bucket', tagIds: ['fam'] }),
    todo('car-2', 'Oil change', { projectId: 'car', startDate: day(18), contextId: 'out' }),

    // Done this week.
    todo('done-1', 'Send Halcyon the shipping address', { ...show, status: 'completed' }),
    todo('done-2', "Renew Biscuit's dog licence", { ...family, status: 'completed' }),
    todo('done-3', 'Quick Takes: foldables follow-up published', { ...show, status: 'completed' }),
  ]
    .map((t) => (t.id.startsWith('fr-') ? { ...t, projectId: 'review', start: 'unscheduled' as const } : t))
    .map((t) => (t.areaId ? { ...t, areaId: null, projectId: ONGOING[t.id] } : t));

  const checklistItems = [
    item('ces-4', 'Laptop and both chargers', true),
    item('ces-4', 'Camera, two batteries, spare SD cards'),
    item('ces-4', 'Wireless mics and windscreens'),
    item('ces-4', 'Press badge printout'),
    item('ces-4', 'Comfortable shoes'),
    item('au-3', 'Camera: daylight, low light, portrait'),
    item('au-3', 'Battery: video loop until 5%'),
    item('au-3', 'Charging: 0 to 100 with the stock charger'),
  ];

  const tags = [
    tag('team', 'Team'),
    tag('priya', 'Priya', 'team'),
    tag('jordan', 'Jordan', 'team'),
    tag('dana', 'Dana', 'team'),
    tag('fam', 'Family'),
    tag('elena', 'Elena', 'fam'),
    tag('sofia', 'Sofia', 'fam'),
    tag('leo', 'Leo', 'fam'),
    tag('sponsor', 'Sponsor'),
    tag('embargo', 'Embargo'),
    tag('step', 'Step by step'),
    tag('waiting', 'Waiting'),
  ];

  const contexts = [
    context('studio', 'Studio (mic on)'),
    context('desk', 'Desk'),
    context('phone', 'Phone'),
    context('out', 'Out and about'),
    context('home', 'Home'),
    context('low', 'Low energy'),
  ];

  return backup(
    {
      areas: [
        area('show', 'The Gadget Ledger'),
        area('business', 'Business'),
        area('studio', 'Studio'),
        area('family', 'Family'),
        area('home', 'Home'),
        area('health', 'Health and Fitness'),
      ],
      projects,
      headings,
      todos,
      checklistItems,
      tags,
      contexts,
      savedSearches: [
        search('waiting', 'Waiting on team', { tagIds: ['waiting'] }),
        search('sponsors', 'Sponsor work', { tagIds: ['sponsor'] }),
      ],
    },
    [
      { key: 'priorityLabels', value: ['Must today', 'This week', 'Soon', 'Nice to have', 'Waiting on someone'] },
      { key: 'sequentialTags', value: [{ tagId: 'step', priority: 2, contextId: null }] },
    ],
  );
}

/** A local time `days` from `today`, as the UTC timestamp the calendar helper writes. */
function at(today: Date, days: number, hours: number, minutes = 0): string {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, hours, minutes).toISOString();
}

/**
 * Marcus's calendar.json, as the Mac helper writes it, built for `today`: his
 * show, team, family, Elena's shifts and personal calendars, for this week and
 * the next two months.
 */
export function marcusCalendar(today = new Date()) {
  const d = (days: number) => localDate(today, days);
  /** Week offsets for this week and the next eight, so every week looks alike. */
  const weeks = Array.from({ length: 9 }, (_, w) => w * 7);
  /** Days from today to a weekday in each of those weeks: the latest one so far, then a week apart. */
  const on = (weekday: number) => weeks.map((w) => w + daysSince(today, weekday));
  const ces = daysToCes(today);
  const events: object[] = [];
  const add = (e: object) => events.push(e);

  for (const day of on(1)) {
    add({ id: 'team-call', calendar: 'team', title: 'Team call', allDay: false, start: at(today, day, 9), end: at(today, day, 9, 30),
      url: 'https://meet.example.com/gadget-ledger', repeat: 'Every week on Mon',
      attendees: [{ name: 'Priya Shah', status: 'accepted' }, { name: 'Jordan Kim', status: 'accepted' }, { name: 'Dana Okafor', status: 'tentative' }],
      organizer: 'Marcus Reyes' });
    add({ id: 'piano', calendar: 'family', title: 'Leo: piano lesson', allDay: false, start: at(today, day, 16), end: at(today, day, 16, 45),
      location: 'Pearl Street Music', repeat: 'Every week on Mon' });
  }
  for (const day of on(2)) {
    add({ id: 'record', calendar: 'show', title: 'Record: Weekly Episode', allDay: false, start: at(today, day, 10), end: at(today, day, 12),
      location: 'Studio', repeat: 'Every week on Tue', availability: 'busy' });
    add({ id: 'soccer-tue', calendar: 'family', title: 'Sofia: soccer practice', allDay: false, start: at(today, day, 17, 30), end: at(today, day, 19),
      location: 'Stazio Ballfields', repeat: 'Every week on Tue, Thu' });
  }
  for (const day of on(4)) {
    add({ id: 'edit-review', calendar: 'team', title: 'Edit review with Priya', allDay: false, start: at(today, day, 14), end: at(today, day, 15),
      url: 'https://meet.example.com/priya', repeat: 'Every week on Thu' });
    add({ id: 'soccer-thu', calendar: 'family', title: 'Sofia: soccer practice', allDay: false, start: at(today, day, 17, 30), end: at(today, day, 19),
      location: 'Stazio Ballfields', repeat: 'Every week on Tue, Thu' });
  }
  for (const day of on(5)) {
    add({ id: 'publish', calendar: 'show', title: 'Episode publishes', allDay: false, start: at(today, day, 6), end: at(today, day, 6, 15),
      repeat: 'Every week on Fri', alerts: [{ before: 0 }] });
  }
  for (const day of on(6)) {
    add({ id: 'game', calendar: 'family', title: 'Sofia: soccer game', allDay: false, start: at(today, day, 9), end: at(today, day, 10, 30),
      location: 'Boulder County Fairgrounds, Field 3', notes: 'Orange slices are our turn on the 3rd.' });
  }
  // Elena's shifts: three a week, a different pattern each week.
  const patterns = [[1, 3, 6], [0, 2, 4], [2, 5, 6]];
  weeks.forEach((w, i) => {
    for (const wd of patterns[i % 3]) {
      const day = w + daysSince(today, wd);
      add({ id: `shift-${w}-${wd}`, calendar: 'shifts', title: 'Elena: day shift, 7 to 7', allDay: true, start: d(day), end: d(day),
        location: 'Foothills Hospital' });
    }
  });
  // Date night every other Friday.
  for (const day of on(5).filter((_, i) => i % 2 === 0)) {
    add({ id: 'date', calendar: 'family', title: 'Date night', allDay: false, start: at(today, day, 19), end: at(today, day, 22),
      location: 'Frasca', repeat: 'Every 2 weeks on Fri' });
  }
  // One-offs.
  add({ id: 'interview', calendar: 'show', title: 'Guest interview: Noor Haddad (Pocket Review)', allDay: false,
    start: at(today, 1, 13), end: at(today, 1, 14), location: 'Studio',
    attendees: [{ name: 'Noor Haddad', status: 'accepted' }], organizer: 'Marcus Reyes', alerts: [{ before: 15 }] });
  add({ id: 'nimbus-call', calendar: 'show', title: 'Sponsor call: Nimbus VPN', allDay: false, start: at(today, 2, 11), end: at(today, 2, 11, 30),
    url: 'https://meet.example.com/nimbus', notes: 'Dana joins. Talking reads for Q1.', attendees: [{ name: 'Dana Okafor', status: 'accepted' }] });
  add({ id: 'embargo', calendar: 'show', title: 'Aurora X2 embargo lifts', allDay: true, start: d(embargoDay(today)), end: d(embargoDay(today)) });
  add({ id: 'dentist', calendar: 'personal', title: 'Dentist', allDay: false, start: at(today, 6, 8), end: at(today, 6, 9), location: 'Canyon Dental' });
  add({ id: 'vet', calendar: 'personal', title: 'Biscuit: vet check-up', allDay: false, start: at(today, 13, 15, 30), end: at(today, 13, 16), location: 'Arapahoe Animal Clinic' });
  add({ id: 'recital', calendar: 'family', title: "Leo's piano recital", allDay: false, start: at(today, recitalDay(today), 18), end: at(today, recitalDay(today), 19, 30), location: 'Pearl Street Music' });
  add({ id: 'conferences', calendar: 'family', title: 'Parent-teacher conferences', allDay: false, start: at(today, embargoDay(today), 16), end: at(today, embargoDay(today), 17), location: 'Whittier Elementary' });
  add({ id: 'gym', calendar: 'personal', title: 'Spin class', allDay: false, start: at(today, 3, 6, 30), end: at(today, 3, 7, 15) });
  if (ces < 70) add({ id: 'ces', calendar: 'show', title: 'CES', allDay: true, start: d(ces), end: d(ces + 3), location: 'Las Vegas' });

  return {
    format: 1,
    from: d(0),
    to: d(62),
    calendars: [
      { id: 'show', title: 'Gadget Ledger', color: '#1d7ff2' },
      { id: 'team', title: 'Team', color: '#8e5bd8' },
      { id: 'family', title: 'Family', color: '#2fa84f' },
      { id: 'shifts', title: "Elena's Shifts", color: '#f08c1a' },
      { id: 'personal', title: 'Personal', color: '#e0453a' },
    ],
    events,
  };
}
