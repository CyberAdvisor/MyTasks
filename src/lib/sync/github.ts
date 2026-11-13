/**
 * GitHub Gist client (FR-19). Plain `fetch` against api.github.com, with the
 * user's personal access token; no library and no server.
 *
 * Every failure becomes a GistError with a code the UI turns into words:
 * - `token`: the token was rejected (bad, expired or revoked)
 * - `scope`: the token works but lacks the `gist` scope
 * - `offline`: no answer (no network, GitHub unreachable, or no answer
 *   within REQUEST_TIMEOUT_MS)
 * - `ratelimit`: GitHub is limiting requests until `retryAt`
 * - `notfound`: the gist no longer exists
 * - `server`: any other error from GitHub, including a raw-file address
 *   that is not on gist.githubusercontent.com
 */

import { MAX_FILE_CHARS } from './crypto';

const API = 'https://api.github.com';

/** The only place the full text of a long gist file is fetched from. */
export const RAW_ORIGIN = 'https://gist.githubusercontent.com';

/** How long a request, its answer included, may take before it counts as offline. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** The one file in the My Tasks gist. */
export const GIST_FILE = 'mytasks.json';

/** Description of the gist the app creates. */
export const GIST_DESCRIPTION = 'My Tasks';

export type GistErrorCode = 'token' | 'scope' | 'offline' | 'ratelimit' | 'notfound' | 'server';

export class GistError extends Error {
  constructor(
    readonly code: GistErrorCode,
    /** For `ratelimit`: when requests may start again. */
    readonly retryAt: Date | null = null,
  ) {
    super(`GitHub request failed: ${code}`);
  }
}

/** A My Tasks gist found in the user's account. */
export interface GistRef {
  id: string;
  /** When GitHub last saw it change. */
  updatedAt: string;
}

/**
 * Turn an unsuccessful response into a GistError. A rate limit carries when
 * it ends: GitHub's reset time, or else its Retry-After seconds.
 */
function errorFor(res: Response): GistError {
  const remaining = res.headers.get('x-ratelimit-remaining');
  const retryAfter = res.headers.get('retry-after');
  if ((res.status === 403 || res.status === 429) && (remaining === '0' || retryAfter !== null || res.status === 429)) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const after = Number(retryAfter);
    if (reset) return new GistError('ratelimit', new Date(reset * 1000));
    if (after) return new GistError('ratelimit', new Date(Date.now() + after * 1000));
    return new GistError('ratelimit');
  }
  if (res.status === 401 || res.status === 403) return new GistError('token');
  if (res.status === 404) return new GistError('notfound');
  return new GistError('server');
}

/**
 * Fetch `url` and read its answer with `read`, all within REQUEST_TIMEOUT_MS.
 * No answer in time, or no network, is `offline`; an unsuccessful answer
 * becomes its GistError.
 */
async function timedFetch<T>(url: string, init: RequestInit, read: (res: Response) => Promise<T>): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: abort.signal });
    } catch {
      throw new GistError('offline');
    }
    if (!res.ok) throw errorFor(res);
    try {
      return await read(res);
    } catch (e) {
      if (abort.signal.aborted) throw new GistError('offline');
      throw e;
    }
  } finally {
    clearTimeout(timer);
  }
}

/** One API request, its successful answer read with `read`. */
function request<T>(method: string, path: string, token: string, read: (res: Response) => Promise<T>, body?: unknown): Promise<T> {
  return timedFetch(
    API + path,
    {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    },
    read,
  );
}

/** Read an answer as JSON. */
const json = <T>(res: Response) => res.json() as Promise<T>;

/** True when `url` is a gist raw-file address on RAW_ORIGIN. */
export function isRawUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    return new URL(url).origin === RAW_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Check a token: it must be accepted, and a classic token must carry the
 * `gist` scope. (Fine-grained tokens report no scopes; GitHub refuses their
 * gist requests later with `token` if they lack access.) Resolves to the
 * GitHub account the token belongs to.
 */
export async function checkToken(token: string): Promise<string> {
  const user = await request('GET', '/user', token, async (res) => ({
    scopes: res.headers.get('x-oauth-scopes'),
    login: ((await res.json()) as { login?: unknown }).login,
  }));
  if (user.scopes !== null && !user.scopes.split(',').map((s) => s.trim()).includes('gist')) throw new GistError('scope');
  if (typeof user.login !== 'string') throw new GistError('server');
  return user.login;
}

/**
 * The GitHub account that owns a gist, as `token` sees it, or null when the
 * token can't reach the gist (GitHub answers not found).
 */
export async function gistOwner(token: string, id: string): Promise<string | null> {
  try {
    const gist = await request('GET', `/gists/${id}`, token, json<{ owner?: { login?: unknown } }>);
    if (typeof gist.owner?.login !== 'string') throw new GistError('server');
    return gist.owner.login;
  } catch (e) {
    if (e instanceof GistError && e.code === 'notfound') return null;
    throw e;
  }
}

/** Every gist in the account that holds the My Tasks file, newest first. */
export async function findGists(token: string): Promise<GistRef[]> {
  const found: GistRef[] = [];
  for (let page = 1; ; page++) {
    const list = await request('GET', `/gists?per_page=100&page=${page}`, token, json<{ id: string; updated_at: string; files: Record<string, unknown> }[]>);
    for (const g of list) if (g.files?.[GIST_FILE]) found.push({ id: g.id, updatedAt: g.updated_at });
    if (list.length < 100) break;
  }
  return found.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/**
 * The My Tasks file in a gist, or null when the gist no longer has it.
 * GitHub cuts long files short in the API answer; then the full file is
 * fetched from its raw address, which must be on gist.githubusercontent.com.
 * A file larger than MAX_FILE_CHARS is not fetched: its cut-short text is
 * returned, which then fails the envelope check (crypto.ts) as not valid.
 */
export async function readGist(token: string, id: string): Promise<string | null> {
  const gist = await request(
    'GET',
    `/gists/${id}`,
    token,
    json<{ files: Record<string, { content?: string; truncated?: boolean; raw_url?: string; size?: number } | undefined> }>,
  );
  const file = gist.files?.[GIST_FILE];
  if (!file) return null;
  if (!file.truncated && typeof file.content === 'string') return file.content;
  if ((file.size ?? 0) > MAX_FILE_CHARS) return file.content ?? '';
  if (!isRawUrl(file.raw_url)) throw new GistError('server');
  return timedFetch(file.raw_url, { cache: 'no-store' }, (res) => res.text());
}

/** Create the secret My Tasks gist holding `content`. Resolves to its id. */
export async function createGist(token: string, content: string): Promise<string> {
  const created = await request('POST', '/gists', token, json<{ id: string }>, {
    description: GIST_DESCRIPTION,
    public: false,
    files: { [GIST_FILE]: { content } },
  });
  return created.id;
}

/** Replace the My Tasks file in an existing gist. */
export async function writeGist(token: string, id: string, content: string): Promise<void> {
  await request('PATCH', `/gists/${id}`, token, async () => undefined, { files: { [GIST_FILE]: { content } } });
}
