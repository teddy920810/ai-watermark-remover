import { expect, it } from 'vitest';
import { linkToolWorkspaceForSource } from './route-policy.mjs';
it('registers only the TikTok link tool without repurposing file tools', () => {
  expect(linkToolWorkspaceForSource('/tiktok-watermark-remover')).toBe('/app/free/tiktok');
  expect(linkToolWorkspaceForSource('tiktok-watermark-remover/')).toBe('/app/free/tiktok');
  expect(linkToolWorkspaceForSource('/gemini-watermark-remover')).toBeNull();
});
