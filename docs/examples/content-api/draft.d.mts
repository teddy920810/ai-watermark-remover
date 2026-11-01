export function createDraftExample(options: {
  documentFile: string;
  tokenFile: string;
  output: string;
  imageFile?: string;
  beforeFile?: string;
  afterFile?: string;
  alignedPair?: boolean;
  origin?: string;
  fetcher?: typeof fetch;
}): Promise<{ id: string; revision: string; draft: boolean; publishable: boolean; issues: string[]; recoveryFile: string }>;
