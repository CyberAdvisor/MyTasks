/**
 * A real Todoist export (FR-12.13) of a test project, its author's name and
 * id replaced: byte-order mark, CRLF line ends and blank rows as Todoist
 * writes them. Shared by tests/todoist.test.ts and e2e/import.spec.ts.
 */
export const TODOIST_EXPORT =
  "\ufeffTYPE,CONTENT,DESCRIPTION,ICON,IS_COLLAPSED,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG,REMINDER_TYPE,REMINDER_OFFSET,REMINDER_DATE,REMINDER_DATE_LANG\nmeta,view_style=list,Project description for the export test.,,,,,,,,,,,,,,,,,\n,,,,,,,,,,,,,,,,,,,\ntask,Weekly review @claudetest,Task description line one,,,2,1,Sam (1000001),,every friday at 4pm,en,America/Denver,,,,,,,,\nnote,A comment on the task,,,,,,Sam (1000001),,2026-11-25T13:10:31.530000Z,,,,,,,,,,\ntask,Sub-task one,,,,4,2,Sam (1000001),,,,America/Denver,,,,,,,,\ntask,Pay invoice,,,,1,1,Sam (1000001),,Nov 26,en,America/Denver,,,,,,,,\ntask,Plain task with,,,,4,1,Sam (1000001),,,,America/Denver,,,,,,,,\n,,,,,,,,,,,,,,,,,,,\nsection,Section A,,,False,,,,,,,,,,,,,,,\ntask,Pay rent,,,,3,1,Sam (1000001),,every 1st,en,America/Denver,,,,,,,,\n,,,,,,,,,,,,,,,,,,,";
