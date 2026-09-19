export function createCmsDraft(root: string, payload: unknown, date?: string): Promise<{
  path: string;
  data: { slug: string; title: string; draft: boolean; process?: { steps: unknown[] }; [key: string]: unknown };
  body: string;
}>;
