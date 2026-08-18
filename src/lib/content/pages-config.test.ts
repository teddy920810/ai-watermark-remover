import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const configSource = readFileSync(new URL('../../../.pages.yml', import.meta.url), 'utf8');
interface CmsField {
  name: string;
  label?: string;
  type: string;
  description?: string;
  list?: {
    min?: number;
    max?: number;
    collapsible?: { collapsed?: boolean; summary?: string };
  };
  options?: {
    media?: string;
    format?: string;
    switcher?: boolean;
    values?: Array<string | { name: string; label: string }>;
  };
  fields?: CmsField[];
}
const config = YAML.parse(configSource) as {
  media: Array<{
    name: string;
    label: string;
    input: string;
    output: string;
    categories: string[];
    extensions: string[];
    rename: string;
  }>;
  settings: { content: { merge: boolean }; commit: { identity: string } };
  content: Array<{
    name: string;
    label: string;
    type: 'collection' | 'file';
    path: string;
    operations?: { create: boolean; rename: boolean; delete: boolean };
    fields: CmsField[];
    view?: { fields?: string[] };
  }>;
};

describe('Pages CMS maintenance safeguards', () => {
  it('preserves unmanaged fields and uses the GitHub app identity', () => {
    expect(config.settings.content.merge).toBe(true);
    expect(config.settings.commit.identity).toBe('app');
  });

  it('allows deleting blog and landing entries while keeping URL renames disabled', () => {
    const collections = config.content.filter((entry) => ['blog', 'landing-pages'].includes(entry.name));
    expect(collections).toHaveLength(2);
    for (const collection of collections) {
      expect(collection.operations).toEqual({ create: true, rename: false, delete: true });
    }
  });

  it('keeps sitemap generation automatic instead of exposing raw XML', () => {
    expect(config.content.find((entry) => entry.name === 'sitemap')).toBeUndefined();
  });

  it('explains rendered HTML semantics in operator-facing labels', () => {
    const homepage = config.content.find((entry) => entry.name === 'homepage');
    const hero = homepage?.fields.find((field) => field.name === 'hero');
    expect(hero?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'eyebrow', label: expect.stringContaining('SPAN'), description: expect.any(String) }),
      expect.objectContaining({ name: 'heading', label: expect.stringContaining('H1'), description: expect.any(String) }),
      expect.objectContaining({ name: 'intro', label: expect.stringContaining('P'), description: expect.any(String) }),
    ]));

    const landingPages = config.content.find((entry) => entry.name === 'landing-pages');
    const process = landingPages?.fields.find((field) => field.name === 'process');
    expect(process?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'heading', label: expect.stringContaining('H2'), description: expect.any(String) }),
      expect.objectContaining({ name: 'intro', label: expect.stringContaining('P'), description: expect.any(String) }),
    ]));
    expect(process?.fields?.find((field) => field.name === 'steps')?.list).toEqual(
      expect.objectContaining({ min: 3, max: 3 }),
    );
    const faq = landingPages?.fields.find((field) => field.name === 'faq');
    expect(faq?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'heading', label: expect.stringContaining('H2'), description: expect.any(String) }),
      expect.objectContaining({ name: 'intro', label: expect.stringContaining('P'), description: expect.any(String) }),
      expect.objectContaining({ name: 'items', type: 'object' }),
    ]));
  });
  it('exposes editable homepage feature screens', () => {
    const homepage = config.content.find((entry) => entry.name === 'homepage');
    const features = homepage?.fields.find((field) => field.name === 'features');
    expect(features?.type).toBe('object');
    expect(features?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'heading', label: expect.stringContaining('H2'), description: expect.any(String) }),
      expect.objectContaining({ name: 'intro', label: expect.stringContaining('P'), description: expect.any(String) }),
      expect.objectContaining({ name: 'items', type: 'object' }),
    ]));
    const items = features?.fields?.find((field) => field.name === 'items');
    expect(items?.list).toEqual(expect.objectContaining({ min: 1 }));
    expect(items?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'eyebrow', type: 'string' }),
      expect.objectContaining({ name: 'heading', type: 'string' }),
      expect.objectContaining({ name: 'image', type: 'image' }),
      expect.objectContaining({ name: 'imageAlt', type: 'string' }),
      expect.objectContaining({ name: 'listItems', type: 'string' }),
      expect.objectContaining({ name: 'imagePosition', type: 'select' }),
    ]));
  });

  it('exposes an editable FAQ list of question and answer pairs', () => {
    const homepage = config.content.find((entry) => entry.name === 'homepage');
    const faq = homepage?.fields.find((field) => field.name === 'faq');
    expect(faq?.type).toBe('object');
    expect(faq?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'heading', label: expect.stringContaining('H2'), description: expect.any(String) }),
      expect.objectContaining({ name: 'intro', label: expect.stringContaining('P'), description: expect.any(String) }),
      expect.objectContaining({ name: 'items', type: 'object' }),
    ]));
    const items = faq?.fields?.find((field) => field.name === 'items');
    expect(items?.list).toEqual(expect.objectContaining({ min: 1 }));
    expect(items?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'question', type: 'string' }),
      expect.objectContaining({ name: 'answer', type: 'text' }),
    ]));
  });

  it('exposes a named image library backed by public uploads', () => {
    expect(config.media).toEqual([
      expect.objectContaining({
        name: 'images',
        label: '静态图片 / Static images',
        input: 'public/uploads',
        output: '/uploads',
        categories: ['image'],
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'],
        rename: 'safe',
      }),
    ]);
  });

  it('exposes the homepage as a single editable file with an image field', () => {
    const homepage = config.content.find((entry) => entry.name === 'homepage');
    expect(homepage).toMatchObject({
      label: '首页 / Homepage',
      type: 'file',
      path: 'src/content/homepage/home.json',
    });
    expect(homepage?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'shareImage', type: 'image', options: { media: 'images' } }),
        expect.objectContaining({ name: 'features', type: 'object' }),
        expect.objectContaining({ name: 'faq', type: 'object' }),
      ]),
    );
  });

  it('exposes shared header and footer settings as a single editable file', () => {
    const siteSettings = config.content.find((entry) => entry.name === 'site-settings');
    expect(siteSettings).toMatchObject({
      label: '站点设置 / Site settings',
      type: 'file',
      path: 'src/content/settings/site.json',
    });
    expect(siteSettings?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'logo', type: 'image', options: { media: 'images' } }),
        expect.objectContaining({ name: 'favicon', type: 'image', options: { media: 'images' } }),
        expect.objectContaining({ name: 'header', type: 'object' }),
        expect.objectContaining({ name: 'footer', type: 'object' }),
      ]),
    );
    const header = siteSettings?.fields.find((field) => field.name === 'header');
    const navigation = header?.fields?.find((field) => field.name === 'navigation');
    expect(navigation?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'children', type: 'object' }),
    ]));
  });

  it('connects the blog rich-text editor to the static image library', () => {
    const blog = config.content.find((entry) => entry.name === 'blog');
    expect(blog?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'contentMode',
          type: 'select',
          options: { values: expect.arrayContaining([
            expect.objectContaining({ name: 'markdown' }),
            expect.objectContaining({ name: 'html' }),
          ]) },
        }),
        expect.objectContaining({
          name: 'body',
          type: 'rich-text',
          options: { media: 'images', format: 'markdown', switcher: true },
        }),
        expect.objectContaining({
          name: 'bodyHtml',
          type: 'rich-text',
          options: { media: 'images', format: 'html', switcher: true },
        }),
      ]),
    );
  });

  it('exposes reusable image metadata as a CMS-managed file', () => {
    const imageMetadata = config.content.find((entry) => entry.name === 'image-metadata');
    expect(imageMetadata).toMatchObject({
      label: '图片信息 / Image metadata',
      type: 'file',
      path: 'src/content/settings/images.json',
    });
    expect(imageMetadata?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'images', type: 'object' }),
    ]));
  });

  it('shows the blog URL path in the collection list', () => {
    const blog = config.content.find((entry) => entry.name === 'blog');
    expect(blog?.view?.fields).toEqual(['title', 'slug', 'category', 'publishedAt', 'draft']);
  });

  it('exposes blog cover, author, category, featured, and draft fields', () => {
    const blog = config.content.find((entry) => entry.name === 'blog');
    expect(blog?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'coverImage', type: 'image', options: { media: 'images' } }),
      expect.objectContaining({ name: 'coverAlt', type: 'string' }),
      expect.objectContaining({ name: 'author', type: 'string' }),
      expect.objectContaining({ name: 'category', type: 'string' }),
      expect.objectContaining({ name: 'featured', type: 'boolean' }),
      expect.objectContaining({ name: 'draft', type: 'boolean' }),
    ]));
  });

  it('exposes legal pages and marketing page settings without a shared landing entry', () => {
    expect(config.content.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'legal-pages',
      'blog-index',
      'not-found',
    ]));
    expect(config.content.find((entry) => entry.name === 'landing-common')).toBeUndefined();
    const legalPages = config.content.find((entry) => entry.name === 'legal-pages');
    expect(legalPages?.operations).toEqual({ create: false, rename: false, delete: false });
  });
});
