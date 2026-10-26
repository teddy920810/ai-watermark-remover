import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { buildWorker, prepareWorkerContext, workerContextFiles } from './build-worker.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const slash = (value) => value.replaceAll('\\', '/');
const isAppPath = (value) => /^\/(?:api(?:\/|$)|app(?:\/|$)|auth\/popup$)/.test(value);
const buildTargets = ['site', 'app', 'worker'];

function resetGeneratedDirectory(root, relative) {
  const allowed = ['dist-target/site', 'dist-target/app', 'dist-target/worker', '.vercel/output', 'apps/site/dist', 'apps/app/.vercel/output', 'output/build-inputs/site/env', 'output/build-inputs/app/env', 'output/build-inputs/app/public'];
  if (!allowed.includes(relative)) throw new Error('Generated directory is not an approved build output');
  const canonicalRoot = realpathSync(root); const destination = path.join(canonicalRoot, relative);
  // Never follow a junction/symlink into a different directory, even inside this workspace.
  for (let current = destination; current !== canonicalRoot; current = path.dirname(current)) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Generated directory must not contain symlink ancestors');
  }
  if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  return destination;
}

export function collectTargetRoutes(root, target) {
  if (!['site', 'app'].includes(target)) throw new Error('Build target must be site or app');
  const directory = path.join(root, 'src/pages'); const routes = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(filename); continue; }
      if (!/\.(astro|md|mdx|ts|js)$/.test(entry.name) || /\.(?:test|spec|d)\.[cm]?[jt]s$/.test(entry.name)) continue;
      const relative = slash(path.relative(directory, filename)).replace(/\.(astro|md|mdx|ts|js)$/, '').replace(/(?:^|\/)index$/, '');
      const pattern = `/${relative}`.replace(/\/$/, '') || '/';
      if ((target === 'app') === isAppPath(pattern)) routes.push({ pattern, entrypoint: filename });
    }
  }
  if (existsSync(directory)) walk(directory);
  return routes;
}

export function createBuildPlan(root, target) {
  if (!['site', 'app'].includes(target)) throw new Error('Build target must be site or app');
  return { target, root, routes: collectTargetRoutes(root, target), output: target === 'site' ? 'static' : 'server', adapter: target === 'app',
    srcDir: path.join(root, 'apps', target, 'src'), outDir: path.join(root, 'dist-target', target),
    publicDir: target === 'site' ? path.join(root, 'public') : path.join(root, 'output/build-inputs/app/public'),
    envDir: path.join(root, 'output/build-inputs', target, 'env'),
    configFile: target === 'app' ? path.join(root, 'apps/app/astro.config.mjs') : path.join(root, 'astro.config.mjs'),
    assets: target === 'site' ? '_site-assets' : '_app-assets',
    reportFile: path.join(root, 'output/build-target-reports', `${target}.json`),
    requiredSecrets: [], runtimeSecrets: target === 'site' ? [] : ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
  };
}

export function prepareBuildInputs(plan) {
  if (!['site', 'app'].includes(plan.target)) throw new Error('Build target must be site or app');
  resetGeneratedDirectory(plan.root, `dist-target/${plan.target}`);
  resetGeneratedDirectory(plan.root, `output/build-inputs/${plan.target}/env`);
  if (plan.target !== 'app') return;
  resetGeneratedDirectory(plan.root, 'output/build-inputs/app/public');
  // Astro's Vercel adapter stages the complete Build Output here; project.json stays intact.
  // https://vercel.com/docs/build-output-api
  resetGeneratedDirectory(plan.root, '.vercel/output');
  const settings = JSON.parse(readFileSync(path.join(plan.root, 'src/content/settings/site.json'), 'utf8'));
  const styleAssets = [];
  for (const css of ['global.css', 'workspace.css']) {
    const filename = path.join(plan.root, 'src/styles', css);
    if (existsSync(filename)) for (const match of readFileSync(filename, 'utf8').matchAll(/url\(["']?(\/(?:uploads|images)\/[^\s)'";]+)["']?\)/g)) styleAssets.push(match[1]);
  }
  for (const source of new Set([settings.logo, settings.favicon, '/images/image-placeholder.svg', ...styleAssets])) {
    if (typeof source !== 'string' || !source.startsWith('/') || source.startsWith('//') || source.includes('..')) continue;
    const filename = path.join(plan.root, 'public', source.slice(1));
    if (!existsSync(filename)) continue;
    const destination = path.join(plan.publicDir, '_app-assets/public', source.slice(1));
    mkdirSync(path.dirname(destination), { recursive: true }); cpSync(filename, destination);
  }
}

/** Only documented srcDir/injectRoute hooks select routes before module discovery.
 * https://docs.astro.build/en/reference/integrations-reference/#injectroute-option
 * astro:routes:resolved is observational and cannot remove real routes.
 */
export function targetIntegration(plan) {
  const modules = new Set();
  const assertModule = (id) => {
    const file = slash(id).split('?')[0];
    if (plan.target === 'site' && (/\/src\/pages\/(?:api|app|auth)\//.test(file)
      || /\/src\/lib\/(?:auth\.ts|services\.ts|config\/server-env\.ts|runtime\/|processing\/|providers\/|benefits\/postgres-)/.test(file)
      || /\/node_modules\/(?:@aws-sdk\/|pg\/)/.test(file))) throw new Error(`site build imported a server dependency: ${path.basename(file)}`);
  };
  return { name: `watermark-${plan.target}-routes`, assertModule,
    vitePlugin: { name: `watermark-${plan.target}-module-boundary`, enforce: 'pre', transform(code, id) {
      assertModule(id); modules.add(slash(path.relative(plan.root, id)).split('?')[0]);
      if (plan.target === 'app' && /\/src\/styles\/.*\.css(?:\?|$)/.test(slash(id))) return { code: code.replace(/url\((["']?)(\/(?:uploads|images)\/[^\s)'";]+)\1\)/g, 'url($1/_app-assets/public$2$1)'), map: null };
    } },
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        for (const route of plan.routes) injectRoute({ pattern: route.pattern, entrypoint: pathToFileURL(route.entrypoint), ...(plan.target === 'site' ? { prerender: true } : {}) });
      },
      'astro:routes:resolved': ({ routes }) => {
        const ownRoutes = routes.filter((route) => plan.routes.some((own) => own.pattern === route.pattern));
        if (plan.target === 'site' && ownRoutes.some((route) => isAppPath(route.pattern))) throw new Error('site route boundary was violated');
        if (plan.target === 'app' && ownRoutes.some((route) => !isAppPath(route.pattern))) throw new Error('app route boundary was violated');
      },
      'astro:build:done': () => {
        mkdirSync(path.dirname(plan.reportFile), { recursive: true });
        writeFileSync(plan.reportFile, JSON.stringify({ target: plan.target, routes: plan.routes.map((route) => ({ pattern: route.pattern, entrypoint: slash(path.relative(plan.root, route.entrypoint)) })), modules: [...modules].sort(), assets: plan.assets }, null, 2));
      },
    },
  };
}

export function classifyTargetChanges(files) {
  const targets = new Set();
  for (const raw of files) {
    const file = slash(raw);
    if (/^(?:docs\/|README\.md$|AGENTS\.md$|scripts\/processing-acceptance\.mjs$|scripts\/lib\/acceptance-budget\.mjs$)/.test(file)) continue;
    if (/^(?:apps\/worker\/|scripts\/build-worker)/.test(file)) { targets.add('worker'); continue; }
    if (/^(?:package(?:-lock)?\.json$|scripts\/build-target|\.github\/workflows\/build-targets)/.test(file)) { for (const target of buildTargets) targets.add(target); continue; }
    if (file === 'scripts/retain-app-assets.mjs') { targets.add('app'); continue; }
    if (/^(?:src\/styles\/workspace\.css$|src\/layouts\/App)/.test(file)) { targets.add('app'); continue; }
    if (/^(?:astro\.config\.mjs$|src\/styles\/|src\/components\/auth\/|src\/lib\/auth-client|src\/content\/settings\/site\.json$|public\/uploads\/watermarkgemini-logo\.svg$)/.test(file)) { targets.add('site'); targets.add('app'); continue; }
    if (/^(?:apps\/gateway\/)/.test(file)) continue;
    if (/^(?:src\/lib\/(?:runtime\/|processing\/|providers\/|media\/|benefits\/|jobs\/|r2\/|users\/|config\/)|db\/)/.test(file)) { targets.add('app'); targets.add('worker'); continue; }
    if (/^(?:apps\/app\/|src\/pages\/(?:app|api|auth)\/|src\/components\/workspace\/|src\/lib\/(?:api\/|auth\.ts))/.test(file)) { targets.add('app'); continue; }
    if (/^(?:apps\/site\/|src\/content|src\/pages\/|src\/components\/|src\/layouts\/|src\/lib\/content\/|public\/|\.pages\.yml$|scripts\/(?:cms-|optimize-images|verify-responsive))/.test(file)) { targets.add('site'); continue; }
    if (/^(?:src\/|scripts\/|\.github\/|tsconfig|vite|vercel\.json)/.test(file)) for (const target of buildTargets) targets.add(target);
  }
  return buildTargets.filter((target) => targets.has(target));
}

function origin(value) {
  if (typeof value !== 'string' || value.includes('$')) throw new Error('Gateway origins must be literal HTTPS origins');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Gateway upstream must be a plain HTTPS origin');
  return url.origin;
}
const seoTransforms = () => ['cookie', 'authorization'].map((key) => ({ type: 'request.headers', op: 'delete', target: { key } })).concat([{ type: 'response.headers', op: 'delete', target: { key: 'set-cookie' } }]);
const legacyAstroSource = '^/_astro/((?!\\.{1,2}(?:/|$))(?!.*\\/\\.{1,2}(?:/|$))[A-Za-z0-9_@+./-]+)$';

/** Retain the original application project and its secrets/domain, but proxy
 * public pages to the independently deployed static site before Astro's 404.
 * Build Output routes use the same Route type as static project configuration:
 * https://vercel.com/docs/build-output-api/configuration#routes
 */
export function renderAppSiteProxy(config, { siteOrigin, publicOrigin, appOrigins = /** @type {string[]} */ ([]), legacyAssetOrigin = /** @type {string | undefined} */ (undefined) }) {
  const site = origin(siteOrigin); const gateway = origin(publicOrigin);
  const applicationOrigins = [gateway, ...appOrigins.map(origin)];
  if (applicationOrigins.includes(site)) throw new Error('SEO proxy must not point back to an application origin');
  if (config.version !== 3 || !Array.isArray(config.routes)) throw new Error('App Build Output routes are unavailable');
  const legacy = legacyAssetOrigin ? origin(legacyAssetOrigin) : undefined;
  if (legacy && [...applicationOrigins, site].includes(legacy)) throw new Error('Legacy assets must use an immutable origin distinct from public, App and Site sources');
  const proxy = { src: '^/((?!(?:api|app|auth|_app-assets|_server-islands|_image|_render)(?:/|$)).*)$', dest: `${site}/$1`, transforms: seoTransforms() };
  const assets = legacy ? [{ src: legacyAstroSource, dest: `${legacy}/_astro/$1`, methods: ['GET', 'HEAD'], transforms: seoTransforms() }] : [];
  return { ...config, routes: [...assets, proxy, ...config.routes.filter((route) => route.src !== proxy.src && route.src !== legacyAstroSource)] };
}
export function configureAppSiteProxy(root, source = process.env) {
  if (!source.APP_SITE_ORIGIN) {
    if (source.LEGACY_ASSET_ORIGIN) throw new Error('APP_SITE_ORIGIN is required before configuring legacy assets');
    return false;
  }
  const settings = JSON.parse(readFileSync(path.join(root, 'src/content/settings/site.json'), 'utf8'));
  const appOrigins = [source.APP_ORIGIN, source.VERCEL_URL, source.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map((value) => value.startsWith('https://') ? value : `https://${value}`);
  const filename = path.join(root, '.vercel/output/config.json');
  const config = renderAppSiteProxy(JSON.parse(readFileSync(filename, 'utf8')), { siteOrigin: source.APP_SITE_ORIGIN, publicOrigin: settings.canonicalOrigin, appOrigins, legacyAssetOrigin: source.LEGACY_ASSET_ORIGIN });
  writeFileSync(filename, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}
export function renderGatewayConfig({ siteOrigin, appOrigin, publicOrigin }) {
  const site = origin(siteOrigin); const app = origin(appOrigin); const gateway = origin(publicOrigin);
  if (site === app || site === gateway || app === gateway) throw new Error('Gateway origins must be distinct');
  const remove = (type, key) => ({ type, op: 'delete', target: { key } });
  const inherited = JSON.parse(readFileSync(path.join(projectRoot, 'vercel.json'), 'utf8'));
  const commonHeaders = Object.fromEntries((inherited.headers.find((rule) => rule.source === '/(.*)')?.headers ?? []).map(({ key, value }) => [key, value]));
  return { $schema: 'https://openapi.vercel.sh/vercel.json', framework: null, trailingSlash: false, routes: [
    { src: '/(.*)', headers: commonHeaders, continue: true },
    { src: '^/(?:api|app)(?:/.*)?$|^/auth/popup$', headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }, continue: true },
    { src: '^/_(?:app|site)-assets/.*$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/((?:api|app)(?:/.*)?|auth/popup|_app-assets/.*)$', dest: `${app}/$1`, transforms: [remove('request.headers', 'x-forwarded-host'), remove('request.headers', 'x-forwarded-proto'), { type: 'request.headers', op: 'set', target: { key: 'x-forwarded-host' }, args: new URL(gateway).host }, { type: 'request.headers', op: 'set', target: { key: 'x-forwarded-proto' }, args: 'https' }] },
    // Static route transforms are the documented API, not middleware internals:
    // https://vercel.com/docs/project-configuration/vercel-json#transform-examples
    { src: '^/(.*)$', dest: `${site}/$1`, transforms: seoTransforms() },
  ] };
}

export function validateBuildArtifact(root, target) {
  if (!buildTargets.includes(target)) throw new Error('Unknown build target');
  const output = path.join(root, 'dist-target', target);
  if (!existsSync(output)) throw new Error(`${target} artifact is missing`);
  if (target === 'site') {
    for (const name of ['api', 'app', 'auth', 'server', '.vercel', 'functions']) if (existsSync(path.join(output, name))) throw new Error(`site artifact contains forbidden ${name}`);
    if (!existsSync(path.join(output, 'index.html'))) throw new Error('site artifact has no homepage');
  } else if (target === 'app') {
    if (!existsSync(path.join(output, '.vercel/output/config.json'))) throw new Error('app artifact has no Vercel Build Output');
    const report = JSON.parse(readFileSync(path.join(root, 'output/build-target-reports/app.json'), 'utf8'));
    for (const route of report.routes) if (!isAppPath(route.pattern)) throw new Error(`app route contains marketing: ${route.pattern}`);
  } else {
    const files = [];
    function walk(directory, prefix = '') {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const relative = `${prefix}${entry.name}`;
        if (entry.isDirectory()) walk(path.join(directory, entry.name), `${relative}/`);
        else if (entry.isFile()) files.push(relative);
        else throw new Error('worker artifact contains a non-file input');
      }
    }
    walk(output);
    if (files.sort().join('\n') !== [...workerContextFiles].sort().join('\n')) throw new Error('worker artifact must contain only the complete upload allowlist');
    const manifest = JSON.parse(readFileSync(path.join(output, 'output/worker/build-manifest.json'), 'utf8'));
    if (manifest.runtime !== 'node24' || manifest.entry !== 'entry.mjs' || manifest.format !== 'esm' || manifest.packages !== 'external' || !manifest.inputs?.includes('apps/worker/entry.ts')) throw new Error('worker artifact has an invalid bundle manifest');
  }
}

function changedFiles(base, head = 'HEAD') {
  if (!base || /^0+$/.test(base)) return null;
  const result = spawnSync('git', ['diff', '--name-only', base, head, '--'], { cwd: projectRoot, encoding: 'utf8', shell: false });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/).filter(Boolean) : null;
}
function runNode(filename, args, env) {
  const result = spawnSync(process.execPath, [filename, ...args], { cwd: projectRoot, env, stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error(`Build step failed: ${path.basename(filename)}`);
}
export function stageDeploymentArtifact(root, target) {
  if (!['site', 'app'].includes(target)) throw new Error('Unknown deployment target');
  const source = target === 'site' ? path.join(root, 'dist-target/site') : path.join(root, 'dist-target/app/.vercel/output');
  const destination = resetGeneratedDirectory(root, target === 'site' ? 'apps/site/dist' : 'apps/app/.vercel/output');
  cpSync(source, destination, { recursive: true });
}
export async function buildTarget(target) {
  if (target === 'worker') {
    await buildWorker({ cwd: projectRoot });
    const context = await prepareWorkerContext({ cwd: projectRoot });
    cpSync(context.directory, resetGeneratedDirectory(projectRoot, 'dist-target/worker'), { recursive: true });
    validateBuildArtifact(projectRoot, target);
    process.stdout.write('Validated worker artifact: dist-target/worker\n');
    return;
  }
  const plan = createBuildPlan(projectRoot, target); prepareBuildInputs(plan);
  const env = { ...process.env, BUILD_TARGET: target };
  for (const key of Object.keys(env)) if (/^(?:DATABASE_URL$|R2_|DEWATERMARK_|REPLICATE_|GOOGLE_|GCP_|CLOUD_RUN_|VERCEL_OIDC_TOKEN$|BETTER_AUTH_|PROCESSING_|WORKER_)/.test(key)) delete env[key];
  if (target === 'site') {
    runNode(path.join(projectRoot, 'scripts/optimize-images.mjs'), [], env);
  }
  const astroPackage = JSON.parse(readFileSync(path.join(projectRoot, 'node_modules/astro/package.json'), 'utf8'));
  const astroBin = typeof astroPackage.bin === 'string' ? astroPackage.bin : astroPackage.bin.astro;
  runNode(path.join(projectRoot, 'node_modules/astro', astroBin), ['build', '--config', slash(path.relative(projectRoot, plan.configFile))], env);
  if (target === 'app') {
    const source = path.join(projectRoot, '.vercel/output');
    if (!existsSync(path.join(source, 'config.json'))) throw new Error('Vercel adapter did not produce app output');
    runNode(path.join(projectRoot, 'scripts/retain-app-assets.mjs'), [], env);
    configureAppSiteProxy(projectRoot, process.env);
    cpSync(source, path.join(plan.outDir, '.vercel/output'), { recursive: true });
  }
  validateBuildArtifact(projectRoot, target);
  stageDeploymentArtifact(projectRoot, target);
  process.stdout.write(`Validated ${target} artifact: dist-target/${target}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (buildTargets.includes(command)) await buildTarget(command);
    else if (command === 'changes') process.stdout.write(JSON.stringify(classifyTargetChanges(changedFiles(args[0], args[1]) ?? ['package.json'])));
    else if (command === 'ignore') {
      if (!['site', 'app', 'gateway'].includes(args[0])) throw new Error('Unknown deployment target');
      const files = changedFiles(process.env.VERCEL_GIT_PREVIOUS_SHA, process.env.VERCEL_GIT_COMMIT_SHA);
      process.exitCode = (args[0] === 'gateway' ? !files || files.some((file) => /^(?:apps\/gateway\/|scripts\/build-target)/.test(file)) : classifyTargetChanges(files ?? ['package.json']).includes(args[0])) ? 1 : 0;
    }
    else if (command === 'gateway') {
      if (!process.env.SITE_ORIGIN || !process.env.APP_ORIGIN) throw new Error('Set SITE_ORIGIN and APP_ORIGIN before rendering a literal gateway configuration');
      const settings = JSON.parse(readFileSync(path.join(projectRoot, 'src/content/settings/site.json'), 'utf8'));
      const config = renderGatewayConfig({ siteOrigin: process.env.SITE_ORIGIN, appOrigin: process.env.APP_ORIGIN, publicOrigin: settings.canonicalOrigin });
      process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    } else throw new Error('Usage: build-target.mjs site|app|worker|changes [base head]|ignore target|gateway');
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
