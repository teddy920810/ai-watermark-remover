export type VerificationMode = 'docs' | 'content' | 'ui' | 'full';
interface VerificationPlan { mode: VerificationMode; reason: string; browser: boolean; imageDisplay?: boolean }
export function classifyVerification(files: string[] | null): VerificationPlan;
export function changedFiles(base?: string, head?: string, cwd?: string): string[] | null;
export function planVerification(base?: string, head?: string, cwd?: string): VerificationPlan;
