import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MarkdownRenderer } from '@astrojs/markdown-remark';
import config from '../../../astro.config.mjs';
import * as seo from './seo-schema';

let markdown: MarkdownRenderer;
beforeAll(async () => {
  const processor = config.markdown?.processor;
  if (!processor) throw new Error('Configured Markdown processor is required');
  markdown = await processor.createRenderer({ syntaxHighlight: false });
});
const legalFile = new URL('../../content/legal/terms.md', import.meta.url);

describe('configured legal Markdown rendering', () => {
  it.each([
    '<script>globalThis.injected = true</script>',
    '<ScRiPt src="https://example.com/active.js"></sCrIpT>',
    '<img src=x onerror="alert(1)">',
    '<a href="javascript:alert(1)">open</a>',
    '<svg><a xlink:href="javascript:alert(1)">open</a></svg>',
    '<math><mtext><img src=x onerror=alert(1)></mtext></math>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<!-- hidden HTML -->',
    '[open](javascript:alert%281%29)',
    '[open](jav&#x61;script:alert%281%29)',
    '[open](java&#x09;script:alert%281%29)',
    '[open](data:text/html,active)',
    '[open](//example.com/active)',
    '[open][target]\n\n[target]: javascript:alert%281%29',
  ])('rejects active markup or unsafe parsed links: %s', async (body) => {
    await expect(markdown.render(body, { fileURL: legalFile })).rejects.toThrow(/legal Markdown/i);
  });

  it('keeps Markdown headings, lists, code examples, titles and legitimate links', async () => {
    const body = '## Your choices\n\n- **Keep** your files.\n\n[Policy](/privacy "Read policy") · [Provider](https://example.com/policy) · [Contact](mailto:teddy920810@gmail.com) · [Section](#your-choices)\n\n`<script>` is a code example.\n\n```html\n<img onerror="example">\n```';
    const { code, metadata } = await markdown.render(body, { fileURL: legalFile });
    expect(metadata.headings).toEqual([{ depth: 2, slug: 'your-choices', text: 'Your choices' }]);
    expect(code).toContain('<strong>Keep</strong>');
    expect(code).toContain('href="/privacy" title="Read policy"');
    expect(code).toContain('href="https://example.com/policy"');
    expect(code).toContain('href="mailto:teddy920810@gmail.com"');
    expect(code).toContain('href="#your-choices"');
    const codeText: string[] = [];
    function visit(node: DefaultTreeAdapterMap['node']) {
      if ('tagName' in node && node.tagName === 'code') {
        codeText.push(node.childNodes.map(child => 'value' in child ? child.value : '').join(''));
      }
      if ('childNodes' in node) node.childNodes.forEach(visit);
    }
    visit(parseFragment(code));
    expect(codeText).toEqual(['<script>', '<img onerror="example">\n']);
    expect(code).not.toContain('<img');
  });

  it.each(['terms', 'privacy'])('renders the published %s body and preserves contact and cross-links', async (slug) => {
    const fileURL = new URL(`../../content/legal/${slug}.md`, import.meta.url);
    const body = readFileSync(fileURL, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    const { code, metadata } = await markdown.render(body, { fileURL });
    expect(metadata.headings.length).toBeGreaterThan(5);
    expect(code).toContain('href="mailto:teddy920810@gmail.com"');
    expect(code).toContain(`href="/${slug === 'terms' ? 'privacy' : 'terms'}"`);
  });

  it.each(['blog/control.md', 'legal-extra/control.md'])('leaves unrelated Markdown unchanged: %s', async (path) => {
    const { code } = await markdown.render('<div data-control="retained">Ordinary control</div>', {
      fileURL: new URL(`../../content/${path}`, import.meta.url),
    });
    expect(code).toContain('<div data-control="retained">Ordinary control</div>');
  });

  it('also rejects raw HTML in nested legal content', async () => {
    await expect(markdown.render('<script>active()</script>', {
      fileURL: new URL('../../content/legal/nested/page.md', import.meta.url),
    })).rejects.toThrow(/legal Markdown/i);
  });
});

function layoutJsonLd(item: Record<string, unknown>) {
  const layout = readFileSync(new URL('../../layouts/SiteLayout.astro', import.meta.url), 'utf8');
  const expression = layout.match(/type="application\/ld\+json" set:html=\{(.+)\} \/>/)?.[1];
  if (!expression) throw new Error('SiteLayout JSON-LD sink missing');
  // Evaluate the actual layout expression, so a safe unused helper cannot pass this test.
  return String(runInNewContext(expression, { item, ...seo }));
}

describe('SiteLayout JSON-LD raw-text boundary', () => {
  it.each([
    '</script><script id="injected">active()</script>',
    '</ScRiPt ><img src=x onerror=active()>',
    '<!--<script>nested</script>',
    'Less < more > & "quoted" \\ Unicode 中文 \u2028\u2029',
    '&lt;/script&gt;&lt;script&gt; stays literal text',
  ])('keeps metadata inside one JSON-LD node and round-trips values: %s', (description) => {
    const item = { ...seo.buildWebPageSchema({ canonicalOrigin: 'https://www.watermarkgemini.com', path: '/terms', name: 'Terms', description }), nested: [{ description }] };
    const raw = layoutJsonLd(item);
    const fragment = parseFragment(`<script type="application/ld+json">${raw}</script><p id="after">After</p>`);
    const elements = fragment.childNodes.filter((node): node is DefaultTreeAdapterMap['element'] => 'tagName' in node);
    expect(elements.map(node => node.tagName)).toEqual(['script', 'p']);
    expect(raw).not.toContain('<');
    const text = elements[0].childNodes.map(node => 'value' in node ? node.value : '').join('');
    expect(JSON.parse(text)).toEqual({ '@context': 'https://schema.org', ...item });
    expect(elements[1].attrs).toContainEqual({ name: 'id', value: 'after' });
  });

  it.each(['WebApplication', 'FAQPage', 'Article', 'CollectionPage'])('protects the shared %s schema path', (type) => {
    const item = { '@type': type, name: '</SCRIPT><script>active()</script>', mainEntity: [{ text: '<!--nested' }] };
    const raw = layoutJsonLd(item);
    expect(raw).not.toContain('<');
    expect(JSON.parse(raw)).toEqual({ '@context': 'https://schema.org', ...item });
  });
});
