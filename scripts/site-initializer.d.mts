export interface SiteInitConfig {
  packageName: string;
  siteName: string;
  siteUrl: string;
  locale: string;
  themeColor: string;
  logo: string;
  favicon: string;
  defaultShareImage: string;
  defaultTitle: string;
  defaultDescription: string;
  googleMeasurementId: string;
  defaultAuthor: string;
  defaultCategory: string;
}

export function parseSiteInitConfig(input: unknown): SiteInitConfig;
export function buildSiteInitializationPlan(
  config: SiteInitConfig,
  files: Record<string, string>,
): Record<string, string>;
