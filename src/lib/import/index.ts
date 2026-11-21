/**
 * Import (FR-12.6): read a CSV file in the template's format (FR-12.9),
 * preview what it adds, then add it. The preview's plan is built against
 * what the device holds now; the import builds it again inside its
 * transaction, so a sync in between can't make it stale.
 */
import * as repo from '../db/repo';
import { nowIso, uuidv7 } from '../model/ids';
import { today } from '../model/dates';
import { CsvError, parseCsv } from './csv';
import { ImportError, readRows, type ImportRow } from './rows';
import { buildPlan, planCounts, planMatches, type ImportPlan } from './plan';

export { planCounts, planMatches };

/** A checked file waiting for the preview's Import. */
export interface PreparedImport {
  rows: ImportRow[];
  plan: ImportPlan;
}

/** Check a file's text completely and build its preview. Throws with a message to show. */
export async function prepareImport(text: string): Promise<PreparedImport> {
  const rows = readRows(parseCsv(text));
  const plan = buildPlan(rows, await repo.importExisting(), today(), nowIso(), uuidv7);
  return { rows, plan };
}

/** The message for a file that can't be imported. */
export function importProblem(e: unknown): string {
  if (e instanceof ImportError || e instanceof CsvError) return `${e.message} Nothing was imported.`;
  return 'This file couldn’t be read. Nothing was imported.';
}
