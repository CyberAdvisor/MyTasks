/**
 * The places a task can be moved to (FR-1.5): the Inbox, then each area with
 * its projects and their headings, then projects with no area. Used by the
 * Move dialog and Quick Entry's destination list (DestinationList.svelte).
 *
 * A filter (review F10) keeps the places whose name contains every word
 * typed, ignoring case and accents, with the area and project above each so
 * you can tell where it is.
 */
import type { TodoPlacement } from '../db/repo';
import { areaProjects, type Snapshot } from './lists';
import { bySortKey } from './order';
import { fold } from './search';
import type { ID } from './types';

/** One row of the list. `depth` is its indent: 0 for the Inbox, areas and loose projects. */
export interface Destination {
  kind: 'inbox' | 'area' | 'project' | 'heading';
  id: string;
  title: string;
  depth: number;
  to: TodoPlacement;
  /** Shown because it matches the filter (or there is none), not only as a match's area or project. */
  match: boolean;
}

/** Every place, in order, then narrowed to `query` when it has words. */
export function destinations(s: Snapshot, query = ''): Destination[] {
  const headings = (projectId: ID) =>
    bySortKey(s.headings.filter((h) => h.projectId === projectId && h.deletedAt === null && !h.archived));
  const project = (p: { id: ID; title: string }, depth: number): Destination[] => [
    { kind: 'project', id: p.id, title: p.title || 'New Project', depth, to: { projectId: p.id }, match: true },
    ...headings(p.id).map((h) => ({
      kind: 'heading' as const,
      id: h.id,
      title: h.title || 'Untitled heading',
      depth: depth + 1,
      to: { projectId: p.id, headingId: h.id },
      match: true,
    })),
  ];
  const all: Destination[] = [
    { kind: 'inbox', id: 'inbox', title: 'Inbox', depth: 0, to: {}, match: true },
    ...bySortKey(s.areas.filter((a) => a.deletedAt === null)).flatMap((a) => [
      { kind: 'area' as const, id: a.id, title: a.title || 'New Area', depth: 0, to: { areaId: a.id }, match: true },
      ...areaProjects(s, a.id).flatMap((p) => project(p, 1)),
    ]),
    ...areaProjects(s, null).flatMap((p) => project(p, 0)),
  ];
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return all;
  const matches = (d: Destination) => words.every((w) => fold(d.title).includes(w));
  // Keep each match, and the area and project rows above it.
  const keep = new Set<number>();
  all.forEach((d, i) => {
    if (!matches(d)) return;
    keep.add(i);
    let depth = d.depth;
    for (let j = i - 1; j >= 0 && depth > 0; j--) {
      if (all[j].depth < depth) {
        keep.add(j);
        depth = all[j].depth;
      }
    }
  });
  return all.flatMap((d, i) => (keep.has(i) ? [{ ...d, match: matches(d) }] : []));
}
