/* global structuredClone */
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { URL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { operationCatalog } from '../../src/lib/contracts/operation-catalog.ts';

function authorizationError(message) { return Object.assign(new Error(message), { code: 'budget_authorization' }); }
function reviewedCharge(state, context) {
  const scope = state.readyScope; const review = scope.walletReview;
  const charge = review?.charges?.[context.operation];
  if (!review || typeof review.reference !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/.test(review.reference) || review.ownerDigest !== scope.ownerDigest
    || !['legacy', 'unified'].includes(review.mode) || !charge || !operationCatalog[context.operation]?.units.includes(charge.unit)
    || !Number.isSafeInteger(charge.amount) || charge.amount <= 0
    || (review.mode === 'unified') !== (charge.unit === 'credits')) throw authorizationError('An independently reviewed wallet identity and exact operation charge are required.');
  return charge;
}
function creditFactor(state, context, unit) {
  if (unit === 'credits') return 1;
  if (reviewedCharge(state, context).unit !== unit) throw authorizationError('The original currency differs from the reviewed wallet source.');
  return unit === 'purchasedImageCredits' ? 1 : 100;
}

/** Every functional entry uses this read-only gate before network or legacy ledger selection. */
export async function authorizeFunctionalAcceptance(options, environment) {
  const session = environment.PROCESSING_ACCEPTANCE_SESSION_COOKIE ?? environment.SMOKE_SESSION_COOKIE;
  if (!session || /[\r\n]/.test(session)) throw Object.assign(new Error('A functional acceptance session is required.'), { code: 'authentication_required' });
  try {
    const url = new URL(options.baseUrl ?? environment.PROCESSING_ACCEPTANCE_BASE_URL ?? environment.SMOKE_BASE_URL ?? 'https://www.watermarkgemini.com');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw authorizationError('A reviewed site origin is required.');
    const requestedOperation = options.operation ?? environment.PROCESSING_ACCEPTANCE_OPERATION ?? 'image-watermark';
    const operation = requestedOperation === 'watermark-removal' ? 'image-watermark' : requestedOperation;
    const ledger = options.ledgerPath ?? environment.ACCEPTANCE_LEDGER_PATH;
    if (!ledger || options.imageLimit !== undefined || environment.PROCESSING_ACCEPTANCE_IMAGE_LIMIT !== undefined) throw authorizationError('Use the existing aggregate ledger; legacy image limits are not authorization.');
    const budget = new CreditsAcceptanceBudget(resolve(ledger), {
      budgetId: options.creditBudgetId ?? environment.CREDITS_ACCEPTANCE_BUDGET_ID,
      scopeId: options.creditScopeId ?? environment.CREDITS_ACCEPTANCE_SCOPE_ID,
      environment: options.creditEnvironment ?? environment.CREDITS_ACCEPTANCE_ENVIRONMENT, origin: url.origin, session, operation,
    });
    const unit = options.expectedUnit ?? environment.PROCESSING_ACCEPTANCE_EXPECTED_UNIT;
    const amount = options.expectedAmount ?? Number(environment.PROCESSING_ACCEPTANCE_EXPECTED_AMOUNT);
    const summary = await budget.authorize(unit, amount);
    return { budget, summary, operation, unit, amount, origin: url.origin, session };
  } catch { throw authorizationError('Functional acceptance requires the existing aggregate and an exact reviewed initialized wallet scope, unit and amount.'); }
}

/** A failed or uncertain paid submission still consumes its pre-authorized test slot. */
export class AcceptanceBudget {
  constructor(file, limits = { image: 5, video: 5 }, { requireCreditBudget = false } = {}) {
    if (!['image', 'video'].every((kind) => Number.isInteger(limits[kind]) && limits[kind] >= 0 && limits[kind] <= (kind === 'image' ? 15 : 5))) throw new Error('Acceptance budget limits exceed the supported authorization.');
    this.file = file;
    this.limits = { ...limits };
    if (limits.image > 10 && !requireCreditBudget) throw new Error('Expanded image limits require explicit credit authorization.');
    this.requireCreditBudget = requireCreditBudget;
  }

  async transaction(update) {
    await mkdir(dirname(this.file), { recursive: true });
    const lockPath = `${this.file}.lock`;
    let lock;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      try { lock = await open(lockPath, 'wx'); break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; await delay(10); }
    }
    if (!lock) throw new Error('Acceptance budget is locked; do not retry a paid operation.');
    try {
      let state;
      try { state = JSON.parse(await readFile(this.file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; state = { version: 1, limits: this.limits, records: [] }; }
      if (state.version !== 1 || !Array.isArray(state.records) || JSON.stringify(state.limits) !== JSON.stringify(this.limits)) throw new Error('Acceptance limits do not match the existing ledger.');
      if ((state.limits.image > 10 || this.requireCreditBudget) && !state.imageCreditBudget) throw new Error('Expanded calls require the existing ledger and explicit credit authorization.');
      const result = update(state);
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.file);
      return result;
    } finally { await lock.close(); await unlink(lockPath); }
  }

  async reserve(kind, purpose, quote) {
    if (!['image', 'video'].includes(kind) || typeof purpose !== 'string' || !purpose.trim() || purpose.length > 200 || /https?:\/\/|api.?key|cookie|token/i.test(purpose)) throw new Error('Use a short non-sensitive acceptance purpose.');
    return this.transaction((state) => {
      if (state.records.filter((record) => record.kind === kind).length >= state.limits[kind]) throw new Error(`Real ${kind} acceptance budget exhausted.`);
      let creditCharge;
      if (kind === 'image' && state.imageCreditBudget) {
        const budget = state.imageCreditBudget;
        if (!quote || !Number.isSafeInteger(quote.amount) || quote.amount <= 0 || !['freeUses', budget.unit].includes(quote.unit)) throw new Error('Exact quoted amount and the authorized allowance unit are required.');
        creditCharge = quote.unit === 'freeUses' ? 0 : quote.amount;
        if (!Number.isSafeInteger(budget.limit) || budget.limit <= 0 || budget.limit > 10 || !Number.isSafeInteger(budget.reserved) || budget.reserved < 0 || budget.reserved + creditCharge > budget.limit) throw new Error('Image credit budget exhausted.');
        budget.reserved += creditCharge;
      }
      const id = randomUUID();
      state.records.push({ id, kind, purpose, startedAt: new Date().toISOString(), status: 'started', ...(creditCharge !== undefined ? { quotedAmount: quote.amount, creditUnit: quote.unit, creditBudgetId: state.imageCreditBudget.id, reservedCredits: creditCharge } : {}) });
      return id;
    });
  }

  async authorizeIncrease(limits, reason) {
    if (!reason?.trim() || reason.length > 300 || /https?:\/\/|api.?key|cookie|token/i.test(reason)
      || !['image', 'video'].every((kind) => Number.isInteger(limits[kind]) && limits[kind] >= this.limits[kind] && limits[kind] <= (kind === 'image' ? 10 : 5))) throw new Error('Explicit authorization and valid limits are required.');
    await this.transaction((state) => {
      if (state.imageCreditBudget) throw new Error('Credit-controlled call limits cannot change through legacy authorization.');
      state.authorizations ??= [];
      state.authorizations.push({ previous: { ...state.limits }, next: { ...limits }, reason, at: new Date().toISOString() });
      state.limits = { ...limits };
    });
    this.limits = { ...limits };
  }

  async authorizeImageCredits({ amount, unit, additionalCalls, reason }) {
    if (!Number.isInteger(amount) || amount <= 0 || amount > 10 || !['processingCredits', 'purchasedImageCredits'].includes(unit)
      || !Number.isInteger(additionalCalls) || additionalCalls <= 0 || additionalCalls > 5 || this.limits.image + additionalCalls > 15
      || !reason?.trim() || reason.length > 300 || /https?:\/\/|api.?key|cookie|token/i.test(reason)) throw new Error('Explicit credit and call authorization is required.');
    const next = { ...this.limits, image: this.limits.image + additionalCalls };
    await this.transaction(state => {
      if (state.imageCreditBudget) throw new Error('An image credit authorization is already active.');
      if (state.records.filter(record => record.kind === 'image').length !== state.limits.image) throw new Error('Keep the exhausted original ledger before adding release authorization.');
      const at = new Date().toISOString();
      state.authorizations ??= [];
      state.authorizations.push({ type: 'image-credit-budget', previous: { ...state.limits }, next: { ...next }, amount, unit, reason, at });
      state.imageCreditBudget = { id: randomUUID(), unit, limit: amount, reserved: 0, additionalCalls, firstRecordIndex: state.records.length, authorizedAt: at };
      state.limits = { ...next };
    });
    this.limits = next;
    this.requireCreditBudget = true;
  }

  async finish(id, evidence) {
    return this.transaction((state) => {
      const record = state.records.find((item) => item.id === id);
      if (!record) throw new Error('Unknown acceptance reservation.');
      if (!['passed', 'failed', 'unknown'].includes(evidence.status)) throw new Error('Invalid acceptance result.');
      record.status = evidence.status;
      record.finishedAt = new Date().toISOString();
      if (typeof evidence.note === 'string' && !/https?:\/\/|api.?key|cookie|token/i.test(evidence.note)) record.note = evidence.note.slice(0, 500);
      for (const key of ['creditsBefore', 'creditsAfter', 'width', 'height', 'durationSeconds', 'hasAudio']) {
        if (typeof evidence[key] === 'number' && Number.isFinite(evidence[key]) || typeof evidence[key] === 'boolean') record[key] = evidence[key];
      }
    });
  }

  async summary() {
    return this.transaction((state) => {
      const used = { image: 0, video: 0 };
      for (const record of state.records) { if (!(record.kind in used)) throw new Error('Corrupt acceptance ledger.'); used[record.kind] += 1; }
      return { used, remaining: { image: state.limits.image - used.image, video: state.limits.video - used.video }, records: structuredClone(state.records), ...(state.imageCreditBudget ? { imageCreditBudget: structuredClone(state.imageCreditBudget) } : {}) };
    });
  }
}

/** One pre-existing aggregate authorization. Never creates a ledger or releases uncertain spend. */
export class CreditsAcceptanceBudget {
  constructor(file, context) {
    if (!file || !context?.budgetId || !context.scopeId || !context.session || !['sandbox', 'live'].includes(context.environment)) throw new Error('Explicit Credits budget and reviewed scope are required.');
    this.file = file;
    this.context = { ...context, session: undefined, sessionDigest: createHash('sha256').update(context.session).digest('hex') };
  }
  validate(state, allowUninitialized = false) {
    const c = this.context; const scope = state.readyScope;
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    if (state.schemaVersion !== 1 || state.unit !== 'Credits' || state.budgetId !== c.budgetId || !state.authority || !Array.isArray(state.events)
      || !['issuanceLimit', 'grossIssued', 'issuanceReservedUnknown', 'grossSpendLimit', 'grossSpent', 'spendReservedUnknown', 'realProviderInvocationPlannedLimit', 'realProviderInvocationsConsumed'].every(key => integer(state[key]))
      || state.issuanceLimit > 2000 || state.grossSpendLimit > 2000 || state.realProviderInvocationPlannedLimit > 6
      || state.grossIssued + state.issuanceReservedUnknown > state.issuanceLimit || state.grossSpent + state.spendReservedUnknown > state.grossSpendLimit
      || state.realProviderInvocationsConsumed > state.realProviderInvocationPlannedLimit) throw new Error('Credits aggregate budget is invalid or exhausted.');
    if (!scope || scope.reviewed !== true || typeof scope.initialized !== 'boolean' || !allowUninitialized && !scope.initialized || scope.scopeId !== c.scopeId || scope.origin !== c.origin
      || scope.environment !== c.environment || scope.sessionDigest !== c.sessionDigest || !/^[a-f0-9]{64}$/.test(scope.ownerDigest)
      || !Array.isArray(scope.operations) || !scope.operations.includes(c.operation)) throw new Error('Reviewed initialized scope or session does not match.');
    return state;
  }
  async summary() {
    const state = this.validate(JSON.parse(await readFile(this.file, 'utf8')));
    return structuredClone({ ...state, remaining: { image: state.realProviderInvocationPlannedLimit - state.realProviderInvocationsConsumed,
      video: state.realProviderInvocationPlannedLimit - state.realProviderInvocationsConsumed } });
  }
  async authorize(unit, amount) {
    const state = await this.summary();
    const charge = reviewedCharge(state, this.context);
    if (charge.unit !== unit || charge.amount !== amount) throw authorizationError('Caller confirmation differs from the reviewed wallet charge.');
    const credits = amount * creditFactor(state, this.context, unit);
    if (!Number.isSafeInteger(credits) || state.grossSpent + state.spendReservedUnknown + credits > state.grossSpendLimit
      || state.realProviderInvocationsConsumed >= state.realProviderInvocationPlannedLimit) throw authorizationError('The same aggregate acceptance budget is exhausted.');
    this.functionalCharge = { unit, amount };
    return state;
  }
  async transaction(update, allowUninitialized = false) {
    // The parent and ledger must already exist; no replacement authorization is synthesized.
    const lockPath = `${this.file}.lock`; let lock; let temporary;
    for (let attempt = 0; attempt < 400; attempt++) {
      try { lock = await open(lockPath, 'wx'); break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; await delay(10); }
    }
    if (!lock) throw new Error('Credits budget is locked; reconcile before another operation.');
    try {
      const state = this.validate(JSON.parse(await readFile(this.file, 'utf8')), allowUninitialized);
      const result = update(state); this.validate(state, allowUninitialized);
      temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.file); temporary = undefined;
      return result;
    } finally { if (temporary) await unlink(temporary).catch(() => undefined); await lock.close(); await unlink(lockPath); }
  }
  async reserve(kind, purpose, quote) {
    const c = this.context;
    if (!['image', 'video'].includes(kind) || (kind === 'video') !== (quote?.operation === 'video-watermark') || quote?.operation !== c.operation
      || !['credits', 'freeUses', 'purchasedImageCredits', 'processingCredits'].includes(quote.unit) || !Number.isSafeInteger(quote.amount) || quote.amount <= 0 || !purpose?.trim() || purpose.length > 200
      || /https?:\/\/|api.?key|cookie|token/i.test(purpose)) throw new Error('Exact operation and new Credits quote are required.');
    return this.transaction(state => {
      if (this.functionalCharge || quote.unit !== 'credits') {
        const charge = reviewedCharge(state, c);
        if (charge.unit !== quote.unit || charge.amount !== quote.amount) throw authorizationError('Quote differs from the reviewed original charge.');
      }
      const converted = quote.amount * creditFactor(state, c, quote.unit);
      if (!Number.isSafeInteger(converted) || state.realProviderInvocationsConsumed >= state.realProviderInvocationPlannedLimit || state.grossSpent + state.spendReservedUnknown + converted > state.grossSpendLimit) throw new Error('Credits or Provider acceptance budget exhausted.');
      const id = randomUUID(); state.spendReservedUnknown += converted; state.realProviderInvocationsConsumed++;
      state.events.push({ id, type: 'spend', scopeId: c.scopeId, ownerDigest: state.readyScope.ownerDigest, environment: c.environment,
        operation: quote.operation, kind, purpose, amount: quote.amount, unit: quote.unit, creditAmount: converted, status: 'reserved', at: new Date().toISOString() });
      return id;
    });
  }
  async reserveIssuance({ source, amount, unit = 'credits' }) {
    if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(source) || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('Exact non-sensitive issuance source and amount are required.');
    return this.transaction(state => {
      const factor = creditFactor(state, this.context, unit); const converted = amount * factor;
      if (state.events.some(event => event.type === 'issuance' && event.source === source)) throw new Error('Duplicate issuance source must be reconciled.');
      if (!Number.isSafeInteger(converted) || state.grossIssued + state.issuanceReservedUnknown + converted > state.issuanceLimit) throw new Error('Credits issuance budget exhausted.');
      const id = randomUUID(); state.issuanceReservedUnknown += converted;
      state.events.push({ id, type: 'issuance', scopeId: this.context.scopeId, ownerDigest: state.readyScope.ownerDigest, source, amount, unit, creditAmount: converted, creditFactor: factor, status: 'reserved', at: new Date().toISOString() });
      return id;
    }, true);
  }
  async finishIssuance(id, evidence) {
    return this.transaction(state => {
      const event = state.events.find(item => item.id === id && item.type === 'issuance' && item.scopeId === this.context.scopeId);
      if (!event || !Number.isSafeInteger(evidence.amount) || evidence.amount < 0 || evidence.amount > event.amount) throw new Error('Invalid confirmed issuance.');
      if (event.status === 'confirmed') { if (event.issued !== evidence.amount) throw new Error('Issuance evidence conflicts.'); return; }
      state.issuanceReservedUnknown -= event.creditAmount ?? event.amount; state.grossIssued += evidence.amount * (event.creditFactor ?? 1);
      event.status = 'confirmed'; event.issued = evidence.amount; event.finishedAt = new Date().toISOString();
    }, true);
  }
  async finish(id, evidence) {
    return this.transaction(state => {
      const event = state.events.find(item => item.id === id && item.type === 'spend' && item.scopeId === this.context.scopeId);
      if (!event || !['passed', 'failed', 'unknown'].includes(evidence.status)) throw new Error('Invalid Credits acceptance result.');
      if (evidence.status === 'passed' && (!Number.isSafeInteger(evidence.creditsBefore) || !Number.isSafeInteger(evidence.creditsAfter)
        || evidence.creditsAfter < 0 || evidence.creditsBefore - evidence.creditsAfter !== event.amount)) throw new Error('Confirmed spend must match the original quote.');
      const result = { status: evidence.status, ...(evidence.status === 'passed' ? { creditsBefore: evidence.creditsBefore, creditsAfter: evidence.creditsAfter } : {}) };
      if (event.result) { if (JSON.stringify(event.result) !== JSON.stringify(result)) throw new Error('Completed evidence conflicts; reconcile the original event.'); return; }
      if (evidence.status === 'passed') { state.spendReservedUnknown -= event.creditAmount ?? event.amount; state.grossSpent += event.creditAmount ?? event.amount; }
      // Failed, unknown and refunded tasks retain the full reservation and Provider slot.
      event.status = evidence.status; event.result = result; event.finishedAt = new Date().toISOString();
    });
  }
}
