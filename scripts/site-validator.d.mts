export interface SiteValidationInput {
  envExample: string;
  canonicalOrigin: string;
  contentDocuments: Array<{ path: string; value: unknown }>;
  landingSlugs: string[];
  blogSlugs: string[];
  availableAssets: string[];
}

export function collectSiteValidationIssues(input: SiteValidationInput): string[];
