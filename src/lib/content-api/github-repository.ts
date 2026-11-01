import { ContentError, contentPath, fail } from './validation';
import type { ContentCheck, ContentRepository, ContentSnapshot, PullRequest } from './repository';

const repository = '/repos/teddy920810/ai-watermark-remover';
const branchPattern = /^codex\/content-[a-f0-9]{24}$/;
type GitTreeEntry = { path: string; type: string; mode: string; sha: string };
/** Official Git Database contract: create blobs -> tree(base_tree) -> commit(parent) -> ref(force:false).
 * https://docs.github.com/en/rest/git/trees#create-a-tree
 * https://docs.github.com/en/rest/git/refs#update-a-reference */
export class GitHubContentRepository implements ContentRepository {
  private assetIds = new Map<string, Map<string, string>>();
  constructor(private token: string, private fetcher: typeof globalThis.fetch = globalThis.fetch) {}
  private async call(path: string, method = 'GET', body?: unknown) {
    if (!this.token) fail(503, 'REPOSITORY_NOT_CONFIGURED', 'A dedicated repository credential must be configured.');
    const response = await this.fetcher(`https://api.github.com${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(25_000), headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new ContentError(response.status === 404 ? 404 : response.status === 409 || response.status === 422 ? 409 : 503, 'GITHUB_UNAVAILABLE', `Content repository operation failed (${response.status}). Retry with the same key.`);
    return response.status === 204 ? {} : response.json();
  }
  private ref(ref: string) { return `${repository}/git/ref/heads/${ref.split('/').map(encodeURIComponent).join('/')}`; }
  async snapshot(ref: string): Promise<ContentSnapshot> {
    if (ref !== 'main' && !branchPattern.test(ref) && !/^[a-f0-9]{40}$/.test(ref)) fail(422, 'INVALID_REF', 'Unsupported content reference.');
    const revision = /^[a-f0-9]{40}$/.test(ref) ? ref : (await this.call(this.ref(ref))).object.sha;
    const tree = await this.call(`${repository}/git/trees/${revision}?recursive=1`);
    if (tree.truncated || !Array.isArray(tree.tree)) fail(503, 'TREE_TOO_LARGE', 'Repository tree requires maintainer review.');
    const files = new Map<string, Buffer>(); const assets = new Map<string, string>(); const texts: GitTreeEntry[] = [];
    for (const item of tree.tree as GitTreeEntry[]) {
      if (item.type !== 'blob' || item.mode !== '100644') continue;
      if (contentPath(item.path) || item.path === 'tests/fixtures/seo-content-baseline.json' || /^\.content-api\/[a-f0-9]{24}\.json$/.test(item.path)) texts.push(item);
      if (/^public\/(?:uploads|images)\//.test(item.path)) { files.set(item.path, Buffer.alloc(0)); assets.set(item.path, item.sha); }
    }
    if (texts.length > 2000) fail(503, 'CONTENT_LIMIT', 'Content inventory requires maintainer review.');
    for (let start = 0; start < texts.length; start += 75) {
      const batch = texts.slice(start, start + 75);
      const fields = batch.map((item, i) => `f${i}: object(expression: ${JSON.stringify(`${revision}:${item.path}`)}) { ... on Blob { text isTruncated } }`).join('\n');
      const result = await this.call('/graphql', 'POST', { query: `query { repository(owner: "teddy920810", name: "ai-watermark-remover") { ${fields} } }` });
      if (result.errors || !result.data?.repository) fail(503, 'CONTENT_READ_FAILED', 'Content objects are not readable.');
      batch.forEach((item, i) => { const blob = result.data.repository[`f${i}`]; if (typeof blob?.text !== 'string' || blob.isTruncated) fail(503, 'CONTENT_READ_FAILED', 'Content object is truncated or unavailable.'); files.set(item.path, Buffer.from(blob.text)); });
    }
    this.assetIds.set(revision, assets); return { revision, files };
  }
  async readAsset(path: string, revision: string) {
    if (!this.assetIds.has(revision)) await this.snapshot(revision);
    const id = this.assetIds.get(revision)?.get(path); if (!id) return fail(404, 'ASSET_NOT_FOUND', 'Public asset not found.');
    const blob = await this.call(`${repository}/git/blobs/${id}`);
    if (blob.encoding !== 'base64' || typeof blob.content !== 'string' || blob.size > 2_000_000) return fail(422, 'ASSET_TOO_LARGE', 'Asset cannot be verified within API limits.');
    return Buffer.from(blob.content, 'base64');
  }
  async createBranch(branch: string, revision: string) {
    if (!branchPattern.test(branch) || !/^[a-f0-9]{40}$/.test(revision)) fail(422, 'INVALID_REF', 'Unsupported content branch.');
    try { await this.call(`${repository}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: revision }); }
    catch (error) { if (!(error instanceof ContentError) || error.status !== 409) throw error; await this.call(this.ref(branch)); }
  }
  async commit(branch: string, revision: string, updates: Map<string, Buffer>) {
    if (!branchPattern.test(branch) || !/^[a-f0-9]{40}$/.test(revision)) fail(422, 'INVALID_REF', 'Writes require an isolated content branch.');
    const id = branch.slice('codex/content-'.length);
    for (const file of updates.keys()) if (!contentPath(file) && file !== `.content-api/${id}.json` && file !== 'tests/fixtures/seo-content-baseline.json' && !new RegExp(`^public/uploads/content-api/${id}/[a-z0-9-]+\\.(?:jpg|png|webp)$`).test(file)) fail(422, 'SCOPE_VIOLATION', 'Only content change paths may be written.');
    const current = await this.call(this.ref(branch)); if (current.object.sha !== revision) fail(409, 'REVISION_CONFLICT', 'Content branch has advanced.');
    const parent = await this.call(`${repository}/git/commits/${revision}`); const entries = [];
    for (const [path, bytes] of updates) { const blob = await this.call(`${repository}/git/blobs`, 'POST', { content: bytes.toString('base64'), encoding: 'base64' }); entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha }); }
    const tree = await this.call(`${repository}/git/trees`, 'POST', { base_tree: parent.tree.sha, tree: entries });
    const commit = await this.call(`${repository}/git/commits`, 'POST', { message: `content: update isolated change ${id}`, tree: tree.sha, parents: [revision] });
    await this.call(`${repository}/git/refs/heads/${branch}`, 'PATCH', { sha: commit.sha, force: false });
    return commit.sha as string;
  }
  private pull(data: Record<string, unknown>): PullRequest {
    const head = data.head as { sha: string; ref: string; repo?: { full_name: string } };
    if ((data.base as { ref?: string })?.ref !== 'main' || head?.repo?.full_name !== 'teddy920810/ai-watermark-remover' || data.html_url !== `https://github.com/teddy920810/ai-watermark-remover/pull/${data.number}`) fail(409, 'SCOPE_VIOLATION', 'Content pull requests must target protected main in this repository.');
    return { number: Number(data.number), url: String(data.html_url), state: String(data.state), merged: data.merged === true, head: (data.head as { sha: string }).sha, branch: (data.head as { ref: string }).ref, ...(typeof data.merge_commit_sha === 'string' ? { mergeRevision: data.merge_commit_sha } : {}) };
  }
  async openPull(branch: string, title: string) {
    if (!branchPattern.test(branch)) return fail(422, 'INVALID_REF', 'Unsupported content branch.');
    const existing = await this.call(`${repository}/pulls?head=teddy920810:${encodeURIComponent(branch)}&state=open`);
    if (existing.length) return this.pull(existing[0]);
    return this.pull(await this.call(`${repository}/pulls`, 'POST', { title: `content: ${title}`, head: branch, base: 'main', draft: true, body: 'Content API review. Content-owner authorization must bind to the exact digest and files. Required CI and protected-main rules apply. Content and assets ship together.' }));
  }
  async getPull(number: number) { return this.pull(await this.call(`${repository}/pulls/${number}`)); }
  async comment(number: number, body: string) { return (await this.call(`${repository}/issues/${number}/comments`, 'POST', { body })).html_url as string; }
  async verifyApproval(number: number, reference: string, digest: string) {
    const match = new RegExp(`^https://github\\.com/teddy920810/ai-watermark-remover/pull/${number}#issuecomment-([1-9][0-9]*)$`).exec(reference);
    if (!match) return false;
    const comment = await this.call(`${repository}/issues/comments/${match[1]}`);
    return comment.issue_url === `https://api.github.com${repository}/issues/${number}` && typeof comment.body === 'string' && comment.body.includes(`\nDigest: ${digest}\n`);
  }
  async ready(number: number) {
    const pull = await this.call(`${repository}/pulls/${number}`); if (!pull.draft) return;
    const result = await this.call('/graphql', 'POST', { query: 'mutation($id:ID!) { markPullRequestReadyForReview(input:{pullRequestId:$id}) { pullRequest { isDraft } } }', variables: { id: pull.node_id } });
    if (result.errors) fail(503, 'PR_READY_FAILED', 'Content commit is preserved. Retry review with the same key or mark the PR ready in GitHub.');
  }
  async checks(revision: string): Promise<ContentCheck[]> {
    if (!/^[a-f0-9]{40}$/.test(revision)) fail(422, 'INVALID_REF', 'Checks require an exact commit SHA.');
    // Fine-grained PATs cannot call Checks. This fixed repository is public: use the documented anonymous read contract, never the content write credential.
    // https://docs.github.com/en/rest/checks/runs?apiVersion=2026-03-10#list-check-runs-for-a-git-reference
    const response = await this.fetcher(`https://api.github.com${repository}/commits/${revision}/check-runs?per_page=100&filter=latest`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(25_000), headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
    });
    if (!response.ok) fail(503, 'CHECKS_UNAVAILABLE', `Public Checks could not be verified (${response.status}). Limits or repository privacy require maintainer review; publication remains blocked.`);
    const result = await response.json();
    if (!Array.isArray(result.check_runs)) fail(503, 'CHECKS_UNAVAILABLE', 'Public Checks response is malformed; publication remains blocked.');
    return result.check_runs.map((run: { name: string; head_sha: string; conclusion: string; status: string; app: { id: number } }) => {
      if (!run || typeof run.name !== 'string' || typeof run.app?.id !== 'number' || !/^[a-f0-9]{40}$/.test(run.head_sha ?? '')) fail(503, 'CHECKS_UNAVAILABLE', 'Public Checks response is malformed; publication remains blocked.');
      return { name: run.name, success: run.head_sha === revision && run.status === 'completed' && run.conclusion === 'success', appId: run.app.id };
    });
  }
  async changedFiles(number: number) {
    const result: string[] = [];
    for (let page = 1; page <= 31; page++) { const files = await this.call(`${repository}/pulls/${number}/files?per_page=100&page=${page}`); if (page === 31) fail(409, 'SCOPE_VIOLATION', 'Pull request is too large.'); result.push(...files.map((f: { filename: string }) => f.filename)); if (files.length < 100) break; }
    return result;
  }
  async merge(number: number, revision: string) {
    const pull = await this.getPull(number); if (!pull.branch || !branchPattern.test(pull.branch)) fail(409, 'SCOPE_VIOLATION', 'Only content review branches can merge here.');
    const result = await this.call(`${repository}/pulls/${number}/merge`, 'PUT', { sha: revision, merge_method: 'squash' });
    if (!result.merged) fail(409, 'MERGE_BLOCKED', 'Protected-main merge has not completed.'); return result.sha as string;
  }
}
