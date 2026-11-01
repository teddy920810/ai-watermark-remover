import { describe, expect, it, vi } from 'vitest';
import { GitHubContentRepository } from './github-repository';
const revision = 'a'.repeat(40);
describe('GitHub content persistence contract', () => {
  it.each([undefined, null, 'invalid'])('recovers the exact merged revision from GraphQL when REST returns %s', async mergeRevision => {
    const mergedRevision = 'f'.repeat(40);
    const request = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith('/graphql')
      ? { data: { repository: { pullRequest: { merged: true, mergeCommit: { oid: mergedRevision } } } } }
      : { number: 103, html_url: 'https://github.com/teddy920810/ai-watermark-remover/pull/103', state: 'closed', merged: true, merge_commit_sha: mergeRevision, base: { ref: 'main' }, head: { sha: revision, ref: 'codex/content-abcdefabcdefabcdefabcdef', repo: { full_name: 'teddy920810/ai-watermark-remover' } } })));
    expect((await new GitHubContentRepository('test-only-token', request).getPull(103)).mergeRevision).toBe(mergedRevision);
    const init = (request.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toMatchObject({ variables: { number: 103 } });
  });
  it.each([null, { merged: false, mergeCommit: { oid: revision } }, { merged: true, mergeCommit: { oid: 'invalid' } }])('fails closed without an authoritative merged revision: %j', async pullRequest => {
    const request = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith('/graphql')
      ? { data: { repository: { pullRequest } } }
      : { number: 103, html_url: 'https://github.com/teddy920810/ai-watermark-remover/pull/103', state: 'closed', merged: true, base: { ref: 'main' }, head: { sha: revision, repo: { full_name: 'teddy920810/ai-watermark-remover' } } })));
    await expect(new GitHubContentRepository('test-only-token', request).getPull(103)).rejects.toMatchObject({ status: 503, code: 'MERGE_REVISION_UNAVAILABLE' });
  });
  it.each([false, true])('preserves the REST fast path when merged=%s and a valid revision is available', async merged => {
    const request = vi.fn(async () => new Response(JSON.stringify({ number: 103, html_url: 'https://github.com/teddy920810/ai-watermark-remover/pull/103', state: merged ? 'closed' : 'open', merged, merge_commit_sha: revision, base: { ref: 'main' }, head: { sha: revision, repo: { full_name: 'teddy920810/ai-watermark-remover' } } })));
    expect((await new GitHubContentRepository('test-only-token', request).getPull(103)).mergeRevision).toBe(revision);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('reads public Checks without the content write credential and requires the requested exact SHA', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ check_runs: [
      { name: 'verify', head_sha: revision, status: 'completed', conclusion: 'success', app: { id: 15368 } },
      { name: 'Required target artifacts', head_sha: 'b'.repeat(40), status: 'completed', conclusion: 'success', app: { id: 15368 } },
    ] })));
    const result = await new GitHubContentRepository('content-write-credential-not-for-checks', request).checks(revision);
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.github.com/repos/teddy920810/ai-watermark-remover/commits/${revision}/check-runs?per_page=100&filter=latest`);
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    expect(result).toEqual([{ name: 'verify', success: true, appId: 15368 }, { name: 'Required target artifacts', success: false, appId: 15368 }]);
  });
  it.each([403, 404, 429, 500])('never treats public Checks HTTP %s as passed or retries with write credentials', async status => {
    const request = vi.fn(async () => new Response(JSON.stringify({ message: 'Unavailable' }), { status }));
    await expect(new GitHubContentRepository('content-write-credential-not-for-checks', request).checks(revision)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    expect(new Headers((request.mock.calls[0] as unknown as [string, RequestInit])[1].headers).has('authorization')).toBe(false);
  });
  it('fails closed on malformed public Checks responses', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ check_runs: [{ name: 'verify', status: 'completed', conclusion: 'success' }] })));
    await expect(new GitHubContentRepository('write-token', request).checks(revision)).rejects.toThrow();
  });
  it('refuses a content pull request targeting an unprotected branch or another repository', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ number: 101, html_url: 'https://github.com/teddy920810/ai-watermark-remover/pull/101', state: 'open', base: { ref: 'unprotected' }, head: { sha: revision, ref: 'codex/content-abcdefabcdefabcdefabcdef', repo: { full_name: 'teddy920810/ai-watermark-remover' } } })));
    await expect(new GitHubContentRepository('test-only-token', request).getPull(101)).rejects.toThrow();
  });
  it('commits content and assets on one preserved tree and never force-updates main', async () => {
    const calls: { path: string; body?: Record<string, unknown> }[] = [];
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url).replace('https://api.github.com', ''); const body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path, body });
      const result = path.includes('/git/commits/') ? { tree: { sha: 'tree-parent' } } : path.endsWith('/git/blobs') ? { sha: 'blob-new' } : path.endsWith('/git/trees') ? { sha: 'tree-new' } : path.endsWith('/git/commits') ? { sha: 'b'.repeat(40) } : { object: { sha: revision } };
      return new Response(JSON.stringify(result));
    });
    const repo = new GitHubContentRepository('test-only-token', request);
    const result = await repo.commit('codex/content-abcdefabcdefabcdefabcdef', revision, new Map([['src/content/blog/example.md', Buffer.from('content')], ['public/uploads/content-api/abcdefabcdefabcdefabcdef/example.png', Buffer.from('image')]]));
    expect(result).toBe('b'.repeat(40));
    expect(calls.find(c => c.path.endsWith('/git/trees'))!.body).toMatchObject({ base_tree: 'tree-parent', tree: [{ mode: '100644', type: 'blob' }, { mode: '100644', type: 'blob' }] });
    expect(calls.find(c => c.path.endsWith('/git/commits'))!.body).toMatchObject({ parents: [revision] });
    expect(calls.at(-1)!.body).toMatchObject({ force: false });
    await expect(repo.commit('main', revision, new Map())).rejects.toThrow();
    await expect(repo.commit('codex/content-abcdefabcdefabcdefabcdef', revision, new Map([['src/lib/services.ts', Buffer.from('bad')]]))).rejects.toThrow();
  });
  it('reads text from Git objects, inventories public assets without fetching private or binary files', async () => {
    const request = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith('/graphql')) return new Response(JSON.stringify({ data: { repository: { f0: { text: '---\nslug: example\n---\nBody', isTruncated: false } } } }));
      if (path.includes('/git/trees/')) return new Response(JSON.stringify({ truncated: false, tree: [{ path: 'src/content/blog/example.md', type: 'blob', mode: '100644', sha: 'text' }, { path: 'public/uploads/example.png', type: 'blob', mode: '100644', sha: 'image' }, { path: '.env.local', type: 'blob', mode: '100644', sha: 'secret' }] }));
      return new Response(JSON.stringify({ object: { sha: revision } }));
    });
    const result = await new GitHubContentRepository('test-only-token', request).snapshot('main');
    expect(result.revision).toBe(revision); expect(result.files.get('src/content/blog/example.md')?.toString()).toContain('Body');
    expect(result.files.has('public/uploads/example.png')).toBe(true); expect(result.files.has('.env.local')).toBe(false);
    expect(request).toHaveBeenCalledTimes(3);
  });
});
