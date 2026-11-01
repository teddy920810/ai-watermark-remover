import type { ContentEntry } from '../../src/lib/content-api/validation';
export function readContentVersions(base: string, head: string, file: string, cwd?: string): { current: ContentEntry; previous: ContentEntry | undefined };
