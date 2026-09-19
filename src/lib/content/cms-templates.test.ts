import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { createCmsDraft } from '../../../scripts/cms-template.mjs';
import { collectPublicationIssues } from '../../../scripts/cms-publication.mjs';
import { publicLandingEntries, publicNavigation } from './entries';
import { buildSitemapEntries } from './sitemap';
import sitemapSettings from '../../content/settings/sitemap.json';

const roots: string[] = [];
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'cms-template-'));
  roots.push(root);
  mkdirSync(join(root, 'src/content/blog'), { recursive: true });
  mkdirSync(join(root, 'src/content/landing-pages'), { recursive: true });
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const payload = (kind: string, slug = 'new-example') => ({
  action: { name: `create-${kind}-draft` },
  inputs: { title: 'A new example', slug },
});

describe('CMS template initialization', () => {
  it.each(['blog', 'landing'])('creates an editable %s draft without public routes', async (kind) => {
    const root = workspace();
    const result = await createCmsDraft(root, payload(kind), '2026-09-19');
    const text = readFileSync(join(root, result.path), 'utf8');
    expect(text).toContain('待替换');
    expect(result.data).toMatchObject({ title: 'A new example', slug: 'new-example', draft: true });
    expect(collectPublicationIssues([{ path: result.path, data: result.data, body: result.body }])).toEqual([]);
    if (kind === 'landing') {
      expect(result.data.process?.steps).toHaveLength(3);
      for (const key of ['features', 'faq', 'scope', 'heroActions', 'cta']) expect(result.data[key]).toBeDefined();
    } else {
      expect(result.data).toMatchObject({ publishedAt: '2026-09-19', featured: false, contentMode: 'markdown' });
      expect(result.body).toContain('##');
    }
    await expect(createCmsDraft(root, payload(kind))).rejects.toThrow(/exists|存在/i);
    expect(readFileSync(join(root, result.path), 'utf8')).toBe(text);
  });

  it.each(['../escape', 'blog', 'api', '404', 'robots', 'sitemap', 'auth'])('rejects unsafe or reserved tool slug %s', async (slug) => {
    await expect(createCmsDraft(workspace(), payload('landing', slug))).rejects.toThrow();
  });

  it('rejects duplicate slugs stored under a different filename and blank titles', async () => {
    const root = workspace();
    writeFileSync(join(root, 'src/content/landing-pages/old.json'), JSON.stringify({ slug: 'new-example' }));
    await expect(createCmsDraft(root, payload('landing'))).rejects.toThrow(/exists|存在/i);
    await expect(createCmsDraft(root, { ...payload('blog'), inputs: { slug: 'new', title: ' ' } })).rejects.toThrow();
    await expect(createCmsDraft(root, payload('unknown'))).rejects.toThrow();
    await expect(createCmsDraft(root, { action: { name: 'constructor' } })).rejects.toThrow();
  });

  it('offers two collection-scoped template buttons and safe defaults', () => {
    const config = YAML.parse(readFileSync('.pages.yml', 'utf8'));
    for (const name of ['blog', 'landing-pages']) {
      const collection = config.content.find((entry: { name: string }) => entry.name === name);
      expect(collection.actions).toContainEqual(expect.objectContaining({ scope: 'collection', workflow: 'cms-create-draft.yml' }));
      expect(collection.fields.find((field: { name: string }) => field.name === 'draft').default).toBe(true);
    }
    for (const file of readdirSync('src/content/landing-pages')) {
      expect(typeof JSON.parse(readFileSync(`src/content/landing-pages/${file}`, 'utf8')).draft).toBe('boolean');
    }
    expect(JSON.parse(readFileSync('src/content/landing-pages/chatgpt-watermark-remover.json', 'utf8')).draft).toBe(false);
  });
});

describe('publication safeguards', () => {
  it('uses the official action payload contract without interpolating user input into commands', () => {
    const source = readFileSync('.github/workflows/cms-create-draft.yml', 'utf8');
    const workflow = YAML.parse(source);
    expect(workflow.on.workflow_dispatch.inputs.payload).toMatchObject({ required: true, type: 'string' });
    expect(workflow.permissions).toEqual({ contents: 'write' });
    expect(workflow.jobs.create.if).toBe("github.ref == 'refs/heads/main'");
    expect(workflow.jobs.create.steps.at(-1)).toMatchObject({
      run: 'node scripts/create-cms-draft.mjs', env: { CMS_ACTION_PAYLOAD: '${{ inputs.payload }}' },
    });
    expect(readFileSync('src/content.config.ts', 'utf8')).toContain('assertCmsPublication(');
  });

  it('blocks template text in metadata, nested modules, Markdown and HTML only when public', () => {
    for (const data of [{ title: '【待替换】title' }, { features: { items: [{ description: '【待替换】description' }] } }, { bodyHtml: '<p>【待替换】body</p>' }]) {
      const record = { path: 'src/content/blog/example.md', data: { slug: 'example', ...data }, body: '' };
      expect(collectPublicationIssues([record]).join()).toContain('待替换');
      expect(collectPublicationIssues([{ ...record, data: { ...record.data, draft: true } }])).toEqual([]);
    }
    expect(collectPublicationIssues([{ path: 'src/content/blog/example.md', data: { slug: 'example' }, body: '【待替换】body' }]).join()).toContain('待替换');
  });

  it('checks duplicate and reserved routes even for drafts', () => {
    const record = { path: 'src/content/landing-pages/a.json', data: { slug: 'blog', draft: true } };
    const issues = collectPublicationIssues([record, { ...record, path: 'src/content/landing-pages/b.json' }]);
    expect(issues.join()).toMatch(/reserved|保留/);
    expect(issues.join()).toMatch(/duplicate|重复/);
  });

  it('checks new-template images and public links without changing legacy image fallbacks', () => {
    const root = workspace();
    const record = { path: 'src/content/blog/test.md', data: { slug: 'test', templateVersion: 1, coverImage: '/uploads/missing.png' }, body: '[bad](/missing-page)' };
    expect(collectPublicationIssues([record], root).join()).toContain('图片不存在');
    expect(collectPublicationIssues([record], root).join()).toContain('不是已发布页面');
    expect(collectPublicationIssues([{ ...record, data: { ...record.data, draft: true } }], root)).toEqual([]);
    expect(collectPublicationIssues([{ ...record, data: { slug: 'test', coverImage: '/uploads/missing.png' }, body: '' }], root)).toEqual([]);
    mkdirSync(join(root, 'public/uploads'), { recursive: true });
    writeFileSync(join(root, 'public/uploads/missing.png'), 'fixture');
    expect(collectPublicationIssues([{ ...record, body: '[home](/)' }], root)).toEqual([]);
  });

  it('hides drafts from tools, navigation and sitemap while retaining Coming Soon', () => {
    const entries = [{ data: { slug: 'public' } }, { data: { slug: 'soon', statusLabel: 'Coming Soon' } }, { data: { slug: 'private', draft: true } }];
    expect(publicLandingEntries(entries)).toHaveLength(2);
    const nav = [{ label: 'Tools', href: '', children: [{ label: 'Secret', href: '/private?x=1' }, { label: 'Soon', href: '/soon' }] }, { label: 'Secret', href: '/private/' }];
    expect(publicNavigation(nav, new Set(['/private']))).toEqual([{ ...nav[0], children: [{ label: 'Soon', href: '/soon' }] }]);
    expect(publicNavigation([{ label: 'Empty', href: '', children: [{ label: 'Secret', href: '/private' }] }], new Set(['/private']))).toEqual([]);
    const paths = buildSitemapEntries({ posts: [], landingPages: entries.map((entry) => entry.data), settings: sitemapSettings as Parameters<typeof buildSitemapEntries>[0]['settings'] }).map((entry) => entry.path);
    expect(paths).not.toContain('/private');
    expect(paths).toContain('/soon');
  });
});
