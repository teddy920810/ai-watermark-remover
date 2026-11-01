import { describe, expect, it, vi } from 'vitest';
import { GitHubContentRepository } from './github-repository';
const revision = 'a'.repeat(40);
describe('GitHub content persistence contract', () => {
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
