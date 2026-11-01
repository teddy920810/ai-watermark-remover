import { appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { createCmsDraft } from './cms-template.mjs';
import { assertCmsPublication } from './cms-publication.mjs';
import { publishCmsDraft } from './cms-review.mjs';

const root = process.cwd();
const payload = JSON.parse(process.env.CMS_ACTION_PAYLOAD ?? '{}');
// The workflow fixes checkout/ref to main; user inputs never become shell commands.
if (payload.repository?.ref !== 'main') throw new Error('请在 CMS main 分支使用模板入口。');
const result = await createCmsDraft(root, payload);
assertCmsPublication(root);
execFileSync(process.execPath, ['node_modules/astro/bin/astro.mjs', 'sync'], { cwd: root, stdio: 'pipe' });
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `path=${result.path}\n`);
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const review = await publishCmsDraft({ repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID, token: process.env.GITHUB_TOKEN, result, git });
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `## 草稿审核分支已创建\n\n文件：\`${result.path}\`\n\n分支：\`${review.branch}\`\n\nPR：${review.pullRequest}\n\n回到CMS选择上述分支继续编辑。保持草稿开启，完成内容授权和审核后标记PR为Ready，并等待必需CI；如显示Approve workflows to run，由仓库维护者批准运行。不得直接保存到main。\n`);
}
process.stdout.write(`Created draft: ${result.path}\n`);
