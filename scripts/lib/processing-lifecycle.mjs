/* global structuredClone */
export const PROCESSING_MEDIA_PREFIXES = Object.freeze(['processing/staging/', 'processing/inputs/', 'processing/masks/', 'processing/results/']);
const CONTROL_PREFIXES = ['processing/jobs/', 'processing/quotes/', 'processing/attempts/', 'processing/provider-attempts/', 'processing/provider-metadata/', 'processing/artifacts/', 'processing/uploads/', 'processing/owners/', 'processing/mock-attempts/'];
const prefixOf = (rule) => rule.Filter?.Prefix ?? rule.Filter?.And?.Prefix ?? rule.Prefix ?? '';
const filtered = (rule) => Boolean(rule.Filter?.Tag || rule.Filter?.And?.Tags?.length || rule.Filter?.ObjectSizeGreaterThan !== undefined || rule.Filter?.ObjectSizeLessThan !== undefined || rule.Filter?.And?.ObjectSizeGreaterThan !== undefined || rule.Filter?.And?.ObjectSizeLessThan !== undefined);

/** Pure merge: retain existing rules byte-for-byte in memory, append media-only rules. */
export function buildProcessingMediaLifecycle(existing) {
  if (!existing || !Array.isArray(existing.Rules) || existing.Rules.some(rule => !rule || typeof rule !== 'object' || !['Enabled', 'Disabled'].includes(rule.Status) || typeof prefixOf(rule) !== 'string')) throw new Error('Lifecycle policy is invalid');
  const rules = structuredClone(existing.Rules);
  for (const rule of rules) {
    const prefix = prefixOf(rule);
    if (rule.Status === 'Enabled' && rule.Expiration && CONTROL_PREFIXES.some(control => control.startsWith(prefix) || prefix.startsWith(control))) throw new Error('Existing expiration reaches processing recovery records');
  }
  const addedPrefixes = [];
  for (const prefix of PROCESSING_MEDIA_PREFIXES) {
    if (rules.some(rule => rule.Status === 'Enabled' && prefixOf(rule) === prefix && !filtered(rule) && rule.Expiration?.Days === 1)) continue;
    const id = `processing-media-${prefix.split('/')[1]}-1d`;
    if (rules.some(rule => rule.ID === id)) throw new Error('Managed lifecycle identifier already has another meaning');
    rules.push({ ID: id, Status: 'Enabled', Filter: { Prefix: prefix }, Expiration: { Days: 1 } });
    addedPrefixes.push(prefix);
  }
  if (rules.length > 1000) throw new Error('Lifecycle rule limit would be exceeded');
  return { policy: { Rules: rules }, changed: addedPrefixes.length > 0, addedPrefixes };
}

export function summarizeLifecycle(policy) {
  return policy.Rules.map(rule => ({ enabled: rule.Status === 'Enabled', prefix: prefixOf(rule), filtered: filtered(rule), deleteAfterDays: rule.Expiration?.Days ?? null, absoluteExpiration: Boolean(rule.Expiration?.Date), abortMultipartAfterDays: rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation ?? null }));
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}
export function lifecycleFingerprint(policy) {
  const rules = policy.Rules.map(rule => {
    const copy = JSON.parse(JSON.stringify(rule));
    copy.Filter = copy.Filter ?? { Prefix: copy.Prefix ?? '' }; delete copy.Prefix;
    return JSON.stringify(stable(copy));
  }).sort();
  return JSON.stringify(rules);
}
