import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { IMAGE_PLACEHOLDER_SRC } from './image-fallback';
import { replaceMissingBlogImages } from './remark-missing-blog-images';

type TestNode = {
  type: string;
  url?: string;
  value?: string;
  children?: TestNode[];
};

const blogDirectory = join('repo', 'src', 'content', 'blog');

function imageTree(...urls: string[]): TestNode {
  return {
    type: 'root',
    children: [{ type: 'paragraph', children: urls.map((url) => ({ type: 'image', url })) }],
  };
}

describe('missing blog image tolerance', () => {
  it('replaces a missing relative body image with the shared placeholder and reports a non-fatal warning', () => {
    const warn = vi.fn();
    const tree = imageTree('missing/image.png');

    replaceMissingBlogImages({ blogDirectory, exists: () => false, warn })(tree, {
      path: join(blogDirectory, 'post.md'),
    });

    expect(tree.children?.[0].children?.[0]).toEqual({
      type: 'image',
      url: IMAGE_PLACEHOLDER_SRC,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('[content] Missing blog image replaced with placeholder: post.md -> missing/image.png');
  });

  it('preserves existing, public, remote, data, and non-blog images', () => {
    const warn = vi.fn();
    const urls = ['existing.png', '/uploads/public.png', 'https://example.com/remote.png', 'data:image/png;base64,AA'];
    const tree = imageTree(...urls);
    const transformer = replaceMissingBlogImages({
      blogDirectory,
      exists: (path) => path.endsWith('existing.png') || path.endsWith('public.png'),
      warn,
    });

    transformer(tree, { path: join(blogDirectory, 'post.md') });
    transformer(imageTree('missing.png'), { path: join('repo', 'src', 'content', 'legal', 'privacy.md') });

    expect(tree.children?.[0].children?.map((node) => node.url)).toEqual(urls);
    expect(warn).not.toHaveBeenCalled();
  });

  it('replaces a missing public upload referenced from Markdown', () => {
    const tree = imageTree('/uploads/missing.webp');

    replaceMissingBlogImages({ blogDirectory, publicDirectory: join('repo', 'public'), exists: () => false })(tree, {
      path: join(blogDirectory, 'post.md'),
    });

    expect(tree.children?.[0].children?.[0]?.url).toBe(IMAGE_PLACEHOLDER_SRC);
  });
});
