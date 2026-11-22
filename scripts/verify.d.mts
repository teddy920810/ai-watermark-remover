interface VerificationSelection { part?: string; imageDisplay?: boolean }
export function verificationCommands(mode: string, ci?: boolean, selection?: VerificationSelection): string[];
export function runVerification(mode: string, options?: VerificationSelection & { ci?: boolean; npmPath?: string; execute?: typeof import('node:child_process').spawnSync; env?: NodeJS.ProcessEnv }): void;
