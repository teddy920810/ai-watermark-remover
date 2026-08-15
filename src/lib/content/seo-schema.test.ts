import { describe, expect, it } from 'vitest';
import { buildArticleSchema, buildCollectionPageSchema, buildWebPageSchema } from './seo-schema';

const canonicalOrigin = 'https://www.watermarkgemini.com';

describe('contextual SEO schemas', () => {
  it('uses CollectionPage for the blog index and WebPage for legal content', () => {
    expect(buildCollectionPageSchema({
      canonicalOrigin,
      path: '/blog',
      name: 'Image Cleanup Guides',
      description: 'Guides for image cleanup.',
    })).toMatchObject({
      '@type': 'CollectionPage',
      url: 'https://www.watermarkgemini.com/blog',
    });

    expect(buildWebPageSchema({
      canonicalOrigin,
      path: '/privacy',
      name: 'Privacy Policy',
      description: 'How the service handles uploads.',
    })).toMatchObject({
      '@type': 'WebPage',
      url: 'https://www.watermarkgemini.com/privacy',
    });
  });

  it('adds complete publisher and canonical fields to Article schema', () => {
    const schema = buildArticleSchema({
      canonicalOrigin,
      path: '/blog/image-format-guide',
      title: 'Best image format for your website',
      description: 'A guide to JPG, PNG, and WebP.',
      publishedAt: '2026-08-02',
      updatedAt: '2026-08-16',
      author: 'WatermarkGemini Editorial Team',
      publisherName: 'WatermarkGemini',
      logo: '/uploads/watermarkgemini-logo.svg',
      image: '/uploads/cover.webp',
    });

    expect(schema).toMatchObject({
      '@type': 'Article',
      url: 'https://www.watermarkgemini.com/blog/image-format-guide',
      datePublished: '2026-08-02',
      dateModified: '2026-08-16',
      mainEntityOfPage: { '@type': 'WebPage', '@id': 'https://www.watermarkgemini.com/blog/image-format-guide' },
      publisher: {
        '@type': 'Organization',
        name: 'WatermarkGemini',
        logo: { '@type': 'ImageObject', url: 'https://www.watermarkgemini.com/uploads/watermarkgemini-logo.svg' },
      },
      image: 'https://www.watermarkgemini.com/uploads/cover.webp',
    });
  });

  it('uses the publication date as dateModified until an editor supplies an update date', () => {
    expect(buildArticleSchema({
      canonicalOrigin,
      path: '/blog/guide',
      title: 'Guide',
      description: 'Description',
      publishedAt: '2026-08-02',
      author: 'WatermarkGemini',
      publisherName: 'WatermarkGemini',
      logo: '/uploads/watermarkgemini-logo.svg',
    }).dateModified).toBe('2026-08-02');
  });
});
