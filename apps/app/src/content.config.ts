import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { siteSettingsSchema } from '../../../src/lib/content/site-settings';

// App does not load Blog/landing/CMS publication records. Only shared identity is needed.
const siteSettings = defineCollection({
  loader: file('./src/content/settings/site.json', {
    parser: (text) => {
      const site = JSON.parse(text);
      const asset = (value: string) => value.startsWith('/') && !value.startsWith('//') ? `/_app-assets/public${value}` : value;
      return [{ ...site, id: 'site', logo: asset(site.logo), favicon: asset(site.favicon) }];
    },
  }),
  schema: siteSettingsSchema,
});
export const collections = { siteSettings };
