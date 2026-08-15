import { z } from 'zod';
import { URL } from 'node:url';

const httpsUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash;
}, 'siteUrl must be an HTTPS origin without a path, query, or hash.');

const assetPathSchema = z.string().startsWith('/');

const siteInitConfigSchema = z.object({
  packageName: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  siteName: z.string().min(1),
  siteUrl: httpsUrlSchema,
  locale: z.string().min(2),
  themeColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  logo: assetPathSchema,
  favicon: assetPathSchema,
  defaultShareImage: assetPathSchema,
  defaultTitle: z.string().min(1),
  defaultDescription: z.string().min(1).max(180),
  googleMeasurementId: z.union([z.literal(''), z.string().regex(/^G-[A-Z0-9]+$/)]),
  defaultAuthor: z.string().min(1),
  defaultCategory: z.string().min(1),
});

export function parseSiteInitConfig(input) {
  return siteInitConfigSchema.parse(input);
}

function replaceEnvValue(source, key, value) {
  const line = `${key}=${value}`;
  const expression = new RegExp(`^${key}=.*$`, 'm');
  return expression.test(source)
    ? source.replace(expression, line)
    : `${source.replace(/\s*$/, '\n')}${line}\n`;
}

function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildSiteInitializationPlan(config, files) {
  const packageJson = JSON.parse(files['package.json']);
  const site = JSON.parse(files['src/content/settings/site.json']);
  packageJson.name = config.packageName;

  Object.assign(site, {
    name: config.siteName,
    canonicalOrigin: config.siteUrl,
    locale: config.locale,
    themeColor: config.themeColor,
    logo: config.logo,
    favicon: config.favicon,
    defaultShareImage: config.defaultShareImage,
    defaultTitle: config.defaultTitle,
    defaultDescription: config.defaultDescription,
  });
  site.analytics = { ...site.analytics, googleMeasurementId: config.googleMeasurementId };
  site.contentDefaults = {
    ...site.contentDefaults,
    author: config.defaultAuthor,
    category: config.defaultCategory,
  };

  let envExample = replaceEnvValue(files['.env.example'], 'SITE_URL', config.siteUrl);
  envExample = replaceEnvValue(envExample, 'BETTER_AUTH_URL', config.siteUrl);

  return {
    'package.json': stringifyJson(packageJson),
    '.env.example': envExample,
    'src/content/settings/site.json': stringifyJson(site),
  };
}
