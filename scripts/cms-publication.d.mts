export interface CmsDocument { path: string; data: Record<string, unknown>; body?: string }
export const reservedToolSlugs: Set<string>;
export function parseCmsDocument(path: string, source: string): CmsDocument;
export function readCmsDocuments(root: string): CmsDocument[];
export function collectPublicationIssues(records: CmsDocument[], root?: string): string[];
export function assertCmsPublication(root: string): void;
