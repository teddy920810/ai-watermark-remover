import { describe, expect, it } from 'vitest';
import { buildPublications } from './publication';
import { classifyTargetChanges, targetIntegration } from '../../../scripts/build-target.mjs';
describe('content publication evidence', () => {
  it('publishes only approved digests without exposing operator metadata or secrets', () => {
    expect(buildPublications([{ id: 'a'.repeat(24), approval: { digest: 'b'.repeat(64), actor: 'private-actor', note: 'private note' } }, { id: 'c'.repeat(24) }])).toEqual({ publications: [{ id: 'a'.repeat(24), digest: 'b'.repeat(64) }] });
  });
  it('rebuilds the actual consumers when shared content contracts or publication audit change', () => {
    expect(classifyTargetChanges(['src/lib/content-api/service.ts'])).toEqual(['app']);
    expect(classifyTargetChanges(['src/lib/content/entry-schemas.ts'])).toEqual(['site', 'app']);
    expect(classifyTargetChanges(['.content-api/' + 'a'.repeat(24) + '.json'])).toEqual(['site']);
  });
  it('keeps content credentials and Git writes outside Site while allowing the public proof renderer', () => {
    const site = targetIntegration({ target: 'site' } as never);
    expect(() => site.assertModule('/repo/src/lib/content-api/server.ts')).toThrow(/server/);
    expect(() => site.assertModule('/repo/src/lib/content-api/publication.ts')).not.toThrow();
  });
});
