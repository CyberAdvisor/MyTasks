/**
 * Import (FR-12.6): read a CSV file in the template's format (FR-12.9), or
 * one or more Todoist exports (FR-12.13), preview what it adds, then add it.
 * The preview's plan is built against what the device holds now; the import
 * builds it again inside its transaction, so a sync in between can't make
 * it stale.
 */
import * as repo from '../db/repo';
import { nowIso, uuidv7 } from '../model/ids';
import { today } from '../model/dates';
import { CsvError, parseCsv } from './csv';
import { ImportError, readRows, type ImportRow } from './rows';
import { buildPlan, planCounts, planMatches, type ImportPlan } from './plan';
import { convertTodoist, isTodoistExport } from './todoist';

export { planCounts, planMatches };

/** A picked file: its name and its text. */
export interface PickedFile {
  name: string;
  text: string;
}

/** A checked file (or files) waiting for the preview's Import. */
export interface PreparedImport {
  rows: ImportRow[];
  plan: ImportPlan;
  /** The file's name, or "3 files". */
  name: string;
  /** Set when the files were Todoist exports: the projects they make, and the tasks whose dates couldn't be read. */
  todoist: { projects: string[]; unreadable: number } | null;
}

/** Check the picked files completely and build their preview. Throws with a message to show. */
export async function prepareImport(files: PickedFile[]): Promise<PreparedImport> {
  if (!files.length) throw new ImportError(null, 'No file was picked.');
  const tables = files.map((f) => ({ name: f.name, table: parseCsv(f.text) }));
  const todoist = tables.every((t) => isTodoistExport(t.table));
  if (!todoist && tables.length > 1)
    throw new ImportError(null, 'Several files can be imported together only when they’re all Todoist exports. Pick one file in My Tasks’ format at a time.');

  const ref = today();
  const converted = todoist ? convertTodoist(tables, ref) : null;
  const rows = readRows(converted ? converted.table : tables[0].table);
  const plan = buildPlan(rows, await repo.importExisting(), ref, nowIso(), uuidv7);
  return {
    rows,
    plan,
    name: files.length === 1 ? files[0].name : `${files.length} files`,
    todoist: converted && { projects: converted.projects, unreadable: converted.unreadable },
  };
}

/** The message for a file that can't be imported. */
export function importProblem(e: unknown): string {
  if (e instanceof ImportError || e instanceof CsvError) return `${e.message} Nothing was imported.`;
  return 'This file couldn’t be read. Nothing was imported.';
}
