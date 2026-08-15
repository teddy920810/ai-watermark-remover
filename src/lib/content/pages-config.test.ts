import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const configSource = readFileSync(new URL('../../../.pages.yml', import.meta.url), 'utf8');
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
    fields: Array<{ name: string; type: string; options?: { media?: string } }>;
    view?: { fields?: string[] };
  }>;
};

describe('Pages CMS maintenance safeguards', () => {
  it('preserves unmanaged fields and uses the GitHub app identity', () => {
    expect(config.settings.content.merge).toBe(true);
    expect(config.settings.commit.identity).toBe('app');
  });

  it('prevents non-technical editors from renaming or deleting entries', () => {
    const collections = config.content.filter((entry) => ['blog', 'landing-pages'].includes(entry.name));
    expect(collections).toHaveLength(2);
    for (const collection of collections) {
      expect(collection.operations).toEqual({ create: true, rename: false, delete: false });
    }
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
        expect.objectContaining({ name: 'favicon', type: 'image', options: { media: 'images' } }),
        expect.objectContaining({ name: 'header', type: 'object' }),
        expect.objectContaining({ name: 'footer', type: 'object' }),
      ]),
    );
  });

  it('connects the blog rich-text editor to the static image library', () => {
    const blog = config.content.find((entry) => entry.name === 'blog');
    expect(blog?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'body', type: 'rich-text', options: { media: 'images' } }),
      ]),
    );
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

  it('exposes legal pages and shared marketing page settings', () => {
    expect(config.content.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'legal-pages',
      'blog-index',
      'landing-common',
      'not-found',
    ]));
    const legalPages = config.content.find((entry) => entry.name === 'legal-pages');
    expect(legalPages?.operations).toEqual({ create: false, rename: false, delete: false });
  });
});
