import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlertService, buildAlertEmail, normalizeEmail } from '../src/alerts.ts';
import { createEmailer } from '../src/email.ts';
import type { EmailMessage } from '../src/email.ts';
import { buildRoutes } from '../src/api.ts';
import type { ApiResponse } from '../src/api.ts';
import { loadConfig } from '../src/config.ts';
import { PaymentService } from '../src/service.ts';
import { MemoryRepository } from '../src/repo-memory.ts';
import { OneClickError } from '../src/oneclick.ts';
import type { QuoteRequestBody, QuoteResponse, StatusResponse, Token } from '../../shared/src/types.ts';

const USDC: Token = { assetId: 'nep141:usdc-base', decimals: 6, blockchain: 'base', symbol: 'USDC', contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' };
const SOL: Token = { assetId: 'nep141:sol.omft.near', decimals: 9, blockchain: 'sol', symbol: 'SOL' };
const MERCHANT = '0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4';
const PAYER = 'BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z';
const T0 = Date.parse('2026-11-04T12:00:00Z');
const EMPTY = { intentHashes: [], nearTxHashes: [], originChainTxHashes: [], destinationChainTxHashes: [] };

function setup(o: { alertsOn?: boolean } = {}) {
  let clock = T0;
  let st: StatusResponse | 'notfound' = 'notfound';
  const repo = new MemoryRepository();
  repo.now = () => clock;
  const client = {
    async quote(b: QuoteRequestBody): Promise<QuoteResponse> {
      return { signature: 'sig', quoteRequest: { ...b }, quote: { depositAddress: b.dry ? undefined : 'DEPOSIT1', amountIn: '10707496', amountInFormatted: '0.0107', amountInUsd: '1.016', minAmountIn: '10600421', amountOut: b.amount, amountOutFormatted: '1', amountOutUsd: '0.9996', minAmountOut: b.amount, deadline: b.deadline, timeEstimate: 22 } };
    },
    async status(): Promise<StatusResponse> { if (st === 'notfound') throw new OneClickError(404, 'nf', {}); return st; },
    async submitDeposit() {},
  };
  const mail = {
    sent: [] as EmailMessage[], failNext: 0,
    async send(m: EmailMessage) { if (this.failNext > 0) { this.failNext--; throw new Error('provider down'); } this.sent.push(m); },
  };
  const alerts = new AlertService({ repo, emailer: o.alertsOn === false ? undefined : mail, secret: 'z'.repeat(32), origin: 'https://spendx.example', now: () => clock, log: () => {} });
  const service = new PaymentService({
    repo, client, catalog: { findToken: async (id) => [USDC, SOL].find((t) => t.assetId === id) },
    verifyQuoteSignature: () => true, slippageBps: 100, deadlineMinutes: 10, now: () => clock,
    onOutcome: (a, r, k) => alerts.enqueue(a, r, k),
  });
  const auth = { secret: 'y'.repeat(32), verifiers: { evm: async ({ signature }: { signature: string }) => signature === 'valid' }, now: () => clock };
  const routes = buildRoutes({ service, repo, auth, alerts, catalog: { get: async () => [USDC, SOL] }, now: () => clock, log: () => {} });
  async function call(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse> {
    const r = routes.find((x) => x.method === method && x.path === url);
    if (!r) throw new Error('no route ' + method + ' ' + url);
    return r.handler({ params: {}, body, headers });
  }
  async function login() {
    const c = (await call('POST', '/api/auth/challenge', { address: MERCHANT, family: 'evm' })).body as { challengeToken: string };
    const v = (await call('POST', '/api/auth/verify', { address: MERCHANT, family: 'evm', challengeToken: c.challengeToken, signature: 'valid' })).body as { token: string };
    return { authorization: `Bearer ${v.token}` };
  }
  const lastCode = () => /code is (\d{6})/.exec(mail.sent[mail.sent.length - 1].text)![1];
  async function verifiedMerchant(email = 'shop@example.com') {
    await alerts.requestCode(MERCHANT, email);
    await alerts.verifyCode(MERCHANT, lastCode());
    mail.sent.length = 0; // keep only the alerts in the assertions
  }
  async function newAttempt(description?: string) {
    const req = await service.createRequest({ merchantAddress: MERCHANT, merchantFamily: 'evm', destAssetId: USDC.assetId, amountHuman: '1', recipient: MERCHANT, description });
    return service.createAttempt(req.slug, { originAssetId: SOL.assetId, payerAddress: PAYER });
  }
  const setStatus = (s: StatusResponse | 'notfound') => { st = s; };
  const advance = (ms: number) => { clock += ms; };
  const paid = (): StatusResponse => ({ status: 'SUCCESS', updatedAt: 'x', swapDetails: { ...EMPTY, destinationChainTxHashes: [{ hash: '0xdest0000001', explorerUrl: 'https://basescan.org/tx/0xdest0000001' }] } });
  return { repo, service, alerts, mail, call, login, lastCode, verifiedMerchant, newAttempt, setStatus, advance, paid };
}

test('confirming an email: a code is emailed, wrong codes are refused, the right one turns alerts on', async () => {
  const h = setup();
  assert.deepEqual(await h.alerts.status(MERCHANT), { enabled: true, email: undefined, verified: false });
  const s = await h.alerts.requestCode(MERCHANT, '  Shop@Example.com ');
  assert.deepEqual(s, { enabled: true, email: 'shop@example.com', verified: false });
  assert.equal(h.mail.sent.length, 1);
  assert.equal(h.mail.sent[0].to, 'shop@example.com');
  const code = h.lastCode();
  await assert.rejects(() => h.alerts.verifyCode(MERCHANT, code === '000000' ? '000001' : '000000'), /wrong or has expired/);
  await assert.rejects(() => h.alerts.verifyCode(MERCHANT, '12ab'), /6-digit/);
  assert.equal((await h.alerts.verifyCode(MERCHANT, code)).verified, true);
  assert.equal((await h.alerts.status(MERCHANT.toLowerCase())).verified, true, 'checksum case of the wallet does not matter');
  // asking again for the same, already confirmed address does nothing
  await h.alerts.requestCode(MERCHANT, 'shop@example.com');
  assert.equal(h.mail.sent.length, 1);
});

test('a code stops working after 5 wrong guesses, after 10 minutes, and after it has been used', async () => {
  const h = setup();
  await h.alerts.requestCode(MERCHANT, 'shop@example.com');
  const code = h.lastCode();
  const wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await assert.rejects(() => h.alerts.verifyCode(MERCHANT, wrong));
  await assert.rejects(() => h.alerts.verifyCode(MERCHANT, code), /wrong or has expired/, 'the right code is refused once the guesses ran out');

  h.advance(61_000);
  await h.alerts.requestCode(MERCHANT, 'shop@example.com');
  const code2 = h.lastCode();
  h.advance(10 * 60_000 + 1);
  await assert.rejects(() => h.alerts.verifyCode(MERCHANT, code2), /wrong or has expired/);

  h.advance(61_000);
  await h.alerts.requestCode(MERCHANT, 'shop@example.com');
  const code3 = h.lastCode();
  await h.alerts.verifyCode(MERCHANT, code3);
  await assert.rejects(() => h.alerts.verifyCode(MERCHANT, code3), /wrong or has expired/, 'a code works once');
});

test('codes cannot be used to spam an address: one a minute, five an hour', async () => {
  const h = setup();
  await h.alerts.requestCode(MERCHANT, 'a@example.com');
  await assert.rejects(() => h.alerts.requestCode(MERCHANT, 'b@example.com'), /wait a minute/);
  for (let i = 0; i < 4; i++) { h.advance(61_000); await h.alerts.requestCode(MERCHANT, `x${i}@example.com`); }
  assert.equal(h.mail.sent.length, 5);
  h.advance(61_000);
  await assert.rejects(() => h.alerts.requestCode(MERCHANT, 'c@example.com'), /Too many codes/);
  h.advance(60 * 60_000);
  await h.alerts.requestCode(MERCHANT, 'c@example.com');
  assert.equal(h.mail.sent.length, 6);
});

test('badly formed email addresses are refused', () => {
  for (const bad of ['', 'a', 'a@b', 'a b@c.com', 'a@b@c.com', '<x>@c.com', 'a@c.com, d@e.com', 'a@c.com\nBcc: z@z.com', `${'a'.repeat(250)}@c.com`]) {
    assert.throws(() => normalizeEmail(bad), /does not look right/, JSON.stringify(bad));
  }
  assert.equal(normalizeEmail(' Me@Shop.Example.COM '), 'me@shop.example.com');
});

test('a paid payment link sends exactly one email, however often it is checked', async () => {
  const h = setup();
  await h.verifiedMerchant();
  const a = await h.newAttempt('Invoice #7');
  h.setStatus(h.paid());
  await h.service.refresh(a.id);
  await h.service.refresh(a.id);
  assert.deepEqual(await h.alerts.processPending(), { sent: 1, failed: 0, skipped: 0 });
  await h.service.refresh(a.id);
  assert.deepEqual(await h.alerts.processPending(), { sent: 0, failed: 0, skipped: 0 });
  assert.equal(h.mail.sent.length, 1);
  const m = h.mail.sent[0];
  assert.equal(m.to, 'shop@example.com');
  assert.equal(m.subject, 'Payment received: 1 USDC on Base');
  assert.match(m.text, /Note: Invoice #7/);
  assert.match(m.text, /Customer sent: 0\.010707496 SOL on Solana/);
  assert.match(m.text, /https:\/\/spendx\.example\/#\/merchant/);
  assert.ok(!/attempt|deposit/i.test(m.text), 'no secret ids or deposit addresses in the email');
});

test('failed and refunded payments are reported too, each once', async () => {
  const h = setup();
  await h.verifiedMerchant();
  const a = await h.newAttempt();
  h.setStatus({ status: 'FAILED', updatedAt: 'x', swapDetails: EMPTY });
  await h.service.refresh(a.id);
  await h.alerts.processPending();
  assert.equal(h.mail.sent[0].subject, 'Payment failed: 1 USDC on Base');
  assert.match(h.mail.sent[0].text, /You have not been paid/);

  const b = await h.newAttempt();
  h.setStatus({ status: 'REFUNDED', updatedAt: 'x', swapDetails: { ...EMPTY, refundedAmount: '10707496' } });
  await h.service.refresh(b.id);
  await h.alerts.processPending();
  assert.equal(h.mail.sent.length, 2);
  assert.equal(h.mail.sent[1].subject, 'Payment refunded: 1 USDC on Base');
});

test('payments in progress or abandoned do not send anything', async () => {
  const h = setup();
  await h.verifiedMerchant();
  const a = await h.newAttempt();
  h.setStatus({ status: 'PROCESSING', updatedAt: 'x', swapDetails: EMPTY });
  await h.service.refresh(a.id);
  await h.service.cancelAttempt(a.id).catch(() => {});
  assert.deepEqual(await h.alerts.processPending(), { sent: 0, failed: 0, skipped: 0 });
  assert.equal(h.mail.sent.length, 0);
});

test('a merchant who has not confirmed an email, or who removed it, gets nothing', async () => {
  const h = setup();
  const a = await h.newAttempt();
  h.setStatus(h.paid());
  await h.service.refresh(a.id);
  assert.equal(h.repo.alerts.size, 0, 'nothing is even queued for a merchant without alerts');

  await h.verifiedMerchant();
  const b = await h.newAttempt();
  await h.service.refresh(b.id); // queued
  assert.equal(h.repo.alerts.size, 1);
  await h.alerts.remove(MERCHANT); // turned off before the job ran
  assert.deepEqual(await h.alerts.processPending(), { sent: 0, failed: 0, skipped: 1 });
  assert.equal(h.mail.sent.length, 0);
});

test('a failing email provider delays an alert, never loses it, and gives up after 6 tries', async () => {
  const h = setup();
  await h.verifiedMerchant();
  const a = await h.newAttempt();
  h.setStatus(h.paid());
  h.mail.failNext = 1;
  await h.service.refresh(a.id); // the payment itself is unaffected
  assert.equal((await h.repo.getAttempt(a.id))!.state, 'destination_confirmed');
  assert.deepEqual(await h.alerts.processPending(), { sent: 0, failed: 1, skipped: 0 });
  assert.deepEqual(await h.alerts.processPending(), { sent: 0, failed: 0, skipped: 0 }, 'not retried straight away');
  h.advance(61_000);
  assert.deepEqual(await h.alerts.processPending(), { sent: 1, failed: 0, skipped: 0 });
  assert.equal(h.mail.sent.length, 1);

  const b = await h.newAttempt();
  h.setStatus({ status: 'FAILED', updatedAt: 'x', swapDetails: EMPTY });
  h.mail.failNext = 99;
  await h.service.refresh(b.id);
  for (let i = 0; i < 8; i++) { await h.alerts.processPending(); h.advance(7 * 60 * 60_000); }
  const job = [...h.repo.alerts.values()].find((j) => j.kind === 'failed')!;
  assert.equal(job.status, 'dead');
  assert.equal(job.tries, 6);
});

test('the email is safe for odd text in the note, and has no line breaks in the subject', () => {
  const h = setup();
  const m = buildAlertEmail({
    to: 'a@b.co', kind: 'paid', origin: 'https://spendx.example', atMs: T0,
    request: { id: 'r', slug: 's', kind: 'payment', merchantAddress: MERCHANT, merchantFamily: 'evm', destAssetId: 'x', destBlockchain: 'base', destSymbol: 'US\nDC', destDecimals: 6, amount: 1_000_000n, recipient: MERCHANT, description: '<script>alert(1)</script>\r\nBcc: evil@x.com', status: 'paid', createdAt: '' },
    attempt: { originSymbol: 'SOL', originBlockchain: 'sol', originDecimals: 9, amountIn: 10707496n } as never,
  });
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('&lt;script&gt;'));
  void h;
});

test('the email providers get the right request and failures do not leak addresses', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 201 }); }) as unknown as typeof fetch;
  const msg = { to: 'shop@example.com', subject: 'S', text: 'T', html: '<p>T</p>' };
  await createEmailer({ provider: 'brevo', apiKey: 'KEY', fromEmail: 'alerts@x.com', fromName: 'SpendX' }, ok).send(msg);
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal((calls[0].init.headers as Record<string, string>)['api-key'], 'KEY');
  assert.deepEqual(JSON.parse(calls[0].init.body as string).to, [{ email: 'shop@example.com' }]);
  await createEmailer({ provider: 'resend', apiKey: 'KEY', fromEmail: 'alerts@x.com', fromName: 'SpendX' }, ok).send(msg);
  assert.equal(calls[1].url, 'https://api.resend.com/emails');
  assert.equal((calls[1].init.headers as Record<string, string>).authorization, 'Bearer KEY');
  const bad = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(() => createEmailer({ provider: 'brevo', apiKey: 'KEY', fromEmail: 'a@x.com', fromName: 'S' }, bad).send(msg), (e: Error) => /401/.test(e.message) && !e.message.includes('shop@example.com') && !e.message.includes('KEY'));
});

test('API: alert routes need a session, report when alerts are off, and are rate limited', async () => {
  const h = setup();
  assert.equal((await h.call('GET', '/api/config')).body && ((await h.call('GET', '/api/config')).body as { alerts: boolean }).alerts, true);
  assert.equal((await h.call('GET', '/api/merchant/alerts')).status, 401);
  assert.equal((await h.call('POST', '/api/merchant/alerts/email', { email: 'a@b.co' })).status, 401);
  assert.equal((await h.call('POST', '/api/merchant/alerts/verify', { code: '123456' }, { authorization: 'Bearer fake.token' })).status, 401);
  const auth = await h.login();
  const sent = await h.call('POST', '/api/merchant/alerts/email', { email: 'shop@example.com' }, auth);
  assert.equal(sent.status, 200);
  assert.equal((await h.call('POST', '/api/merchant/alerts/verify', { code: h.lastCode() }, auth)).status, 200);
  const st = (await h.call('GET', '/api/merchant/alerts', undefined, auth)).body as { verified: boolean; email: string };
  assert.deepEqual([st.verified, st.email], [true, 'shop@example.com']);
  assert.equal((await h.call('POST', '/api/merchant/alerts/remove', {}, auth)).status, 200);
  assert.equal(((await h.call('GET', '/api/merchant/alerts', undefined, auth)).body as { verified: boolean }).verified, false);
  for (let i = 0; i < 4; i++) assert.equal((await h.call('POST', '/api/merchant/alerts/email', { email: 'nope' }, auth)).status, 400);
  assert.equal((await h.call('POST', '/api/merchant/alerts/email', { email: 'nope' }, auth)).status, 429);

  const off = setup({ alertsOn: false });
  const offAuth = await off.login();
  assert.equal(((await off.call('GET', '/api/config')).body as { alerts: boolean }).alerts, false);
  assert.deepEqual((await off.call('GET', '/api/merchant/alerts', undefined, offAuth)).body, { enabled: false });
  assert.equal((await off.call('POST', '/api/merchant/alerts/email', { email: 'a@b.co' }, offAuth)).status, 503);
});

test('config: email settings are all-or-nothing, checked, and cleaned', () => {
  const base = { SESSION_SECRET: 's'.repeat(32), REPOSITORY: 'memory' };
  assert.equal(loadConfig(base).email, undefined);
  assert.deepEqual(loadConfig({ ...base, EMAIL_API_KEY: 'k', EMAIL_FROM: 'alerts@shop.com' }).email, { provider: 'brevo', apiKey: 'k', fromEmail: 'alerts@shop.com', fromName: 'SpendX' });
  assert.equal(loadConfig({ ...base, EMAIL_API_KEY: 'k', EMAIL_FROM: 'a@shop.com', EMAIL_PROVIDER: 'RESEND', EMAIL_FROM_NAME: 'My <Shop>\r\nBcc: x' }).email!.fromName, 'My ShopBcc: x');
  assert.throws(() => loadConfig({ ...base, EMAIL_API_KEY: 'k' }), /both EMAIL_API_KEY and EMAIL_FROM/);
  assert.throws(() => loadConfig({ ...base, EMAIL_FROM: 'a@shop.com' }), /both EMAIL_API_KEY and EMAIL_FROM/);
  assert.throws(() => loadConfig({ ...base, EMAIL_API_KEY: 'k', EMAIL_FROM: 'a@shop.com', EMAIL_PROVIDER: 'mailgun' }), /brevo or resend/);
  assert.throws(() => loadConfig({ ...base, EMAIL_API_KEY: 'k', EMAIL_FROM: 'not an email' }), /plain email address/);
});
