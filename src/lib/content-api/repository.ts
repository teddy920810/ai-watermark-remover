export interface ContentSnapshot { revision: string; files: Map<string, Buffer> }
export interface PullRequest { number: number; url: string; state: string; merged: boolean; head: string; branch?: string; mergeRevision?: string }
export interface ContentCheck { name: string; success: boolean; appId: number }
export interface ContentRepository {
  snapshot(ref: string): Promise<ContentSnapshot>;
  readAsset?(path: string, revision: string): Promise<Buffer>;
  createBranch(branch: string, revision: string): Promise<void>;
  commit(branch: string, revision: string, updates: Map<string, Buffer>): Promise<string>;
  openPull(branch: string, title: string): Promise<PullRequest>;
  getPull(number: number): Promise<PullRequest>;
  comment(number: number, body: string): Promise<string>;
  verifyApproval(number: number, reference: string, digest: string): Promise<boolean>;
  ready(number: number): Promise<void>;
  checks(revision: string): Promise<ContentCheck[]>;
  changedFiles(number: number): Promise<string[]>;
  merge(number: number, revision: string): Promise<string>;
}
