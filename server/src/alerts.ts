// Email alerts for merchants: "your payment link was paid / failed / was refunded".
//
// How it works:
//  1. A merchant adds an email on the Merchant tab. We email a 6-digit code; typing it back proves the address is theirs.
//     Nothing is ever sent to an address that has not been confirmed, so this cannot be used to spam strangers.
//  2. When a payment link's attempt reaches paid / failed / refunded, PaymentService calls enqueue(). That only SAVES a job.
//  3. The background job calls processPending(), which sends the saved jobs and retries failures with growing pauses.
//     Because jobs are in the database, a restart (or the free Render plan sleeping) delays an alert but never loses it.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { walletKey } from '../../shared/src/addresses.ts';
import { fromBaseUnits } from '../../shared/src/amounts.ts';
import { chainName } from '../../shared/src/chain-names.ts';
import { SpendXError } from './domain.ts';
import type { AlertJob, AlertKind, Attempt, MerchantContact, PaymentRequest, Repository } from './domain.ts';
import type { EmailMessage, Emailer } from './email.ts';

const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
const CODE_COOLDOWN_MS = 60_000;
const MAX_CODES_PER_HOUR = 5;
const HOUR_MS = 3_600_000;
const MAX_TRIES = 6;
/** pause before retry number 1, 2, 3, ... after a failed send */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * HOUR_MS, 6 * HOUR_MS];
const CLAIM_LOCK_MS = 5 * 60_000;

export interface AlertStatus { enabled: boolean; email?: string; verified?: boolean }

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  // Deliberately plain: one @, no spaces or control characters, a dot in the domain. The confirmation code is the real check.
  if (email.length > 254 || !/^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]+$/.test(email)) {
    throw new SpendXError('invalid_email', 'That email address does not look right', 400);
  }
  return email;
}

const oneLine = (s: string, max = 120) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function render(lines: string[], link?: { href: string; label: string }): { text: string; html: string } {
  const text = [...lines, ...(link ? ['', `${link.label}: ${link.href}`] : [])].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">`
    + lines.map((l) => (l === '' ? '<br>' : `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`)).join('')
    + (link ? `<p style="margin:16px 0 0"><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>` : '')
    + `</div>`;
  return { text, html };
}

export function buildAlertEmail(i: { to: string; kind: AlertKind; request: PaymentRequest; attempt: Attempt; origin: string; atMs: number }): EmailMessage {
  const r = i.request;
  const amount = `${fromBaseUnits(r.amount, r.destDecimals)} ${oneLine(r.destSymbol, 20)}`;
  const where = oneLine(chainName(r.destBlockchain), 40);
  const sent = `${fromBaseUnits(i.attempt.amountIn, i.attempt.originDecimals)} ${oneLine(i.attempt.originSymbol, 20)} on ${oneLine(chainName(i.attempt.originBlockchain), 40)}`;
  const when = `${new Date(i.atMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const head = {
    paid: ['Payment received', 'A customer paid your payment link.'],
    failed: ['Payment failed', 'A payment to your link did not go through. You have not been paid for this attempt.'],
    refunded: ['Payment refunded', 'A payment to your link was refunded to the customer. You have not been paid for this attempt.'],
  }[i.kind];
  const lines = [
    head[1], '',
    `Amount: ${amount} on ${where}`,
    `Customer sent: ${sent}`,
    ...(r.description ? [`Note: ${oneLine(r.description, 200)}`] : []),
    `Time: ${when}`, '',
    'You get this because payment alerts are on for your wallet in SpendX. You can turn them off any time in the Merchant tab.',
  ];
  const { text, html } = render(lines, { href: `${i.origin}/#/merchant`, label: 'Open your dashboard' });
  return { to: i.to, subject: `${head[0]}: ${amount} on ${where}`, text, html };
}

export function buildCodeEmail(to: string, code: string, origin: string): EmailMessage {
  const lines = [
    `Your SpendX confirmation code is ${code}.`,
    'It expires in 10 minutes.', '',
    'Someone asked to send SpendX payment alerts to this address. If that was not you, ignore this email: nothing will be sent to you unless this code is entered.',
  ];
  const { text, html } = render(lines);
  return { to, subject: `Your SpendX code: ${code}`, text, html };
}

export class AlertService {
  private d: { repo: Repository; emailer?: Emailer; secret: string; origin: string; now?: () => number; log?: (m: string, e?: unknown) => void };
  constructor(d: AlertService['d']) {
    this.d = d;
  }
  private now() { return (this.d.now ?? Date.now)(); }
  get enabled(): boolean { return !!this.d.emailer; }
  private need(): Emailer {
    if (!this.d.emailer) throw new SpendXError('alerts_disabled', 'Email alerts are unavailable at the moment. Please try again later.', 503);
    return this.d.emailer;
  }
  private hash(key: string, email: string, code: string) {
    return createHmac('sha256', this.d.secret).update(`alert-code:${key}:${email}:${code}`).digest('hex');
  }
  private toStatus(c: MerchantContact | null): AlertStatus {
    return { enabled: true, email: c?.email, verified: !!c?.verifiedAt };
  }

  async status(address: string): Promise<AlertStatus> {
    if (!this.enabled) return { enabled: false };
    return this.toStatus(await this.d.repo.getMerchantContact(walletKey(address)));
  }

  /** Step 1: remember the address (unconfirmed) and email a code to it. */
  async requestCode(address: string, rawEmail: string): Promise<AlertStatus> {
    const emailer = this.need();
    const email = normalizeEmail(rawEmail);
    const key = walletKey(address);
    const now = this.now();
    const existing = await this.d.repo.getMerchantContact(key);
    if (existing?.verifiedAt && existing.email === email) return this.toStatus(existing); // already confirmed, nothing to do
    if (existing?.lastCodeAt && now - Date.parse(existing.lastCodeAt) < CODE_COOLDOWN_MS) {
      throw new SpendXError('rate_limited', 'Please wait a minute before asking for another code', 429);
    }
    const inWindow = !!existing?.codeWindowStart && now - Date.parse(existing.codeWindowStart) < HOUR_MS;
    const sends = inWindow ? existing!.codeSends : 0;
    if (sends >= MAX_CODES_PER_HOUR) throw new SpendXError('rate_limited', 'Too many codes were requested. Try again in an hour', 429);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    // Changing the address pauses alerts until the new one is confirmed.
    const contact: MerchantContact = {
      merchantKey: key, email,
      codeHash: this.hash(key, email, code), codeExpiresAt: new Date(now + CODE_TTL_MS).toISOString(), codeAttempts: 0,
      lastCodeAt: new Date(now).toISOString(), codeSends: sends + 1, codeWindowStart: inWindow ? existing!.codeWindowStart : new Date(now).toISOString(),
    };
    await this.d.repo.saveMerchantContact(contact);
    try {
      await emailer.send(buildCodeEmail(email, code, this.d.origin));
    } catch (e) {
      this.d.log?.('Could not send a confirmation email', e);
      throw new SpendXError('email_failed', 'We could not send the email. Try again in a few minutes', 502);
    }
    return this.toStatus(contact);
  }

  /** Step 2: the merchant types the code back. */
  async verifyCode(address: string, rawCode: string): Promise<AlertStatus> {
    this.need();
    const code = rawCode.trim();
    if (!/^\d{6}$/.test(code)) throw new SpendXError('invalid_code', 'Enter the 6-digit code from the email', 400);
    const key = walletKey(address);
    const c = await this.d.repo.getMerchantContact(key);
    const wrong = () => new SpendXError('invalid_code', 'That code is wrong or has expired. Ask for a new one', 400);
    if (!c?.codeHash || !c.codeExpiresAt) throw wrong();
    if (Date.parse(c.codeExpiresAt) < this.now() || c.codeAttempts >= MAX_CODE_ATTEMPTS) {
      await this.d.repo.saveMerchantContact({ ...c, codeHash: undefined, codeExpiresAt: undefined });
      throw wrong();
    }
    const a = Buffer.from(this.hash(key, c.email, code));
    const b = Buffer.from(c.codeHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      const attempts = c.codeAttempts + 1;
      await this.d.repo.saveMerchantContact({ ...c, codeAttempts: attempts, ...(attempts >= MAX_CODE_ATTEMPTS ? { codeHash: undefined, codeExpiresAt: undefined } : {}) });
      throw wrong();
    }
    const done: MerchantContact = { ...c, verifiedAt: new Date(this.now()).toISOString(), codeHash: undefined, codeExpiresAt: undefined, codeAttempts: 0 };
    await this.d.repo.saveMerchantContact(done);
    return this.toStatus(done);
  }

  async remove(address: string): Promise<AlertStatus> {
    this.need();
    await this.d.repo.deleteMerchantContact(walletKey(address));
    return this.toStatus(null);
  }

  /** Called when a payment link's attempt reaches a final outcome. Saves a job only; never sends from here. */
  async enqueue(attempt: Attempt, request: PaymentRequest, kind: AlertKind): Promise<void> {
    if (!this.enabled) return;
    const key = walletKey(request.merchantAddress);
    const c = await this.d.repo.getMerchantContact(key);
    if (!c?.verifiedAt) return; // this merchant has not turned alerts on
    await this.d.repo.enqueueAlert({ attemptId: attempt.id, requestId: request.id, merchantKey: key, kind });
  }

  /** Sends the jobs that are due. Safe to call often. */
  async processPending(limit = 10): Promise<{ sent: number; failed: number; skipped: number }> {
    const out = { sent: 0, failed: 0, skipped: 0 };
    if (!this.d.emailer) return out;
    const now = this.now();
    const jobs = await this.d.repo.claimAlerts(new Date(now).toISOString(), new Date(now + CLAIM_LOCK_MS).toISOString(), limit);
    for (const job of jobs) {
      try {
        const done = await this.send(job);
        if (done) out.sent++; else out.skipped++;
      } catch (e) {
        out.failed++;
        const tries = job.tries + 1;
        this.d.log?.(`Alert ${job.id} could not be sent (try ${tries})`, e);
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        await this.d.repo.finishAlert(job.id, tries >= MAX_TRIES
          ? { status: 'dead', tries, lastError: message }
          : { status: 'pending', tries, nextTryAt: new Date(this.now() + BACKOFF_MS[Math.min(tries, BACKOFF_MS.length) - 1]).toISOString(), lastError: message });
      }
    }
    return out;
  }

  /** true = sent, false = skipped (merchant turned alerts off, or the records are gone) */
  private async send(job: AlertJob): Promise<boolean> {
    const skip = async () => { await this.d.repo.finishAlert(job.id, { status: 'skipped', tries: job.tries }); return false; };
    const contact = await this.d.repo.getMerchantContact(job.merchantKey);
    if (!contact?.verifiedAt) return skip();
    const [attempt, request] = await Promise.all([this.d.repo.getAttempt(job.attemptId), this.d.repo.getRequestById(job.requestId)]);
    if (!attempt || !request) return skip();
    await this.need().send(buildAlertEmail({ to: contact.email, kind: job.kind, request, attempt, origin: this.d.origin, atMs: this.now() }));
    await this.d.repo.finishAlert(job.id, { status: 'sent', tries: job.tries + 1 });
    return true;
  }
}
