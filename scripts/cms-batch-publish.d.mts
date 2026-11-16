export const editorBranch: string;
export function validateRequest(payload: unknown): string;
type Git = (...args: string[]) => string;
export function planBatch(options: { git: Git; source: string; main: string }): { tree: string; files: string[]; source: string; main: string };
export function requiredChecksReady(checks: { name: string; app: { id: number }; head_sha: string; status: string; conclusion: string }[], sha: string): boolean;
export function assertBatchHead(options: { git: Git; source: string; main: string; head: string }): void;
export function publishBatch(options: { payload: unknown; token: string; actor: string; runId: string; git: Git; request?: typeof fetch; pause?: (ms: number) => Promise<void>; report?: (text: string) => Promise<void> }): Promise<{ state: string; merged?: string; pull?: number }>;
