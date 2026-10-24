import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const video = JSON.parse(readFileSync('src/content/landing-pages/video-watermark-remover.json', 'utf8'));
const home = JSON.parse(readFileSync('src/content/homepage/home.json', 'utf8'));
const settings = JSON.parse(readFileSync('src/content/settings/site.json', 'utf8'));

describe('published processing scope', () => {
  it('publishes video requirements and administrator allowance without promising free processing', () => {
    expect(video.statusLabel ?? '').not.toMatch(/coming soon/i);
    expect(video.title).not.toMatch(/free/i);
    expect(`${video.intro} ${video.process.intro}`).toMatch(/24\s?fps/i);
    expect(`${video.intro} ${video.process.intro}`).toMatch(/100\s?MB/i);
    expect(`${video.intro} ${video.process.intro}`).toMatch(/9\s?min/i);
    expect(JSON.stringify(video.faq)).toMatch(/administrator/i);
    expect(JSON.stringify(video.faq)).toMatch(/moving-watermark tracking is not supported/i);
    expect(video.uploader.dropzone.dropLabel).not.toMatch(/coming soon/i);
    expect(video.uploader.dropzone.fileInputLabel).toMatch(/MP4 video/i);
  });

  it('links the launched video workspace from the homepage FAQ and removes its stale navigation badge', () => {
    const questions = JSON.stringify(home);
    expect(questions).toMatch(/dedicated video workspace/i);
    expect(questions).not.toMatch(/video watermark removal is planned/i);
    const items: Array<{ href?: string; badge?: string }> = [];
    function walk(value: unknown) {
      if (!value || typeof value !== 'object') return;
      if ('href' in value) items.push(value as { href?: string; badge?: string });
      for (const child of Object.values(value)) walk(child);
    }
    walk(settings);
    const links = items.filter(item => item.href === '/video-watermark-remover');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.badge ?? '').not.toMatch(/coming soon/i);
  });
});
