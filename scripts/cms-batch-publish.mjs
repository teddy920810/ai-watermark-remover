import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import process from 'node:process';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL, URL } from 'node:url';
import { parse } from 'parse5';
import { projectContent, contentHash, contentImages } from './lib/content-baseline.mjs';
import { parseCmsDocument } from './lib/cms-document.mjs';

export const editorBranch = 'codex/cms-blog-editing';
const repository = 'teddy920810/ai-watermark-remover';
const shaPattern = /^[a-f0-9]{40}$/;
const blog = /^src\/content\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const asset = /^public\/uploads\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:png|jpe?g|webp|gif|avif)$/i;
const siteOrigin = 'https://www.watermarkgemini.com';

export async function verifyBlogDiscovery(posts, request = globalThis.fetch) {
  async function get(path) {
    const response = await request(new URL(path, siteOrigin), { cache: 'no-store', signal: globalThis.AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`无法确认正式博客归档：${path} (HTTP ${response.status})`);
    return response.text();
  }

  const sitemap = new Set([...((await get('/sitemap.xml')).matchAll(/<loc>([^<]+)<\/loc>/g))].map(match => match[1]));
  const found = new Set();
  let path = '/blog';
  for (let page = 1; path; page++) {
    let next = '';
    function visit(node, inList = false, inNavigation = false) {
      const attrs = Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
      const classes = (attrs.class ?? '').split(/\s+/);
      const list = inList || classes.includes('blog-list');
      const navigation = inNavigation || classes.includes('blog-pagination');
      if (node.tagName === 'a') {
        if (list && /^\/blog\/[a-z0-9-]+$/.test(attrs.href ?? '')) found.add(attrs.href);
        if (navigation && attrs.rel === 'next') next = attrs.href ?? '';
      }
      for (const child of node.childNodes ?? []) visit(child, list, navigation);
    }
    visit(parse(await get(path)));
    if (next && next !== `/blog/page/${page + 1}`) throw new Error(`正式博客归档的下一页地址不符合预期：${path}`);
    path = next;
  }

  for (const { slug, draft } of posts) {
    const href = `/blog/${slug}`;
    const published = draft !== true;
    if (found.has(href) !== published || sitemap.has(siteOrigin + href) !== published) {
      throw new Error(`部署已切换，但博客归档或站点地图状态不符合预期：${slug}`);
    }
  }
}
export function validateRequest(payload) {
  if (payload?.action?.name !== 'publish-blog-batch' || payload.repository?.owner !== 'teddy920810'
    || payload.repository?.repo !== 'ai-watermark-remover' || payload.repository?.ref !== editorBranch
    || !shaPattern.test(payload.repository?.sha ?? '')) throw new Error(`请切换到 ${editorBranch}，保存全部博客修改后再点击批量发布。`);
  return payload.repository.sha;
}

function scope(git, base, head) {
  const rows = git('diff', '--raw', '--no-abbrev', '--no-renames', '-z', base, head).split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < rows.length; i += 2) {
    const file = rows[i + 1];
    if (!/^:(?:000000|100644) 100644 [a-f0-9]{40} [a-f0-9]{40} [AM]$/.test(rows[i]) || !(blog.test(file) || asset.test(file))) {
      throw new Error(`批量发布范围仅限博客 Markdown 和原始栅格图片；不允许删除、重命名、链接文件或程序修改：${file}`);
    }
    files.push(file);
  }
  return files;
}
export function planBatch({ git, source, main }) {
  if (![source, main].every(s => shaPattern.test(s))) throw new Error('Invalid immutable revision');
  const base = git('merge-base', main, source);
  // Reject executable/config changes before merging. Only trusted main code runs.
  scope(git, base, source);
  let tree;
  try { tree = git('merge-tree', '--write-tree', main, source).split('\n')[0]; }
  catch { throw new Error('博客与线上新版本存在冲突；已保留编辑内容，请先处理冲突再发布。'); }
  return { tree, files: scope(git, main, tree), source, main };
}
export function requiredChecksReady(checks, sha) {
  return ['verify', 'Required target artifacts'].every(name => {
    const c = checks.find(c => c.name === name && c.app?.id === 15368 && c.head_sha === sha);
    if (!c || c.status !== 'completed') return false;
    if (c.conclusion !== 'success') throw new Error(`必需检查 ${name} 未通过，线上版本未更新。`);
    return true;
  });
}

function approvedBaseline(git, main, plan) {
  const baseline = JSON.parse(git('show', `${main}:tests/fixtures/seo-content-baseline.json`));
  let changed = false;
  for (const file of plan.files.filter(f => blog.test(f))) {
    const record = baseline.files.find(r => r.file === file);
    if (!record) continue;
    const data = projectContent(file, git('show', `${plan.tree}:${file}`));
    Object.assign(record, { semanticSha256: contentHash(data), images: contentImages(data),
      contentOwnerApproval: `https://github.com/${repository}/tree/${plan.source}` });
    changed = true;
  }
  return changed ? JSON.stringify(baseline, null, 2) + '\n' : null;
}

export function assertBatchHead({ git, main, source, head }) {
  const plan = planBatch({ git, main, source });
  let actual;
  try { actual = git('merge-tree', '--write-tree', main, head).split('\n')[0]; }
  catch { throw new Error('发布分支与main冲突，停止自动合并。'); }
  const different = git('diff', '--name-only', plan.tree, actual).split('\n').filter(Boolean);
  const baseline = approvedBaseline(git, main, plan);
  if (different.some(f => f !== 'tests/fixtures/seo-content-baseline.json')
    || baseline && (git('ls-tree', actual, '--', 'tests/fixtures/seo-content-baseline.json').split(' ')[0] !== '100644'
      || git('show', `${actual}:tests/fixtures/seo-content-baseline.json`).trimEnd() !== baseline.trimEnd())
    || !baseline && different.length) throw new Error('发布分支已偏离本次批准的内容，停止自动合并。');
}

export async function publishBatch({ payload, token, actor, runId, git, request = globalThis.fetch, pause = delay, report = async () => {} }) {
  validateRequest(payload);
  if (!token) throw new Error('请先配置 GitHub Actions Secret：CMS_PUBLISH_TOKEN。无需修改主分支保护。');
  if (!/^[\w-]+$/.test(actor ?? '') || !/^\d+$/.test(runId ?? '')) throw new Error('Invalid workflow identity');
  const api = async (route, method = 'GET', body) => {
    const response = await request(`https://api.github.com/repos/${repository}${route}`, {
      method, redirect: 'error', signal: globalThis.AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${route.split('?')[0]} 返回 ${response.status}；保留本批分支与PR，修正后重试。`);
    return response.status === 204 ? {} : response.json();
  };
  // Pages CMS repository.sha resolves workflowRef (main), not the editor ref.
  // https://github.com/pages-cms/pages-cms/blob/main/app/api/%5Bowner%5D/%5Brepo%5D/%5Bbranch%5D/actions/route.ts
  const source = (await api(`/git/ref/heads/${editorBranch}`)).object.sha;
  git('fetch', 'origin', 'main', editorBranch);
  const main = (await api('/git/ref/heads/main')).object.sha;
  const plan = planBatch({ git, source, main });
  const branch = `codex/cms-batch-${source}`;
  // A snapshot branch makes repeated clicks/retries reuse the same release.
  const pulls = await api(`/pulls?state=all&head=teddy920810:${branch}&base=main&per_page=100`);
  let pull = pulls.find(p => p.head?.ref === branch);
  if (!plan.files.length && !pull?.merged_at) { await report('没有待发布的博客修改；没有创建PR或触发构建。'); return { state: 'unchanged' }; }
  if (pull?.state === 'closed' && !pull.merged_at) throw new Error('本批PR已关闭；请先核对关闭原因，不能自动重新发布。');
  if (!pull) {
    const existing = (await api(`/git/matching-refs/heads/${branch}`)).find(r => r.ref === `refs/heads/${branch}`);
    if (!existing) await api('/git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: main });
    let releaseHead = existing?.object.sha ?? main;
    git('fetch', 'origin', branch);
    const currentTree = git('rev-parse', `${releaseHead}^{tree}`);
    if (currentTree === git('rev-parse', `${main}^{tree}`)) {
      const snapshot = await api('/merges', 'POST', { base: branch, head: source, commit_message: `content: freeze approved blog batch ${source}` });
      if (snapshot.commit?.tree?.sha !== plan.tree) throw new Error('远端快照与本地批准内容不一致，停止发布。');
      releaseHead = snapshot.sha;
    } else if (currentTree !== plan.tree) {
      assertBatchHead({ git, main, source, head: releaseHead });
    }
    // Prepare approval before opening the PR: one CI run for the complete batch.
    const baseline = approvedBaseline(git, main, plan);
    if (baseline) {
      const blob = await api('/git/blobs', 'POST', { content: baseline, encoding: 'utf-8' });
      const tree = await api('/git/trees', 'POST', { base_tree: plan.tree, tree: [{ path: 'tests/fixtures/seo-content-baseline.json', mode: '100644', type: 'blob', sha: blob.sha }] });
      const commit = await api('/git/commits', 'POST', { message: 'content: record explicit saved-batch approval of protected blog changes', tree: tree.sha, parents: [releaseHead] });
      await api(`/git/refs/heads/${branch}`, 'PATCH', { sha: commit.sha, force: false });
    }
    pull = await api('/pulls', 'POST', { title: `content: batch publish saved blogs ${source.slice(0, 7)}`, head: branch, base: 'main',
      body: `Pages CMS 批量发布。点击发布即确认本批具体内容、图片及上下架状态。\n\nActor: ${actor}\nSource: ${source}\nBase: ${main}\nRun: https://github.com/${repository}/actions/runs/${runId}\n\n${plan.files.map(f => `- ${f}`).join('\n')}\n\n仅发布任务启动时固定的已保存版本；启动后的保存不混入。必需检查全部通过后才合并，原有SEO基线按本次内容负责人批准同步。` });
  }
  await report(`发布请求：${pull.html_url}\n\n本批 ${plan.files.filter(f => blog.test(f)).length} 篇博客；等待现有必需检查，不重复运行额外的内容构建。`);
  let merged;
  for (let attempt = 0; attempt < 60; attempt++) {
    pull = await api(`/pulls/${pull.number}`);
    if (pull.merged) { merged = pull.merge_commit_sha; break; }
    if (pull.state !== 'open' || pull.draft || pull.head?.repo?.full_name !== repository || pull.head.ref !== branch || pull.base?.ref !== 'main') throw new Error('发布请求状态已改变，请核对原PR。');
    git('fetch', 'origin', 'main', branch);
    assertBatchHead({ git, main: git('rev-parse', 'refs/remotes/origin/main'), source, head: pull.head.sha });
    if (pull.mergeable_state === 'behind') {
      await api(`/pulls/${pull.number}/update-branch`, 'PUT', { expected_head_sha: pull.head.sha });
    } else if (requiredChecksReady((await api(`/commits/${pull.head.sha}/check-runs?per_page=100`)).check_runs, pull.head.sha)) {
      const result = await api(`/pulls/${pull.number}/merge`, 'PUT', { sha: pull.head.sha, merge_method: 'squash' });
      if (!result.merged || !shaPattern.test(result.sha)) throw new Error('PR未合并；请查看检查与保护规则，不要重新创建发布。');
      merged = result.sha; break;
    }
    await pause(15_000);
  }
  if (!merged) throw new Error(`检查仍未完成；原PR ${pull.html_url} 已保留。重新点发布会继续同一批，不重复发稿。`);
  await report(`已合并：${merged}\n\n等待正式网站完成部署。`);
  git('fetch', 'origin', 'main');
  const entryFiles = plan.files.length ? plan.files : git('diff', '--name-only', `${merged}^`, merged).split('\n');
  const entries = entryFiles.filter(f => blog.test(f)).map(file => parseCmsDocument(file, git('show', `${merged}:${file}`)));
  for (let attempt = 0; attempt < 60; attempt++) {
    const proof = await request('https://www.watermarkgemini.com/cms-build.json', { cache: 'no-store', signal: globalThis.AbortSignal.timeout(20_000) });
    const revision = proof.ok ? (await proof.json()).revision : '';
    let included = revision === merged;
    if (!included && shaPattern.test(revision)) included = ['ahead', 'identical'].includes((await api(`/compare/${merged}...${revision}`)).status);
    if (included) {
      for (const entry of entries) {
        const response = await request(`https://www.watermarkgemini.com/blog/${entry.data.slug}`, { cache: 'no-store', signal: globalThis.AbortSignal.timeout(20_000) });
        if (response.status !== (entry.data.draft === true ? 404 : 200)) throw new Error(`部署已切换，但文章状态不符合预期：${entry.data.slug}`);
      }
      await verifyBlogDiscovery(entries.map(entry => entry.data), request);
      // Sync only after acceptance so a failed deployment retry retains its batch SHA.
      // Merge, never reset: preserve newer saves and main content.
      const synced = await request(`https://api.github.com/repos/${repository}/merges`, {
        method: 'POST', redirect: 'error', signal: globalThis.AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ base: editorBranch, head: merged, commit_message: 'content: sync published batch into blog editing branch' }),
      });
      if (!synced.ok) await report('编辑分支同步未完成，已保留全部保存内容；下次发布前需处理冲突。已合并的线上发布不受影响。');
      await report(`批量发布完成：${pull.html_url}\n\n正式Site已包含合并版本，${entries.length} 篇博客的访问、归档和站点地图状态已核对。刷新CMS编辑页后继续下一批。`);
      return { state: 'published', merged, pull: pull.number };
    }
    await pause(15_000);
  }
  throw new Error(`已合并 ${merged}，正式Site部署尚未确认。不要重复发稿；查看当前部署或重跑原发布。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const git = (...args) => {
    const output = execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 20_000_000 });
    return args[0] === 'show' ? output : output.trimEnd();
  };
  const report = async text => { console.log(text); if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text + '\n\n'); };
  try {
    await publishBatch({ payload: JSON.parse(process.env.CMS_ACTION_PAYLOAD ?? '{}'), token: process.env.CMS_PUBLISH_TOKEN, actor: process.env.GITHUB_ACTOR, runId: process.env.GITHUB_RUN_ID, git, report });
  } catch (error) { await report(`发布未完成：${error.message}`); process.exitCode = 1; }
}
