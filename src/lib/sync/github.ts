/**
 * GitHub Gist client (FR-19). Plain `fetch` against api.github.com, with the
 * user's personal access token; no library and no server.
 *
 * Every failure becomes a GistError with a code the UI turns into words:
 * - `token`: the token was rejected (bad, expired or revoked)
 * - `scope`: the token works but lacks the `gist` scope
 * - `offline`: no answer (no network, or GitHub unreachable)
 * - `ratelimit`: GitHub is limiting requests until `retryAt`
 * - `notfound`: the gist no longer exists
 * - `server`: any other error from GitHub
 */

const API = 'https://api.github.com';

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

/** Turn an unsuccessful response into a GistError. */
function errorFor(res: Response): GistError {
  const remaining = res.headers.get('x-ratelimit-remaining');
  if ((res.status === 403 || res.status === 429) && (remaining === '0' || res.status === 429)) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    return new GistError('ratelimit', reset ? new Date(reset * 1000) : null);
  }
  if (res.status === 401 || res.status === 403) return new GistError('token');
  if (res.status === 404) return new GistError('notfound');
  return new GistError('server');
}

/** One API request. Resolves to the response once it is known to be OK. */
async function request(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new GistError('offline');
  }
  if (!res.ok) throw errorFor(res);
  return res;
}

/**
 * Check a token: it must be accepted, and a classic token must carry the
 * `gist` scope. (Fine-grained tokens report no scopes; GitHub refuses their
 * gist requests later with `token` if they lack access.)
 */
export async function checkToken(token: string): Promise<void> {
  const res = await request('GET', '/user', token);
  const scopes = res.headers.get('x-oauth-scopes');
  if (scopes !== null && !scopes.split(',').map((s) => s.trim()).includes('gist')) throw new GistError('scope');
}

/** Every gist in the account that holds the My Tasks file, newest first. */
export async function findGists(token: string): Promise<GistRef[]> {
  const found: GistRef[] = [];
  for (let page = 1; ; page++) {
    const list = (await (await request('GET', `/gists?per_page=100&page=${page}`, token)).json()) as {
      id: string;
      updated_at: string;
      files: Record<string, unknown>;
    }[];
    for (const g of list) if (g.files?.[GIST_FILE]) found.push({ id: g.id, updatedAt: g.updated_at });
    if (list.length < 100) break;
  }
  return found.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/**
 * The My Tasks file in a gist, or null when the gist no longer has it.
 * GitHub cuts long files short in the API answer; then the full file is
 * fetched from its raw address.
 */
export async function readGist(token: string, id: string): Promise<string | null> {
  const gist = (await (await request('GET', `/gists/${id}`, token)).json()) as {
    files: Record<string, { content?: string; truncated?: boolean; raw_url?: string } | undefined>;
  };
  const file = gist.files?.[GIST_FILE];
  if (!file) return null;
  if (!file.truncated && typeof file.content === 'string') return file.content;
  let res: Response;
  try {
    res = await fetch(file.raw_url!, { cache: 'no-store' });
  } catch {
    throw new GistError('offline');
  }
  if (!res.ok) throw errorFor(res);
  return res.text();
}

/** Create the secret My Tasks gist holding `content`. Resolves to its id. */
export async function createGist(token: string, content: string): Promise<string> {
  const res = await request('POST', '/gists', token, {
    description: GIST_DESCRIPTION,
    public: false,
    files: { [GIST_FILE]: { content } },
  });
  return ((await res.json()) as { id: string }).id;
}

/** Replace the My Tasks file in an existing gist. */
export async function writeGist(token: string, id: string, content: string): Promise<void> {
  await request('PATCH', `/gists/${id}`, token, { files: { [GIST_FILE]: { content } } });
}
