import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
const root = new URL('../../../', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');
describe('retired UI and content ownership', () => {
  it.each(['src/components/HomeComparison.astro','src/components/LandingComparison.astro','src/components/workspace/LegacyImageWorkspace.tsx','src/components/uploader/BackgroundRemoverUploader.tsx','src/components/uploader/ObjectRemoverUploader.tsx','src/components/uploader/upload-machine.ts','src/components/payments/useImageCreditPrice.ts','src/components/launcher/launcher-copy.ts','src/lib/upload/direct-upload.ts'])('removes %s after new consumers are verified', file => {
    expect(existsSync(new URL(file,root))).toBe(false);
  });
  it('preserves old admission/query and Provider/financial recovery owners', () => {
    for(const file of ['src/pages/api/jobs/index.ts','src/pages/api/jobs/[id].ts','src/pages/api/upload-url.ts','src/lib/jobs/job-service.ts','src/lib/providers/replicate-background-provider.ts','src/lib/providers/replicate-object-provider.ts','apps/app/retained-assets.json']) expect(existsSync(new URL(file,root)),file).toBe(true);
  });
  it('keeps retired product controls and dead CTA settings outside CMS while retaining record merge', () => {
    const config=YAML.parse(read('.pages.yml'));
    expect(config.components['uploader-copy-override']).toBeUndefined();
    expect(config.settings.content.merge).toBe(true);
    for(const name of ['site-settings','landing-pages']) {
      const cta=config.content.find((entry:{name:string})=>entry.name===name).fields.find((field:{name:string})=>field.name==='cta');
      expect(cta.fields.map((field:{name:string})=>field.name)).toEqual(['eyebrow','heading','description']);
    }
    const notFound=config.content.find((entry:{name:string;path?:string})=>entry.path==='src/content/settings/not-found.json');
    if(notFound) expect(notFound.fields.some((field:{name:string})=>field.name==='buttonLabel')).toBe(true);
  });
  it('keeps active App editor rules in their own scope and removes obsolete Site overlays', () => {
    expect(read('src/styles/global.css')).not.toMatch(/\.background-(?:tool|result|swatch)|\.object-(?:workspace|editor)|\.is-tool-expanded/);
    expect(read('src/styles/home-blueprint.css')+read('src/styles/home-integration.css')+read('src/styles/tool-landing.css')).not.toMatch(/\.(?:home-compare|landing-compare|fixed-watermark|home-splitter)\b/);
    const editor=read('src/styles/image-editor.css');expect(editor).toContain('.workspace-image-options');expect(editor).not.toContain('.app-legacy-operation');expect(editor).not.toMatch(/\.(?:object-workspace|background-result-stage|tool-card)\b/);
  });
  it('does not serialize unused CMS product controls into App', () => {
    expect(read('src/layouts/AppWorkspaceLayout.astro')).not.toContain('copy={');
    expect(read('src/components/workspace/app-entry.ts')).not.toContain('legacyOperationCopy');
    expect(read('src/lib/content/site-settings.ts')).not.toContain('resolveUploaderCopy');
  });
});
