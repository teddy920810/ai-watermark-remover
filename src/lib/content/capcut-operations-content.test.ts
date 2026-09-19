import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const pageUrl = new URL('../../content/landing-pages/capcut-watermark-remover.json', import.meta.url);
const hashes = [
  '53ca5eafa4ad5ddf90f04530cef6b95f30cee529cb9f04ab1e7d599e89ab32fa',
  'ce2a0ac0ebfd947b01afac1dfdbb7730b2566a27f3e5f3fcc4469b4d503a0ac7',
  '50b558400259f72ca5c686dd4c412dea1ec9305f615187b7dea14a147be1b905',
];

describe('CapCut operations Word content', () => {
  it('replaces the placeholder copy while retaining the existing route and availability', () => {
    const page = JSON.parse(readFileSync(pageUrl, 'utf8'));
    expect(page).toMatchObject({
      slug: 'capcut-watermark-remover', toolKind: 'watermark-remover', draft: false,
      statusLabel: 'Coming Soon',
      title: 'CapCut Watermark Remover Online — Coming Soon | WatermarkGemini',
      heading: 'CapCut Watermark Remover — Coming Soon',
    });
    expect(page.heroActions).toEqual([{ label: 'See available image cleanup tools', href: '/#tool' }]);
    expect(page.uploader.dropzone.dropLabel).toBe('Coming Soon');
    expect(page.process.heading).toBe('How to prepare for a CapCut watermark cleanup');
    expect(page.process.steps).toHaveLength(3);
    expect(page.features.items.map((item: { heading: string }) => item.heading)).toEqual([
      'Use an export you can edit', 'Identify the visible area', 'Review before you export',
    ]);
    expect(page.faq.items).toHaveLength(6);
    expect(page.faq.items[0].question).toBe('Is this a capcut watermark remover?');
    expect(page.cta.buttonHref).toBe('/#tool');
    expect(JSON.stringify(page)).not.toMatch(/HOLD|Candidate copy:|Production placement|Asset preview:|Initial answers|future operations updates/);
  });

  it('uses the three unchanged source images for the steps and feature panels', () => {
    const page = JSON.parse(readFileSync(pageUrl, 'utf8'));
    for (const [index, hash] of hashes.entries()) {
      const image = `/uploads/capcut-operations-feature-${index + 1}.png`;
      expect(page.process.steps[index].image).toBe(image);
      expect(page.features.items[index].image).toBe(image);
      const buffer = readFileSync(new URL(`../../../public${image}`, import.meta.url));
      expect(createHash('sha256').update(buffer).digest('hex')).toBe(hash);
    }
  });
});
