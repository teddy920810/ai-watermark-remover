import { describe, expect, it, vi } from 'vitest';
import { mediaKey } from '../runtime/private-media-store';
import { buildProcessingMediaLifecycle, PROCESSING_MEDIA_PREFIXES } from '../../../scripts/lib/processing-lifecycle.mjs';
import { lifecycleCliOptions, runProcessingLifecycle } from '../../../scripts/processing-lifecycle.mjs';

const original = { Rules: [{ ID: 'retain-existing-abort-id', Status: 'Enabled', Prefix: '', AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } }] };
const configuration = { endpoint: 'https://r2.invalid', bucket: 'private-bucket', accessKeyId: 'private-access', secretAccessKey: 'private-secret' };

describe('processing media lifecycle configuration', () => {
  it('matches actual media key builders and adds only four exact media prefixes', () => {
    expect(PROCESSING_MEDIA_PREFIXES).toEqual(['processing/staging/', 'processing/inputs/', 'processing/masks/', 'processing/results/']);
    expect(mediaKey('source', 'owner', 'input', 'image/jpeg')).toMatch(/^processing\/inputs\//);
    expect(mediaKey('mask', 'owner', 'mask', 'image/png')).toMatch(/^processing\/masks\//);
    expect(mediaKey('result', 'owner', 'result', 'video/mp4')).toMatch(/^processing\/results\//);
    const plan = buildProcessingMediaLifecycle(original);
    expect(plan.addedPrefixes).toEqual(PROCESSING_MEDIA_PREFIXES);
    expect(plan.policy.Rules.slice(1)).toEqual(PROCESSING_MEDIA_PREFIXES.map((prefix: string) => ({ ID: expect.any(String), Status: 'Enabled', Filter: { Prefix: prefix }, Expiration: { Days: 1 } })));
    for (const prefix of plan.addedPrefixes) expect(['processing/jobs/', 'processing/quotes/', 'processing/attempts/', 'processing/provider-attempts/', 'processing/provider-metadata/', 'processing/artifacts/'].some(control => control.startsWith(prefix))).toBe(false);
  });
  it('preserves existing multipart and unrelated rules exactly without mutating the supplied policy', () => {
    const input = { Rules: [...original.Rules, { ID: 'old-uploads', Status: 'Enabled', Filter: { Prefix: 'uploads/' }, Expiration: { Days: 7 } }] };
    const before = structuredClone(input); const plan = buildProcessingMediaLifecycle(input);
    expect(input).toEqual(before); expect(plan.policy.Rules.slice(0, before.Rules.length)).toEqual(before.Rules);
    plan.policy.Rules[0].ID = 'changed-output-only'; expect(input).toEqual(before);
  });
  it('is idempotent and keeps already matching complete media expiration rules', () => {
    const first = buildProcessingMediaLifecycle(original); const next = buildProcessingMediaLifecycle(first.policy);
    expect(next.changed).toBe(false); expect(next.addedPrefixes).toEqual([]); expect(next.policy).toEqual(first.policy);
  });
  it('does not mistake a tag-filtered media rule for complete prefix coverage', () => {
    const plan = buildProcessingMediaLifecycle({ Rules: [{ ID: 'filtered', Status: 'Enabled', Filter: { And: { Prefix: 'processing/inputs/', Tags: [{ Key: 'kind', Value: 'special' }] } }, Expiration: { Days: 1 } }] });
    expect(plan.addedPrefixes).toContain('processing/inputs/'); expect(plan.policy.Rules[0].ID).toBe('filtered');
  });
  it('fails closed rather than accepting a broad pre-existing expiration over recovery control records', () => {
    for (const prefix of ['', 'processing/', 'processing/jobs/', 'processing/attempts/job-1/']) expect(() => buildProcessingMediaLifecycle({ Rules: [{ ID: 'broad', Status: 'Enabled', Filter: { Prefix: prefix }, Expiration: { Days: 1 } }] })).toThrow('Existing expiration reaches processing recovery records');
  });
  it('never repurposes an existing managed identifier or exceeds the vendor rule limit', () => {
    const id = buildProcessingMediaLifecycle(original).policy.Rules[1].ID;
    expect(() => buildProcessingMediaLifecycle({ Rules: [{ ID: id, Status: 'Disabled', Filter: { Prefix: 'unrelated/' } }] })).toThrow('Managed lifecycle identifier already has another meaning');
    expect(() => buildProcessingMediaLifecycle({ Rules: Array.from({ length: 1000 }, (_, index) => ({ ID: `unrelated-${index}`, Status: 'Disabled', Filter: { Prefix: 'unrelated/' } })) })).toThrow('Lifecycle rule limit would be exceeded');
  });
  it('defaults to preview and makes no mutation or backup writes', async () => {
    const send = vi.fn().mockResolvedValue(original); const backup = vi.fn();
    const result = await runProcessingLifecycle({}, { configuration, client: { send }, backup });
    expect(result.status).toBe('dry_run'); expect(result.addedPrefixes).toEqual(PROCESSING_MEDIA_PREFIXES);
    expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][0].constructor.name).toBe('GetBucketLifecycleConfigurationCommand'); expect(backup).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/private-access|private-secret|retain-existing-abort-id/);
  });
  it('backs up the read policy then writes it with media additions once and verifies the result', async () => {
    const expected = buildProcessingMediaLifecycle(original).policy; const events: string[] = [];
    const send = vi.fn(async (command) => { events.push(command.constructor.name); return command.constructor.name === 'PutBucketLifecycleConfigurationCommand' ? {} : events.length === 1 ? original : expected; });
    const backup = vi.fn(async (policy) => { events.push('backup'); expect(policy).toEqual(original); return 'output/r2-config/backup.json'; });
    const result = await runProcessingLifecycle({ apply: true }, { configuration, client: { send }, backup });
    expect(result.status).toBe('applied_verified');
    expect(events).toEqual(['GetBucketLifecycleConfigurationCommand', 'backup', 'PutBucketLifecycleConfigurationCommand', 'GetBucketLifecycleConfigurationCommand']);
    expect(send.mock.calls[1][0].input).toEqual({ Bucket: configuration.bucket, LifecycleConfiguration: expected });
    expect(send.mock.calls.filter(([command]) => command.constructor.name.startsWith('Put'))).toHaveLength(1);
  });
  it('does not repeat a configuration write when a previous apply is already present', async () => {
    const send = vi.fn().mockResolvedValue(buildProcessingMediaLifecycle(original).policy); const backup = vi.fn();
    expect((await runProcessingLifecycle({ apply: true }, { configuration, client: { send }, backup })).status).toBe('already_configured');
    expect(send).toHaveBeenCalledTimes(1); expect(backup).not.toHaveBeenCalled();
  });
  it('does not report success if read-back drops an existing multipart rule', async () => {
    const expected = buildProcessingMediaLifecycle(original).policy;
    const send = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce({}).mockResolvedValueOnce({ Rules: expected.Rules.slice(1) });
    await expect(runProcessingLifecycle({ apply: true }, { configuration, client: { send }, backup: vi.fn() })).rejects.toMatchObject({ code: 'verification_failed' });
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('fails before any update when the private backup cannot be written', async () => {
    const send = vi.fn().mockResolvedValue(original);
    await expect(runProcessingLifecycle({ apply: true }, { configuration, client: { send }, backup: vi.fn().mockRejectedValue(new Error('private path')) })).rejects.toMatchObject({ code: 'backup_failed' });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not retry an apply whose response was lost and redacts diagnostics', async () => {
    const send = vi.fn().mockResolvedValueOnce(original).mockRejectedValueOnce(new Error('private-access private-secret signed-url'));
    await expect(runProcessingLifecycle({ apply: true }, { configuration, client: { send }, backup: vi.fn() })).rejects.toMatchObject({ code: 'apply_unknown', message: 'Lifecycle update outcome is unknown; read configuration before any new apply.' });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('refuses a read permission failure without any write', async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('private diagnostic'), { $metadata: { httpStatusCode: 403 } }));
    await expect(runProcessingLifecycle({ apply: true }, { configuration, client: { send } })).rejects.toMatchObject({ code: 'permission' });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('accepts only explicit supported CLI modes', () => {
    expect(lifecycleCliOptions([])).toEqual({ apply: false }); expect(lifecycleCliOptions(['--apply'])).toEqual({ apply: true });
    expect(lifecycleCliOptions(['--dry-run'])).toEqual({ apply: false });
    expect(() => lifecycleCliOptions(['--apply', '--dry-run'])).toThrow(); expect(() => lifecycleCliOptions(['--prefix', 'processing/'])).toThrow();
  });
});
