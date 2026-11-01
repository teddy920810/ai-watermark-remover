export type VerificationMode = 'docs' | 'content' | 'ui' | 'full';
export function classifyVerification(files: string[] | null): { mode: VerificationMode; reason: string; browser: boolean };
export function verificationCommands(mode: string): string[];
export function changedFiles(base?: string, head?: string): string[] | null;
