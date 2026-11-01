import type { CmsDocument } from '../cms-publication.mjs';
export function collectPublicationIssues(records: CmsDocument[], assetExists?: (path: string) => boolean): string[];
