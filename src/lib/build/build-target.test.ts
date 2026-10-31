import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectTargetRoutes, createBuildPlan, prepareBuildInputs, targetIntegration, classifyTargetChanges, renderGatewayConfig, renderAppSiteProxy, configureAppSiteProxy, validateBuildArtifact, stageDeploymentArtifact } from '../../../scripts/build-target.mjs';

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'watermark-build-target-')); directories.push(root);
  const files = {
    'src/pages/index.astro': '<h1>Marketing</h1>', 'src/pages/[slug].astro': '<h1>Tool</h1>', 'src/pages/blog/[slug].astro': '<h1>Blog</h1>',
    'src/pages/404.astro': '<h1>Not found</h1>', 'src/pages/robots.txt.ts': 'export const GET = () => new Response();',
    'src/pages/api/auth/[...all].ts': 'import "astro:env/server"; throw Error("must not enter site graph");',
    'src/pages/api/v1/[...path].ts': 'export const GET = () => new Response();', 'src/pages/api/v1/contract.test.ts': 'throw Error("test is not a route");',
    'src/pages/auth/popup.astro': '<meta name="robots" content="noindex" />', 'src/pages/app/image.astro': '<h1>Workspace</h1>',
    'src/pages/app/video.astro': '<h1>Workspace video</h1>', 'src/pages/_internal/secret.ts': 'throw Error();',
    'src/content/settings/site.json': JSON.stringify({ logo: '/uploads/logo.svg', favicon: '/favicon.svg', canonicalOrigin: 'https://www.example.test' }),
    'public/uploads/logo.svg': '<svg/>', 'public/favicon.svg': '<svg/>', 'public/uploads/marketing.png': 'marketing',
  };
  for (const [file, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), content); }
  return root;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('independent build targets', () => {
  it('keeps the image-use checkout and payment endpoints in App while Terms remain in Site', () => {
    const root = fixture();
    for (const file of ['src/pages/app/credits.astro', 'src/pages/api/payments/paypal/webhook.ts', 'src/pages/terms.astro']) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), 'fixture');
    }
    const app = collectTargetRoutes(root, 'app').map((route) => route.pattern);
    const site = collectTargetRoutes(root, 'site').map((route) => route.pattern);
    expect(app).toEqual(expect.arrayContaining(['/app/credits', '/api/payments/paypal/webhook']));
    expect(site).not.toContain('/app/credits'); expect(site).not.toContain('/api/payments/paypal/webhook');
    expect(site).toContain('/terms');
  });
  it('selects routes before bundling so site cannot import API, popup or app pages', () => {
    const root = fixture();
    expect(collectTargetRoutes(root, 'site').map((r) => r.pattern).sort()).toEqual(['/404', '/[slug]', '/blog/[slug]', '/', '/robots.txt'].sort());
    expect(collectTargetRoutes(root, 'app').map((r) => r.pattern).sort()).toEqual(['/api/auth/[...all]', '/api/v1/[...path]', '/app/image', '/app/video', '/auth/popup'].sort());
  });
  it('uses static site output and independent source/output/assets/environment namespaces', () => {
    const root = fixture(); const site = createBuildPlan(root, 'site'); const app = createBuildPlan(root, 'app');
    expect(site.output).toBe('static'); expect(site.adapter).toBe(false); expect(site.outDir).not.toBe(app.outDir);
    expect(site.srcDir).toContain(path.join('apps', 'site', 'src')); expect(app.srcDir).toContain(path.join('apps', 'app', 'src'));
    expect(site.assets).toBe('_site-assets'); expect(app.assets).toBe('_app-assets'); expect(site.envDir).not.toBe(root); expect(site.requiredSecrets).toEqual([]);
    expect(app.envDir).not.toBe(root); expect(app.configFile).toBe(path.join(root, 'apps/app/astro.config.mjs'));
  });
  it('keeps functional public CSS resources under the App asset namespace', () => {
    const root = fixture(); const app = targetIntegration(createBuildPlan(root, 'app'));
    const css = app.vitePlugin.transform('a { background: url("/uploads/checker.png"); }', path.join(root, 'src/styles/global.css'));
    expect(css?.code).toContain('/_app-assets/public/uploads/checker.png');
  });
  it('uses official route injection and rejects secret-bearing site module imports', () => {
    const root = fixture(); const integration = targetIntegration(createBuildPlan(root, 'site'));
    const injected: { pattern: string }[] = [];
    integration.hooks['astro:config:setup']!({ injectRoute: (route: { pattern: string }) => injected.push(route) } as never);
    expect(injected.every((r) => !r.pattern.startsWith('/api') && !r.pattern.startsWith('/app'))).toBe(true);
    expect(() => integration.assertModule(path.join(root, 'src/lib/auth.ts'))).toThrow('site build imported');
    expect(() => integration.assertModule(path.join(root, 'src/components/auth/AuthControls.tsx'))).not.toThrow();
  });
  it('classifies content, API and durable execution changes by their actual build targets', () => {
    expect(classifyTargetChanges(['src/content/blog/post.md', '.pages.yml'])).toEqual(['site']);
    expect(classifyTargetChanges(['src/pages/api/v1/[...path].ts'])).toEqual(['app']);
    expect(classifyTargetChanges(['src/lib/runtime/processing-services.ts'])).toEqual(['app', 'worker']);
    expect(classifyTargetChanges(['package-lock.json'])).toEqual(['site', 'app', 'worker']);
    expect(classifyTargetChanges(['apps/worker/Dockerfile', 'docs/DEVELOPER_GUIDE.md'])).toEqual(['worker']);
    expect(classifyTargetChanges(['scripts/build-worker.mjs'])).toEqual(['worker']);
    expect(classifyTargetChanges(['src/lib/providers/watermark-provider.ts', 'db/migrations/008_example.sql'])).toEqual(['app', 'worker']);
    expect(classifyTargetChanges(['src/styles/workspace.css'])).toEqual(['app']);
    expect(classifyTargetChanges(['src/styles/global.css'])).toEqual(['site', 'app']);
    expect(classifyTargetChanges(['docs/DEVELOPER_GUIDE.md'])).toEqual([]);
    expect(classifyTargetChanges(['scripts/build-target.mjs'])).toEqual(['site', 'app', 'worker']);
  });
  it('rebuilds App inputs and intermediate output without retaining deleted files or touching other targets', () => {
    const root = fixture(); const plan = createBuildPlan(root, 'app');
    prepareBuildInputs(plan);
    const stale = ['output/build-inputs/app/public/obsolete.png', 'dist-target/app/.vercel/output/functions/obsolete.func/index.mjs', '.vercel/output/functions/obsolete.func/index.mjs'];
    const protectedFiles = ['public/uploads/marketing.png', 'dist-target/site/index.html', 'output/worker/entry.mjs', '.vercel/project.json', 'apps/app/.vercel/project.json', 'apps/app/retained-assets.json'];
    for (const file of [...stale, ...protectedFiles]) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), file);
    }
    prepareBuildInputs(plan);
    for (const file of stale) expect(existsSync(path.join(root, file)), file).toBe(false);
    for (const file of protectedFiles) expect(readFileSync(path.join(root, file), 'utf8'), file).toBe(file);
    expect(readFileSync(path.join(plan.publicDir, '_app-assets/public/uploads/logo.svg'), 'utf8')).toBe('<svg/>');
  });
  it('cleans only the Site generated output and keeps App staging and source assets', () => {
    const root = fixture(); const plan = createBuildPlan(root, 'site');
    const stale = path.join(root, 'dist-target/site/withdrawn.html');
    const app = path.join(root, '.vercel/output/static/_app-assets/current.js');
    mkdirSync(path.dirname(stale), { recursive: true }); writeFileSync(stale, 'old');
    mkdirSync(path.dirname(app), { recursive: true }); writeFileSync(app, 'app');
    prepareBuildInputs(plan);
    expect(existsSync(stale)).toBe(false); expect(readFileSync(app, 'utf8')).toBe('app');
    expect(readFileSync(path.join(root, 'public/uploads/marketing.png'), 'utf8')).toBe('marketing');
  });
  it('rejects redirected generated directories before deleting protected data', () => {
    const root = fixture(); const outside = fixture(); const plan = createBuildPlan(root, 'app');
    const sentinel = path.join(outside, 'keep.txt'); writeFileSync(sentinel, 'protected');
    mkdirSync(path.dirname(plan.publicDir), { recursive: true }); symlinkSync(outside, plan.publicDir, 'junction');
    expect(() => prepareBuildInputs(plan)).toThrow('Generated directory');
    expect(readFileSync(sentinel, 'utf8')).toBe('protected');
  });
  it('fails closed if artifacts contain routes belonging to the other target', () => {
    const root = fixture(); mkdirSync(path.join(root, 'dist-target/site/api'), { recursive: true }); writeFileSync(path.join(root, 'dist-target/site/api/index.html'), 'API');
    expect(() => validateBuildArtifact(root, 'site')).toThrow('site artifact');
    const out = path.join(root, 'dist-target/app/.vercel/output'); mkdirSync(out, { recursive: true }); writeFileSync(path.join(out, 'config.json'), '{}');
    mkdirSync(path.join(root, 'output/build-target-reports'), { recursive: true }); writeFileSync(path.join(root, 'output/build-target-reports/app.json'), JSON.stringify({ routes: [{ pattern: '/blog' }] }));
    expect(() => validateBuildArtifact(root, 'app')).toThrow('app route');
  });
  it('removes obsolete deployment HTML without overwriting the other target artifact', () => {
    const root = fixture(); const source = path.join(root, 'dist-target/site'); const destination = path.join(root, 'apps/site/dist');
    mkdirSync(source, { recursive: true }); mkdirSync(destination, { recursive: true });
    writeFileSync(path.join(source, 'index.html'), 'new site'); writeFileSync(path.join(destination, 'unpublished.html'), 'old');
    const app = path.join(root, 'dist-target/app'); mkdirSync(app, { recursive: true }); writeFileSync(path.join(app, 'sentinel'), 'app');
    stageDeploymentArtifact(root, 'site');
    expect(existsSync(path.join(destination, 'unpublished.html'))).toBe(false); expect(readFileSync(path.join(app, 'sentinel'), 'utf8')).toBe('app');
  });
  it('stages the complete App output including retained public assets while preserving its project binding', () => {
    const root = fixture(); const output = path.join(root, 'dist-target/app/.vercel/output');
    const files = { 'config.json': '{"version":3}', 'functions/api.func/index.mjs': 'export {};', 'static/_app-assets/retained.js': 'retained' };
    for (const [file, value] of Object.entries(files)) { mkdirSync(path.dirname(path.join(output, file)), { recursive: true }); writeFileSync(path.join(output, file), value); }
    const binding = path.join(root, 'apps/app/.vercel/project.json'); mkdirSync(path.dirname(binding), { recursive: true }); writeFileSync(binding, 'binding');
    stageDeploymentArtifact(root, 'app');
    for (const [file, value] of Object.entries(files)) expect(readFileSync(path.join(root, 'apps/app/.vercel/output', file), 'utf8')).toBe(value);
    expect(readFileSync(binding, 'utf8')).toBe('binding');
  });
  it('accepts only a complete Worker upload context and rejects extra private files', () => {
    const root = fixture(); const output = path.join(root, 'dist-target/worker');
    const files = { '.dockerignore': '*', '.gcloudignore': '*', Dockerfile: 'FROM node:24.22.1-bookworm-slim', 'package.json': '{}', 'package-lock.json': '{}', 'output/worker/entry.mjs': 'export {};', 'output/worker/build-manifest.json': JSON.stringify({ version: 1, runtime: 'node24', entry: 'entry.mjs', format: 'esm', packages: 'external', inputs: ['apps/worker/entry.ts'] }) };
    for (const [file, value] of Object.entries(files)) { mkdirSync(path.dirname(path.join(output, file)), { recursive: true }); writeFileSync(path.join(output, file), value); }
    expect(() => validateBuildArtifact(root, 'worker')).not.toThrow();
    writeFileSync(path.join(output, '.env.local'), 'not-a-real-secret');
    expect(() => validateBuildArtifact(root, 'worker')).toThrow('worker artifact');
    rmSync(path.join(output, '.env.local')); rmSync(path.join(output, 'output/worker/entry.mjs'));
    expect(() => validateBuildArtifact(root, 'worker')).toThrow('worker artifact');
  });
});

describe('same-origin gateway configuration', () => {
  it('routes only original public Astro assets to the immutable legacy deployment before SEO', () => {
    const result = renderAppSiteProxy({ version: 3, routes: [{ handle: 'filesystem' }, { src: '^/.*$', dest: '_render', status: 404 }] }, { siteOrigin: 'https://site.example.test', publicOrigin: 'https://www.example.test', appOrigins: ['https://current-app.example.test'], legacyAssetOrigin: 'https://legacy-snapshot.example.test' });
    const legacy = result.routes[0]; expect(legacy.dest).toBe('https://legacy-snapshot.example.test/_astro/$1'); expect(legacy.methods).toEqual(['GET', 'HEAD']); expect(legacy.status).toBeUndefined();
    for (const pathname of ['/_astro/AuthControls.ABC123.js', '/_astro/parts/app.def.css']) expect(new RegExp(legacy.src!).test(pathname)).toBe(true);
    for (const pathname of ['/', '/blog/post', '/api/v1/jobs', '/app/image', '/auth/popup', '/_app-assets/a.js', '/_site-assets/a.js', '/_astro', '/_astro-other/a.js', '/_astro/../api/jobs', '/_astro/a/../../api/jobs', '/_astro/%2e%2e/api/jobs']) expect(new RegExp(legacy.src!).test(pathname)).toBe(false);
    expect(legacy.transforms).toContainEqual({ type: 'request.headers', op: 'delete', target: { key: 'cookie' } });
    expect(legacy.transforms).toContainEqual({ type: 'request.headers', op: 'delete', target: { key: 'authorization' } });
    expect(legacy.transforms).toContainEqual({ type: 'response.headers', op: 'delete', target: { key: 'set-cookie' } });
    expect(result.routes[1].dest).toBe('https://site.example.test/$1');
    expect(renderAppSiteProxy(result, { siteOrigin: 'https://site.example.test', publicOrigin: 'https://www.example.test', legacyAssetOrigin: 'https://legacy-snapshot.example.test' }).routes).toEqual(result.routes);
  });
  it('rejects legacy origins pointing to current public, App or Site sources', () => {
    for (const legacyAssetOrigin of ['https://www.example.test', 'https://current-app.example.test', 'https://site.example.test', 'http://legacy.example.test', '${LEGACY_ASSET_ORIGIN}']) expect(() => renderAppSiteProxy({ version: 3, routes: [] }, { siteOrigin: 'https://site.example.test', publicOrigin: 'https://www.example.test', appOrigins: ['https://current-app.example.test'], legacyAssetOrigin })).toThrow();
  });
  it('reads legacy asset configuration into the generated literal routing config', () => {
    const root = fixture(); const directory = path.join(root, '.vercel/output'); mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ version: 3, routes: [] }));
    configureAppSiteProxy(root, { APP_SITE_ORIGIN: 'https://site.example.test', LEGACY_ASSET_ORIGIN: 'https://legacy-snapshot.example.test', VERCEL_URL: 'new-app.example.test' });
    const config = JSON.parse(readFileSync(path.join(directory, 'config.json'), 'utf8')); expect(config.routes[0].dest).toBe('https://legacy-snapshot.example.test/_astro/$1');
    expect(() => configureAppSiteProxy(root, { APP_SITE_ORIGIN: 'https://site.example.test', LEGACY_ASSET_ORIGIN: 'https://new-app.example.test', VERCEL_URL: 'new-app.example.test' })).toThrow();
  });
  it('adds the SEO proxy before generated catch-alls while keeping App functions and assets local', () => {
    const original = { version: 3, routes: [{ handle: 'filesystem' }, { src: '^/api/v1/(.*)$', dest: '_render' }, { src: '^/app/(.*)$', dest: '_render' }, { src: '^/.*$', dest: '_render', status: 404 }] };
    const result = renderAppSiteProxy(original, { siteOrigin: 'https://site.example.test', publicOrigin: 'https://www.example.test', appOrigins: ['https://app.example.test'] });
    expect(original.routes).toHaveLength(4); expect(result.routes.slice(1)).toEqual(original.routes);
    const proxy = result.routes[0]; expect(proxy.dest).toBe('https://site.example.test/$1'); expect(proxy.status).toBeUndefined();
    expect(renderAppSiteProxy(result, { siteOrigin: 'https://site.example.test', publicOrigin: 'https://www.example.test' }).routes).toEqual(result.routes);
    for (const pathname of ['/', '/blog/post', '/_site-assets/site.js', '/uploads/content.webp', '/missing-page']) expect(new RegExp(proxy.src!).test(pathname)).toBe(true);
    for (const pathname of ['/api', '/api/v1/jobs', '/app/image', '/auth/popup', '/auth/unknown', '/_app-assets/app.js', '/_server-islands/x', '/_image', '/_render']) expect(new RegExp(proxy.src!).test(pathname)).toBe(false);
    expect(proxy.transforms).toContainEqual({ type: 'request.headers', op: 'delete', target: { key: 'cookie' } });
    expect(proxy.transforms).toContainEqual({ type: 'request.headers', op: 'delete', target: { key: 'authorization' } });
    expect(proxy.transforms).toContainEqual({ type: 'response.headers', op: 'delete', target: { key: 'set-cookie' } });
  });
  it('rejects SEO proxy loops, credential-bearing URLs and placeholder origins', () => {
    for (const siteOrigin of ['https://www.example.test', 'https://app.example.test', 'http://site.example.test', '${SITE_ORIGIN}', 'https://user:secret@site.example.test']) expect(() => renderAppSiteProxy({ version: 3, routes: [] }, { siteOrigin, publicOrigin: 'https://www.example.test', appOrigins: ['https://app.example.test'] })).toThrow();
  });
  it('writes a literal proxy into generated App Build Output only when explicitly configured', () => {
    const root = fixture(); const directory = path.join(root, '.vercel/output'); mkdirSync(directory, { recursive: true });
    const config = { version: 3, routes: [{ src: '^/app$', dest: '_render' }] }; writeFileSync(path.join(directory, 'config.json'), JSON.stringify(config));
    expect(configureAppSiteProxy(root, {})).toBe(false); expect(JSON.parse(readFileSync(path.join(directory, 'config.json'), 'utf8'))).toEqual(config);
    configureAppSiteProxy(root, { APP_SITE_ORIGIN: 'https://site.example.test', VERCEL_PROJECT_PRODUCTION_URL: 'original-app.vercel.app' });
    expect(JSON.parse(readFileSync(path.join(directory, 'config.json'), 'utf8')).routes[0].dest).toBe('https://site.example.test/$1');
    expect(() => configureAppSiteProxy(root, { APP_SITE_ORIGIN: 'https://original-app.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'original-app.vercel.app' })).toThrow();
  });
  it('does not apply App noindex headers to SEO proxy responses', () => {
    const config = JSON.parse(readFileSync(new URL('../../../apps/app/vercel.json', import.meta.url), 'utf8'));
    expect(config.headers.filter((rule: { source: string }) => rule.source === '/(.*)').flatMap((rule: { headers: { key: string }[] }) => rule.headers).some((header: { key: string }) => header.key.toLowerCase() === 'x-robots-tag')).toBe(false);
    const gateway = JSON.parse(readFileSync(new URL('../../../apps/gateway/vercel.json', import.meta.url), 'utf8')); expect(JSON.stringify(gateway)).not.toContain('${');
  });
  it('preserves paths and 404s while isolating private identity and caches', () => {
    const config = renderGatewayConfig({ siteOrigin: 'https://site.example.test', appOrigin: 'https://app.example.test', publicOrigin: 'https://www.example.test' });
    const seo = config.routes.at(-1)!; expect(seo.dest).toBe('https://site.example.test/$1');
    const app = config.routes.find((r) => r.dest?.startsWith('https://app.example.test')); expect(app?.src).toContain('app'); expect(app?.src).toContain('api'); expect(app?.src).toContain('_app-assets');
    expect(seo.transforms).toContainEqual({ type: 'request.headers', op: 'delete', target: { key: 'cookie' } });
    expect(seo.transforms).toContainEqual({ type: 'response.headers', op: 'delete', target: { key: 'set-cookie' } });
    expect(config.routes.some((r) => r.headers?.['Cache-Control'] === 'private, no-store')).toBe(true); expect(JSON.stringify(config)).not.toContain('"dest":"/"');
  });
  it('rejects unsafe upstreams or rewrites back to the public gateway', () => {
    expect(() => renderGatewayConfig({ siteOrigin: 'http://site.test', appOrigin: 'https://app.test', publicOrigin: 'https://www.test' })).toThrow();
    expect(() => renderGatewayConfig({ siteOrigin: 'https://www.test', appOrigin: 'https://app.test', publicOrigin: 'https://www.test' })).toThrow();
  });
  it('preserves required verify and adds a credential-free target packaging workflow', () => {
    const root = new URL('../../../', import.meta.url);
    expect(readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8')).toContain('npm run verify');
    const targets = readFileSync(new URL('.github/workflows/build-targets.yml', root), 'utf8'); expect(targets).toContain('matrix.target'); expect(targets).not.toContain('secrets.VERCEL_TOKEN');
  });
  it('preserves existing SEO redirects and security headers in independent deployment manifests', () => {
    const root = new URL('../../../', import.meta.url);
    const original = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'));
    const site = JSON.parse(readFileSync(new URL('apps/site/vercel.json', root), 'utf8'));
    const app = JSON.parse(readFileSync(new URL('apps/app/vercel.json', root), 'utf8'));
    expect(site.redirects).toEqual(original.redirects); expect(site.headers).toEqual(original.headers);
    expect(app.headers).toEqual(expect.arrayContaining(original.headers));
  });
});
