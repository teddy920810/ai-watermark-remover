export function verificationCommands(mode: string, ci?: boolean): string[];
export function runVerification(mode: string, options?: { ci?: boolean; npmPath?: string; execute?: typeof import('node:child_process').spawnSync; env?: NodeJS.ProcessEnv }): void;
