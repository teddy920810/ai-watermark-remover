import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const articles = [
  {
    slug: 'how-to-turn-off-gemini-watermark',
    title: 'How to Turn Off Gemini Watermark (2026 Guide)',
    seoTitle: 'How to Turn Off Gemini Watermark (2026 Web & Mobile Guide)',
    description: "Learn how to turn off Gemini watermark on web and mobile, troubleshoot a missing Media Watermark setting, and handle images you've already downloaded.",
    extension: 'png',
    headings: 8,
    imageHashes: [
      'd2cefe8c5b72c96e235b167a04595fece3f44c642d9f12890f9b25d933cd3791',
      '62f1f227bf159ecb78f59019c5b327618e0d4dfa193f19fab0797024723a10a5',
      'bde7024e48e723989547953c3be606fe2830f6b96178cb2d8c4a246beecde347',
    ],
    passages: [
      'The key distinction is between a new creation and a file you already downloaded.',
      'It does not remove SynthID or Content Credentials.',
      "WatermarkGemini's separate video workspace has its own current limits and credit rules",
      'FAQ: Turning Off Gemini Watermark',
    ],
    links: [
      'https://support.google.com/gemini/answer/17405358',
      'https://support.google.com/gemini/answer/16722517',
      'https://support.google.com/flow/answer/16353333',
      'https://www.watermarkgemini.com/gemini-watermark-remover',
    ],
  },
  {
    slug: 'how-to-remove-date-stamp-from-photo',
    title: 'How to Remove Date Stamp from Photo: 6 Practical Methods',
    seoTitle: 'How to Remove Date Stamp from Photo: 6 Easy Methods (2026)',
    description: 'Learn how to remove a date stamp from a photo online, on iPhone or Android, or with Photoshop, GIMP and Lightroom—without unnecessary cropping.',
    extension: 'jpg',
    headings: 13,
    imageHashes: [
      '3c3116c831493e3d49110d16cfffa7ae7cc4409d8a1159c0fc9f596fd31a5c12',
      'fc411e767c42427ee038dc57414a2b5a859b46d56db0993d306c43627aeffa92',
      '84901951384bbd713f7aa86f76c8bfd45bd053b85d8f0d18a4b5936531d3845f',
      '9ace8cb6fa8024f779c2c12a66e1c727743bdc975b0bce90662c05c24bf2c39a',
    ],
    passages: [
      'First, Check: Is It a Visible Date Stamp or Photo Metadata?',
      'Method 6: Remove a Date Stamp in Lightroom, on Mac, or Windows',
      'This is not a live WatermarkGemini interface screenshot or a guaranteed result.',
      'they cannot guarantee the exact original pixels that were hidden by the printed digits.',
    ],
    links: [
      'https://support.apple.com/en-la/121429',
      'https://support.google.com/photos/answer/6128850?co=GENIE.Platform%3DAndroid&hl=en',
      'https://docs.gimp.org/en_GB/gimp-tool-heal.html',
      'https://helpx.adobe.com/lightroom/desktop/edit-photos/remove-tool.html',
    ],
  },
];

describe('October operations final articles', () => {
  it.each(articles)('publishes $slug with the supplied SEO and complete article structure', (article) => {
    const source = fs.readFileSync(path.join('src/content/blog', `${article.slug}.md`), 'utf8');
    const [, frontmatter, body] = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)!;
    expect(YAML.parse(frontmatter)).toMatchObject({
      slug: article.slug,
      title: article.title,
      seoTitle: article.seoTitle,
      description: article.description,
      publishedAt: '2026-10-25',
      draft: false,
      contentMode: 'markdown',
      coverImage: `/uploads/${article.slug}-figure-1.${article.extension}`,
    });
    expect(body).not.toMatch(/^(?:\*\*)?(?:SEO title|Meta description|URL Slug|Slug|Primary Keyword):/im);
    expect(body).not.toMatch(/^# /m);
    expect(body.match(/^## /gm)).toHaveLength(article.headings);
    expect(body.match(/^\| (?:---\s*\|\s*)+$/gm)).toHaveLength(2);
    for (const passage of article.passages) expect(body.replace(/\*\*/g, '')).toContain(passage);
    for (const link of article.links) expect(body).toContain(link);
    const images = [...body.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
    expect(images).toHaveLength(article.imageHashes.length - 1);
    for (const [index, image] of images.entries()) {
      expect(image[1].trim()).not.toBe('');
      expect(image[2]).toBe(`/uploads/${article.slug}-figure-${index + 2}.${article.extension}`);
    }
  });

  it.each(articles)('preserves every supplied image for $slug byte for byte', (article) => {
    for (const [index, hash] of article.imageHashes.entries()) {
      const image = fs.readFileSync(path.join('public/uploads', `${article.slug}-figure-${index + 1}.${article.extension}`));
      expect(createHash('sha256').update(image).digest('hex')).toBe(hash);
    }
  });
});
