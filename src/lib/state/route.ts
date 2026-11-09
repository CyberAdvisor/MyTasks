/**
 * Hash-based routing.
 *
 * Routes: `#/inbox`, `#/today`, `#/scheduled`, `#/unscheduled`, `#/deferred`,
 * `#/logbook`, `#/trash`, `#/area/<id>`, `#/project/<id>`, `#/settings`, and `#/` (the
 * phone Home screen of lists). Hash routes work on any static host.
 */
import { readable, type Readable } from 'svelte/store';
import type { BuiltInList } from '../model/lists';
import type { ID } from '../model/types';

export type Route =
  | { kind: 'home' }
  | { kind: 'list'; list: BuiltInList }
  | { kind: 'area'; id: ID }
  | { kind: 'project'; id: ID }
  | { kind: 'settings' };

const LISTS: BuiltInList[] = ['inbox', 'today', 'scheduled', 'unscheduled', 'deferred', 'logbook', 'trash'];

/** Parse a location hash into a Route. Unknown hashes go Home. */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { kind: 'home' };
  if (parts[0] === 'area' && parts[1]) return { kind: 'area', id: parts[1] };
  if (parts[0] === 'project' && parts[1]) return { kind: 'project', id: parts[1] };
  if (parts[0] === 'settings') return { kind: 'settings' };
  if ((LISTS as string[]).includes(parts[0])) return { kind: 'list', list: parts[0] as BuiltInList };
  return { kind: 'home' };
}

/** Build the hash for a route. */
export function hrefFor(r: Route): string {
  switch (r.kind) {
    case 'home':
      return '#/';
    case 'list':
      return `#/${r.list}`;
    case 'area':
      return `#/area/${r.id}`;
    case 'project':
      return `#/project/${r.id}`;
    case 'settings':
      return '#/settings';
  }
}

/** Navigate to a route. */
export function go(r: Route): void {
  location.hash = hrefFor(r);
}

/** The current route, following hash changes. */
export const route: Readable<Route> = readable<Route>(parseHash(location.hash), (set) => {
  const onChange = () => set(parseHash(location.hash));
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
});
