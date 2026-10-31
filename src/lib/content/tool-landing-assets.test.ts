import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Public production CSS referenced by HTML cached before the v16 release.
// Keep the decoded bytes intact while newer pages use their new hashed styles.
const publishedStyles = [
  ['SiteLayout.BLUMmVhG.css', 58471, 'ccb2e828e00fed000d7aec49aa65de14c4d09bf5cbe36c65c6e382dfea512f60'],
  ['_slug_.Cs3H74rl.css', 8839, '7ade13130d6ae7b90558a77c7d0699f78120c504158bec24975fbf961a591418'],
] as const;

describe('tool landing release asset compatibility', () => {
  it.each(publishedStyles)('retains published CSS %s byte-for-byte for already-open pages', (file, bytes, sha256) => {
    const content = readFileSync(new URL(`../../../public/_site-assets/${file}`, import.meta.url));
    expect(content.length).toBe(bytes);
    expect(createHash('sha256').update(content).digest('hex')).toBe(sha256);
  });
});
