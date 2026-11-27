import { sameWalletAddress } from '../../shared/src/addresses.ts';
import { randomUUID } from 'node:crypto';
import { RETRYABLE_STATES } from '../../shared/src/status.ts';
import { SpendXError } from './domain.ts';
import type { AlertJob, AlertKind, Attempt, MerchantContact, PaymentRequest, Repository } from './domain.ts';

/** In-memory repository for tests and local experiments. Mirrors the SQL partial unique index. */
export class MemoryRepository implements Repository {
  requests = new Map<string, PaymentRequest>();
  attempts = new Map<string, Attempt>();
  contacts = new Map<string, MerchantContact>();
  alerts = new Map<string, AlertJob>();
  /** injectable clock so tests can control record timestamps */
  now: () => number = () => Date.now();

  async createRequest(r: Omit<PaymentRequest, 'id' | 'createdAt'>) {
    const row: PaymentRequest = { ...r, id: randomUUID(), createdAt: new Date(this.now()).toISOString() };
    this.requests.set(row.id, row);
    return row;
  }
  async getRequestBySlug(slug: string) {
    return [...this.requests.values()].find((r) => r.slug === slug) ?? null;
  }
  async getRequestById(id: string) {
    return this.requests.get(id) ?? null;
  }
  async setRequestStatus(id: string, status: PaymentRequest['status']) {
    const r = this.requests.get(id);
    if (r) r.status = status;
  }
  async listRequestsByMerchant(address: string) {
    return [...this.requests.values()].filter((r) => sameWalletAddress(r.merchantAddress, address));
  }
  async createAttempt(a: Omit<Attempt, 'id' | 'createdAt' | 'updatedAt'>) {
    if (await this.getLiveAttempt(a.requestId)) {
      throw new SpendXError('attempt_in_progress', 'This payment already has a live attempt', 409);
    }
    const now = new Date(this.now()).toISOString();
    const row: Attempt = { ...a, id: randomUUID(), createdAt: now, updatedAt: now };
    this.attempts.set(row.id, row);
    return row;
  }
  async getAttempt(id: string) {
    return this.attempts.get(id) ?? null;
  }
  async getLiveAttempt(requestId: string) {
    return [...this.attempts.values()].find((x) => x.requestId === requestId && !RETRYABLE_STATES.has(x.state)) ?? null;
  }
  async updateAttempt(id: string, patch: Partial<Attempt>) {
    const cur = this.attempts.get(id);
    if (!cur) throw new SpendXError('not_found', 'Attempt not found', 404);
    const next = { ...cur, ...patch, updatedAt: new Date(this.now()).toISOString() };
    this.attempts.set(id, next);
    return next;
  }
  async listAttempts(requestId: string) {
    return [...this.attempts.values()].filter((x) => x.requestId === requestId);
  }
  async listAttemptsByPayer(address: string, limit: number) {
    return [...this.attempts.values()]
      .filter((x) => sameWalletAddress(x.payerAddress, address))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  async listReconcilable(cutoffIso: string, limit: number) {
    const FINAL = new Set(['destination_confirmed', 'failed', 'refunded', 'cancelled', 'needs_review']);
    return [...this.attempts.values()]
      .filter((x) => !FINAL.has(x.state) && (x.state !== 'expired' || x.quoteDeadline >= cutoffIso))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, limit);
  }

  async getMerchantContact(merchantKey: string) {
    const c = this.contacts.get(merchantKey);
    return c ? { ...c } : null;
  }
  async saveMerchantContact(c: MerchantContact) {
    this.contacts.set(c.merchantKey, { ...c });
  }
  async deleteMerchantContact(merchantKey: string) {
    this.contacts.delete(merchantKey);
  }
  async enqueueAlert(a: { attemptId: string; requestId: string; merchantKey: string; kind: AlertKind }) {
    if ([...this.alerts.values()].some((j) => j.attemptId === a.attemptId && j.kind === a.kind)) return;
    const id = randomUUID();
    this.alerts.set(id, { id, ...a, status: 'pending', tries: 0, nextTryAt: new Date(this.now()).toISOString() });
  }
  async claimAlerts(nowIso: string, lockUntilIso: string, limit: number) {
    const due = [...this.alerts.values()].filter((j) => j.status === 'pending' && j.nextTryAt <= nowIso).slice(0, limit);
    for (const j of due) j.nextTryAt = lockUntilIso;
    return due.map((j) => ({ ...j }));
  }
  async finishAlert(id: string, patch: { status: AlertJob['status']; tries: number; nextTryAt?: string; lastError?: string }) {
    const j = this.alerts.get(id);
    if (j) Object.assign(j, patch);
  }
}
