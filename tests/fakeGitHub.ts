/**
 * A fake api.github.com for sync tests: just the gist endpoints the app
 * uses, held in memory. Install it with `vi.stubGlobal('fetch', gh.fetch)`.
 */

interface FakeGist {
  id: string;
  description: string;
  updated_at: string;
  files: Record<string, { content: string }>;
}

export class FakeGitHub {
  gists = new Map<string, FakeGist>();
  /** Tokens GitHub accepts, with the scopes it reports for each. */
  tokens = new Map<string, string>([['good', 'gist, repo']]);
  /** Simulate no network. */
  offline = false;
  /** Simulate a rate limit until this Unix time. */
  limitedUntil = 0;
  /** Content longer than this is "truncated" in API answers, as GitHub does over 1 MB. */
  truncateOver = Infinity;
  private next = 1;
  private clock = Date.parse('2026-11-11T10:00:00Z');

  /** Add a gist directly, as if made elsewhere. */
  add(files: Record<string, string>, description = 'My Tasks'): string {
    const id = `gist${this.next++}`;
    this.gists.set(id, {
      id,
      description,
      updated_at: this.tick(),
      files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { content: v }])),
    });
    return id;
  }

  /** The content of one file. */
  file(id: string, name = 'mytasks.json'): string | undefined {
    return this.gists.get(id)?.files[name]?.content;
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  }

  private view(g: FakeGist, withContent: boolean) {
    return {
      id: g.id,
      description: g.description,
      updated_at: g.updated_at,
      files: Object.fromEntries(
        Object.entries(g.files).map(([name, f]) => {
          const truncated = f.content.length > this.truncateOver;
          return [
            name,
            withContent
              ? { content: truncated ? f.content.slice(0, this.truncateOver) : f.content, truncated, raw_url: `https://gist.githubusercontent.com/raw/${g.id}/${name}` }
              : { filename: name },
          ];
        }),
      ),
    };
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.host === 'gist.githubusercontent.com') {
      const [, , id, name] = url.pathname.split('/');
      const f = this.gists.get(id)?.files[name];
      return f ? new Response(f.content) : new Response('', { status: 404 });
    }
    if (Date.now() / 1000 < this.limitedUntil) {
      return this.json({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(this.limitedUntil) });
    }
    const auth = new Headers(init.headers).get('Authorization') ?? '';
    const scopes = this.tokens.get(auth.replace('Bearer ', ''));
    if (scopes === undefined) return this.json({ message: 'Bad credentials' }, 401);
    const path = url.pathname;
    if (path === '/user') return this.json({ login: 'me' }, 200, { 'x-oauth-scopes': scopes });
    if (path === '/gists' && method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const per = Number(url.searchParams.get('per_page') ?? 30);
      const all = [...this.gists.values()].map((g) => this.view(g, false));
      return this.json(all.slice((page - 1) * per, page * per));
    }
    if (path === '/gists' && method === 'POST') {
      const body = JSON.parse(String(init.body)) as { description: string; public: boolean; files: Record<string, { content: string }> };
      const id = `gist${this.next++}`;
      this.gists.set(id, { id, description: body.description, updated_at: this.tick(), files: body.files });
      return this.json({ id }, 201);
    }
    const m = path.match(/^\/gists\/([^/]+)$/);
    const g = m ? this.gists.get(m[1]) : undefined;
    if (!g) return this.json({ message: 'Not Found' }, 404);
    if (method === 'GET') return this.json(this.view(g, true));
    if (method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { files: Record<string, { content: string }> };
      Object.assign(g.files, body.files);
      g.updated_at = this.tick();
      return this.json(this.view(g, true));
    }
    return this.json({}, 405);
  };
}
