/** API shape: https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request */
export async function publishCmsDraft({ repository, runId, token, result, git, request = globalThis.fetch }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !/^\d+$/.test(runId ?? '') || !token
    || result?.data?.draft !== true || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.data.slug)
    || !/^src\/content\/(?:blog|landing-pages)\/[a-z0-9-]+\.(?:md|json)$/.test(result.path)) throw new Error('Invalid protected CMS draft context');
  const branch = `codex/cms-${result.data.slug}-${runId}`;
  git('switch', '-c', branch);
  git('config', 'user.name', 'github-actions[bot]');
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  git('add', '--', result.path);
  git('commit', '-m', `content(create): initialize draft ${result.path}`);
  git('push', 'origin', `HEAD:refs/heads/${branch}`);
  const response = await request(`https://api.github.com/repos/${repository}/pulls`, {
    method: 'POST', redirect: 'error', signal: globalThis.AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10' },
    body: JSON.stringify({ title: `content: draft ${result.data.slug}`, head: branch, base: 'main', draft: true,
      body: `Created an unpublished CMS draft at \`${result.path}\`.\n\n内容负责人完成并明确授权后再标记Ready；保留独立内容基线检查，任何既有内容变化须同步审阅基线。必需CI通过后才可合并；不直接写main。` }),
  });
  if (!response.ok) throw new Error(`CMS branch was preserved but PR creation returned HTTP ${response.status}`);
  const pull = await response.json();
  if (typeof pull.html_url !== 'string' || !pull.html_url.startsWith(`https://github.com/${repository}/pull/`) || !/^\d+$/.test(pull.html_url.split('/').at(-1))) throw new Error('CMS branch was preserved; PR response needs review');
  return { branch, pullRequest: pull.html_url };
}
