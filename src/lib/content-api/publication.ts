/** Public proof of a Site build containing an approved content change; never publish audit notes or identity. */
export function buildPublications(records: unknown[]) {
  const publications: { id: string; digest: string }[] = [];
  for (const value of records) {
    if (!value || typeof value !== 'object') continue;
    const record = value as { id?: string; approval?: { digest?: string } };
    if (/^[a-f0-9]{24}$/.test(record.id ?? '') && /^[a-f0-9]{64}$/.test(record.approval?.digest ?? '')) publications.push({ id: record.id!, digest: record.approval!.digest! });
  }
  return { publications: publications.sort((a, b) => a.id.localeCompare(b.id)) };
}
