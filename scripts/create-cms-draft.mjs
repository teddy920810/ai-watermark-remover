import { appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { createCmsDraft } from './cms-template.mjs';
import { assertCmsPublication } from './cms-publication.mjs';

const root = process.cwd();
const payload = JSON.parse(process.env.CMS_ACTION_PAYLOAD ?? '{}');
// The workflow fixes checkout/ref to main; user inputs never become shell commands.
if (payload.repository?.ref !== 'main') throw new Error('请在 CMS main 分支使用模板入口。');
const result = await createCmsDraft(root, payload);
assertCmsPublication(root);
execFileSync(process.execPath, ['node_modules/astro/bin/astro.mjs', 'sync'], { cwd: root, stdio: 'pipe' });
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `path=${result.path}\n`);
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
git('config', 'user.name', 'github-actions[bot]');
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
git('add', '--', result.path);
git('commit', '-m', `content(create): initialize draft ${result.path}`);
// No force push or automatic overwrite: concurrent CMS saves fail safely.
git('push', 'origin', 'HEAD:main');
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `## 草稿已创建\n\n文件：\`${result.path}\`\n\n回到 CMS 刷新列表，打开新条目继续编辑。保持“草稿”开启，替换全部【待替换】内容和占位图后再发布。\n`);
}
process.stdout.write(`Created draft: ${result.path}\n`);
