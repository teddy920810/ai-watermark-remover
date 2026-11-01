import process from 'node:process';
import { GitHubContentRepository } from './github-repository';
import { createContentApi } from './service';
import site from '../../content/settings/site.json';
// Read secrets only when a server request runs; schema and Site builds need none.
export function handleContentRequest(request: Request) {
  return createContentApi({ repository: new GitHubContentRepository(process.env.CONTENT_GITHUB_TOKEN ?? ''), config: {
    tokenHashes: [process.env.CONTENT_API_TOKEN_SHA256, process.env.CONTENT_API_PREVIOUS_TOKEN_SHA256].filter((value): value is string => !!value),
    actor: process.env.CONTENT_API_ACTOR ?? 'seo-operator', publicOrigin: site.canonicalOrigin,
  } })(request);
}
