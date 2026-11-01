import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('shared foundation and target style ownership', () => {
  it('gives tokens, buttons and account chrome one shared owner outside Site marketing styles', () => {
    const foundation = new URL('../../styles/design-system.css', import.meta.url);
    expect(existsSync(foundation)).toBe(true);
    const shared = readFileSync(foundation, 'utf8');
    expect(shared).toContain('--brand-blue: #3975ff;');
    expect(shared).toContain('.button-primary');
    expect(shared).toContain('.header-account-panel');
    expect(shared).not.toMatch(/\.hero-inner|\.landing-scope-section|\.site-footer|\.tool-card/);
    expect(readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8')).toContain('@import "./design-system.css"');
    for (const file of ['app/credits.astro', 'pricing.astro']) {
      const source = readFileSync(new URL(`../../pages/${file}`, import.meta.url), 'utf8');
      expect(source, file).toContain('styles/design-system.css');
      expect(source, file).not.toContain('styles/global.css');
    }
    const workspaceLayout = readFileSync(new URL('../../layouts/AppWorkspaceLayout.astro', import.meta.url), 'utf8');
    expect(workspaceLayout).toContain('styles/design-system.css');
    expect(workspaceLayout).not.toContain('styles/global.css');
    for (const file of ['index.astro', '[kind].astro']) expect(readFileSync(new URL(`../../pages/app/${file}`, import.meta.url), 'utf8')).toContain('AppWorkspaceLayout');
  });
});
