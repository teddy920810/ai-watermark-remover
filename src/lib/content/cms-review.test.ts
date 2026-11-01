import { describe, expect, it, vi } from 'vitest';
import { publishCmsDraft } from '../../../scripts/cms-review.mjs';
const options = { repository: 'teddy920810/ai-watermark-remover', runId: '123', token: 'test-token', result: { path: 'src/content/blog/new-example.md', data: { slug: 'new-example', title: 'New example', draft: true } } };
describe('protected CMS draft delivery', () => {
  it('pushes a content branch and opens a draft PR while main remains untouched', async () => {
    const git = vi.fn();
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ html_url: 'https://github.com/teddy920810/ai-watermark-remover/pull/123' }), { status: 201 }));
    const result = await publishCmsDraft({ ...options, git, request });
    expect(git).toHaveBeenCalledWith('switch', '-c', 'codex/cms-new-example-123');
    expect(git).toHaveBeenCalledWith('push', 'origin', 'HEAD:refs/heads/codex/cms-new-example-123');
    expect(git.mock.calls.some(args => args.some(arg => /HEAD:(?:refs\/heads\/)?main$|--force/.test(arg)))).toBe(false);
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body).toMatchObject({ head: result.branch, base: 'main', draft: true });
    expect(body.body).toMatch(/内容.*授权|content/i);
  });
  it('never opens a PR after a failed concurrent push and rejects malformed workflow context', async () => {
    const request = vi.fn();
    await expect(publishCmsDraft({ ...options, request, git: () => { throw new Error('push rejected'); } })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    await expect(publishCmsDraft({ ...options, runId: '../main', request, git: vi.fn() })).rejects.toThrow();
    await expect(publishCmsDraft({ ...options, result: { ...options.result, data: { ...options.result.data, draft: false } }, request, git: vi.fn() })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
