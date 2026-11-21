import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const pageUrl = new URL('../../content/landing-pages/capcut-watermark-remover.json', import.meta.url);
const hashes = [
  '53ca5eafa4ad5ddf90f04530cef6b95f30cee529cb9f04ab1e7d599e89ab32fa',
  'ce2a0ac0ebfd947b01afac1dfdbb7730b2566a27f3e5f3fcc4469b4d503a0ac7',
  '50b558400259f72ca5c686dd4c412dea1ec9305f615187b7dea14a147be1b905',
];

describe('CapCut operations content', () => {
  it('uses the approved copy while retaining the existing route and availability', () => {
    const page = JSON.parse(readFileSync(pageUrl, 'utf8'));
    expect(page).toMatchObject({
      slug: 'capcut-watermark-remover', toolKind: 'watermark-remover', draft: false,
      title: 'CapCut Watermark Remover: Ending, Template & Video Fixes',
      heading: 'CapCut Watermark Remover for Ending Clips & Video Marks',
    });
    expect(page.heroActions).toEqual([
      { label: 'Explore Video Watermark Remover', href: '/video-watermark-remover' },
      { label: 'See available image cleanup tools', href: '/#tool' },
    ]);
    expect(page.statusLabel).toBeUndefined();
    expect(page.uploader.dropzone.dropLabel).toBeUndefined();
    expect(page.process.heading).toBe('How to Remove a CapCut Watermark from Your Video');
    expect(page.process.steps).toHaveLength(3);
    expect(page.features.items.map((item: { heading: string }) => item.heading)).toEqual([
      'Remove the Separate CapCut Ending Before Export',
      'Check Template Logos and Pro-Only Elements',
      'Clean an Authorized Fixed Logo After Export',
      'Avoid Blurry Patches, Flicker and Misleading Free Claims',
    ]);
    expect(page.faq.items).toHaveLength(11);
    expect(page.faq.items.find((item: { question: string }) => item.question.includes('available online')).answer)
      .toContain('CapCut-specific workflow on this page is not live yet');
    expect(page.cta.buttonHref).toBe('/video-watermark-remover');
    expect(JSON.stringify(page)).not.toMatch(/HOLD|Candidate copy:|Production placement|Asset preview:|Initial answers|future operations updates/);
  });

  it('retains the three operations images in the workflow steps', () => {
    const page = JSON.parse(readFileSync(pageUrl, 'utf8'));
    for (const [index, hash] of hashes.entries()) {
      const image = `/uploads/capcut-operations-feature-${index + 1}.png`;
      expect(page.process.steps[index].image).toBe(image);
      const buffer = readFileSync(new URL(`../../../public${image}`, import.meta.url));
      expect(createHash('sha256').update(buffer).digest('hex')).toBe(hash);
    }
  });
});
