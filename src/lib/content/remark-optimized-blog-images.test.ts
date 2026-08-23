import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { optimizeBlogImages } from './remark-optimized-blog-images';

type TestNode = {
  type: string;
  url?: string;
  alt?: string;
  title?: string;
  value?: string;
  children?: TestNode[];
};

const blogDirectory = join('repo', 'src', 'content', 'blog');

describe('optimized Markdown blog images', () => {
  it('renders a responsive WebP source while preserving the original CMS image fallback', () => {
    const tree: TestNode = {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [{
          type: 'image',
          url: '/uploads/example.png',
          alt: 'Example <before> & after',
          title: 'A "clean" result',
        }],
      }],
    };

    optimizeBlogImages({
      blogDirectory,
      resolveDimensions: () => ({ width: 1672, height: 941 }),
    })(tree, { path: join(blogDirectory, 'post.md') });

    const image = tree.children?.[0].children?.[0];
    expect(image?.type).toBe('html');
    expect(image?.value).toContain('<picture class="responsive-blog-image">');
    expect(image?.value).toContain('type="image/webp"');
    expect(image?.value).toContain('/generated/uploads/example.png-1200.webp 1200w');
    expect(image?.value).toContain('src="/uploads/example.png"');
    expect(image?.value).toContain('alt="Example &lt;before&gt; &amp; after"');
    expect(image?.value).toContain('width="1672" height="941"');
  });

  it('leaves remote, existing WebP, and non-blog images unchanged', () => {
    const nodes: TestNode[] = [
      { type: 'image', url: 'https://example.com/image.png' },
      { type: 'image', url: '/uploads/example.webp' },
    ];
    const tree: TestNode = { type: 'root', children: nodes };
    const transform = optimizeBlogImages({
      blogDirectory,
      resolveDimensions: () => ({ width: 1000, height: 600 }),
    });

    transform(tree, { path: join(blogDirectory, 'post.md') });
    transform({ type: 'root', children: [{ type: 'image', url: '/uploads/legal.png' }] }, {
      path: join('repo', 'src', 'content', 'legal', 'privacy.md'),
    });

    expect(tree.children).toEqual(nodes);
  });
});
