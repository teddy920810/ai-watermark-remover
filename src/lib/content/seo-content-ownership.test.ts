import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import baseline from '../../../tests/fixtures/seo-content-baseline.json';
import { resolveImagePair } from './image-pair';
import { projectContent, contentHash } from '../../../scripts/lib/content-baseline.mjs';

describe('content-owner baseline outside the engineering refactor', () => {
  it.each(baseline.files)('preserves original media, alt and copy in $file', ({ file, semanticSha256 }) => {
    expect(contentHash(projectContent(file, readFileSync(file, 'utf8'))), file).toBe(semanticSha256);
  });
  it('renders the configured primary source instead of an illustrative legacy override', () => {
    expect(resolveImagePair({ image: '/uploads/original-seo.webp', comparison: { image: '/uploads/illustration.png', watermark: 'EXAMPLE' } })).toEqual({ image: '/uploads/original-seo.webp' });
  });
});
