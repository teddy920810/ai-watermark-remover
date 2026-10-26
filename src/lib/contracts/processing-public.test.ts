import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PublicArtifact, PublicDownload, PublicJob, PublicQuote } from './processing-public';
import type { PublicArtifact as ClientArtifact, PublicJob as ClientJob, PublicQuote as ClientQuote } from '../../components/workspace/workspace-api';
import type { PublicProcessingProjection } from '../runtime/public-projection';

describe('public processing contract boundary', () => {
  it('shares only type declarations without importing server or provider implementations', async () => {
    const source = readFileSync(new URL('./processing-public.ts', import.meta.url), 'utf8');
    const parsed = ts.createSourceFile('processing-public.ts', source, ts.ScriptTarget.Latest, true);
    expect(parsed.statements.every(statement => ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))).toBe(true);
    expect(Object.keys(await import('./processing-public'))).toEqual([]);
  });

  it('uses the same complete wire types in the browser client and server projection', () => {
    const client = readFileSync(new URL('../../components/workspace/workspace-api.ts', import.meta.url), 'utf8');
    const projection = readFileSync(new URL('../runtime/public-projection.ts', import.meta.url), 'utf8');
    expect(client).toContain("from '../../lib/contracts/processing-public'");
    expect(projection).toContain("from '../contracts/processing-public'");
    expectTypeOf<ClientArtifact>().toEqualTypeOf<PublicArtifact>();
    expectTypeOf<ClientQuote>().toEqualTypeOf<PublicQuote>();
    expectTypeOf<ClientJob>().toEqualTypeOf<PublicJob>();
    expectTypeOf<Awaited<ReturnType<PublicProcessingProjection['artifact']>>>().toEqualTypeOf<PublicArtifact>();
    expectTypeOf<Awaited<ReturnType<PublicProcessingProjection['quote']>>>().toEqualTypeOf<PublicQuote>();
    expectTypeOf<Awaited<ReturnType<PublicProcessingProjection['job']>>>().toEqualTypeOf<PublicJob>();
    expectTypeOf<Awaited<ReturnType<PublicProcessingProjection['download']>>>().toEqualTypeOf<PublicDownload>();
  });

  it('keeps the workspace request client browser-only when bundled', async () => {
    const bundled = await build({
      entryPoints: [fileURLToPath(new URL('../../components/workspace/workspace-api.ts', import.meta.url))],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
    });
    expect(Object.keys(bundled.metafile!.inputs).join('\n')).not.toMatch(/(?:runtime|providers|processing|r2)\//);
  });

  it('retires the unreferenced image uploader while preserving the active tool entries', () => {
    expect(existsSync(new URL('../../components/uploader/ImageUploader.tsx', import.meta.url))).toBe(false);
    const home = readFileSync(new URL('../../pages/index.astro', import.meta.url), 'utf8');
    const landing = readFileSync(new URL('../../components/LandingPage.astro', import.meta.url), 'utf8');
    expect(home).toContain('<MediaLauncher autoDetect');
    expect(landing).toContain('<MediaLauncher kind=');
    expect(landing).toContain('<BackgroundRemoverUploader');
    expect(landing).toContain('<ObjectRemoverUploader');
  });
});
