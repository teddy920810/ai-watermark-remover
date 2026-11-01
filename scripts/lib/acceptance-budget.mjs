/* global structuredClone */
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

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
