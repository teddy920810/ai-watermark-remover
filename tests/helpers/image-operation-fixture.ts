import { openWorkspace } from './workspace';
import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';
const expires = () => new Date(Date.now() + 86_400_000).toISOString();

export async function imageOperationFixture(page: Page, options: { initiallySignedIn?: boolean; purchasedImageCredits?: number; operation?: 'background-removal' | 'object-removal'; autoSelect?: boolean; output?: Buffer; downloadOrigin?: string; quoteUnavailable?: boolean; dimensions?: { width: number; height: number }; unified?: boolean; creditsAdmissionEnabled?: boolean } = {}) {
  const { initiallySignedIn = true, purchasedImageCredits = 100, operation = 'background-removal', autoSelect = true, downloadOrigin = '' } = options;
  const dimensions = options.dimensions ?? { width: 80, height: 60 };
  const output = options.output ?? await sharp({ create: { ...dimensions, channels: 4, background: '#5577aa00' } }).png().toBuffer();
  const input = await sharp({ create: { ...dimensions, channels: 3, background: '#5577aa' } }).png().toBuffer();
  const state = { freeUses: 0, owner: 'image-operation-owner', quoteUnavailable: options.quoteUnavailable ?? false, rejectBalance: false, purchasedImageCredits, signedIn: initiallySignedIn, uploads: 0, quotes: 0, submissions: 0, oldRequests: 0, masks: [] as Buffer[], quoteRequests: [] as { maskArtifactId?: string }[], cost: 10, rejectPrice: false, unknown: false, job: null as Record<string, unknown> | null };
  const uploads = new Map<string, { kind: string }>();
  const inputArtifact = { id: 'durable-input', role: 'source', metadata: { kind: 'image', contentType: 'image/png', byteSize: input.length, ...dimensions }, previewUrl: '/fixture/durable-input.png', expiresAt: expires(), format: 'PNG' };
  const result = { id: 'durable-result', role: 'result', metadata: { kind: 'image', contentType: 'image/png', byteSize: output.length, ...dimensions }, previewUrl: '/fixture/durable-result.png', expiresAt: expires(), format: 'PNG', canRefine: false };
  await page.route('**/api/auth/get-session', route => route.fulfill({ json: state.signedIn ? { user: { id: state.owner, name: 'Image buyer' }, session: { id: 'image-operation-session' } } : null }));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith('/capabilities')) return route.fulfill({ json: { operations: ['image-watermark', 'image-watermark-pro', 'image-refine', 'video-watermark', 'background-removal', 'object-removal'].map(operation => ({ operation, enabled: true, acceptedTypes: ['image/png'], maxBytes: 10_485_760 })) } });
    if (path.endsWith('/me')) return route.fulfill({ json: options.unified ? { walletMode: 'unified', unit: 'credits', credits: state.purchasedImageCredits, admissionEnabled: options.creditsAdmissionEnabled ?? true } : { freeUses: state.freeUses, purchasedImageCredits: state.purchasedImageCredits, processingCredits: 77 } });
    if (path.endsWith('/uploads') && request.method() === 'POST') { state.uploads += 1; const id = `durable-upload-${state.uploads}`; uploads.set(id, request.postDataJSON()); return route.fulfill({ status: 201, json: { id, uploadUrl: `/fixture/${id}` } }); }
    if (/\/uploads\/[^/]+\/complete$/.test(path)) return route.fulfill({ status: 202, json: { status: 'validating' } });
    if (/\/uploads\/[^/]+$/.test(path)) { const id = path.split('/').at(-1)!; return route.fulfill({ json: { id, status: 'ready', artifact: uploads.get(id)?.kind === 'mask' ? { ...inputArtifact, id: `mask-${id}`, role: 'mask' } : inputArtifact } }); }
    if (path.endsWith('/quotes')) {
      state.quotes += 1; if (state.quoteUnavailable) return route.fulfill({status:503,json:{error:'Processing cost unavailable'}}); const body = request.postDataJSON(); state.quoteRequests.push(body);
      return route.fulfill({ status: 201, json: { id: `image-quote-${state.quotes}`, operation: body.operation, amount: options.unified ? state.cost : state.freeUses > 0 ? 1 : state.cost, unit: options.unified ? 'credits' : state.freeUses > 0 ? 'freeUses' : 'purchasedImageCredits', priceVersion: `image-${state.cost}`, expiresAt: expires(), expectedOutput: { contentType: 'image/png', format: 'PNG', ...dimensions, ...(operation === 'background-removal' ? { transparent: true } : {}) } } });
    }
    if (path.endsWith('/jobs') && request.method() === 'POST') {
      state.submissions += 1;
      if (state.rejectPrice) { state.rejectPrice = false; state.cost = 15; return route.fulfill({ status: 409, json: { code: 'quote_changed', error: 'Review the updated processing cost.' } }); }
      if (state.rejectBalance) { state.purchasedImageCredits = 0; return route.fulfill({status:402,json:{code:'insufficient_balance',error:'No image credits remaining'}}); }
      const quote = request.postDataJSON();
      const unit = options.unified ? 'credits' : state.freeUses > 0 ? 'freeUses' : 'purchasedImageCredits'; const amount = unit === 'freeUses' ? 1 : state.cost;
      if (!state.job) { if (unit === 'freeUses') state.freeUses--; else state.purchasedImageCredits -= amount; }
      state.job ??= { id: 'background-job', operation, status: state.unknown ? 'UNKNOWN' : 'READY', chargeStatus: state.unknown ? 'reserved' : 'settled', amount, unit, quote: { id: quote.quoteId, amount, unit }, charge: { amount, unit, status: state.unknown ? 'reserved' : 'settled' }, input: inputArtifact, ...(state.unknown ? {} : { result }), expiresAt: expires() };
      return route.fulfill({ status: 202, json: state.job });
    }
    if (path.endsWith('/jobs/background-job/download')) return route.fulfill({ json: { url: `${downloadOrigin}/result.png`, expiresAt: expires() } });
    if (path.endsWith('/jobs/background-job')) return route.fulfill({ json: state.job });
    if (path.endsWith('/jobs')) return route.fulfill({ json: { jobs: state.job ? [state.job] : [] } });
    return route.fulfill({ status: 404, json: { error: 'Unexpected fixture request' } });
  });
  for (const path of ['**/api/upload-url', '**/api/jobs']) await page.route(path, route => { state.oldRequests += 1; return route.fulfill({ status: 500, json: { error: 'Old admission must not be used' } }); });
  await page.route('**/fixture/durable-upload-*', route => { const id = new URL(route.request().url()).pathname.split('/').at(-1)!; if (uploads.get(id)?.kind === 'mask') state.masks.push(route.request().postDataBuffer()!); return route.fulfill({ status: 200 }); });
  await page.route('**/fixture/durable-input.png', route => route.fulfill({ contentType: 'image/png', body: input }));
  await page.route('**/fixture/durable-result.png', route => route.fulfill({ contentType: 'image/png', body: output }));
  await openWorkspace(page, `/app?operation=${operation}`);
  await page.getByLabel('Upload file to workspace').setInputFiles({ name: 'background-source.png', mimeType: 'image/png', buffer: input });
  if (operation === 'object-removal' && autoSelect) await stroke(page);
  if (initiallySignedIn && autoSelect && !options.quoteUnavailable) await expect(page.getByRole('button', { name: `${operation === 'object-removal' ? 'Remove object' : 'Remove background'} · 10 ${options.unified ? 'Credits' : 'image credits'}`, exact: true })).toBeVisible();
  else if (!initiallySignedIn) await expect(page.getByRole('button', { name: 'Sign in to continue', exact: true })).toBeEnabled();
  return state;
}

export async function stroke(page: Page, from = .25, to = .55) {
  const canvas = page.getByLabel('Object removal mask canvas'); await canvas.scrollIntoViewIfNeeded(); const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * from, box.y + box.height * .4); await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, box.y + box.height * .6, { steps: 5 }); await page.mouse.up();
}
