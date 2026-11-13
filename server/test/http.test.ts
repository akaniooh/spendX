import { test } from 'node:test';
import assert from 'node:assert/strict';
import { securityHeaders } from '../src/security.ts';
import { accessLogLine, jsonErrorHandler } from '../src/http.ts';

test('security headers: framing and plugins are blocked always; the resource policy is report-only until you enforce it', () => {
  const dev = securityHeaders({ production: false, enforceCsp: false });
  assert.equal(dev['X-Frame-Options'], 'DENY');
  assert.equal(dev['X-Content-Type-Options'], 'nosniff');
  assert.match(dev['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(dev['Content-Security-Policy'], /object-src 'none'/);
  assert.doesNotMatch(dev['Content-Security-Policy'], /script-src/, 'script rules are not enforced yet');
  assert.match(dev['Content-Security-Policy-Report-Only'], /script-src 'self'/);
  assert.equal(dev['Strict-Transport-Security'], undefined, 'no HSTS outside production');

  const prod = securityHeaders({ production: true, enforceCsp: true });
  assert.match(prod['Strict-Transport-Security'], /max-age=\d+/);
  assert.match(prod['Content-Security-Policy'], /script-src 'self'/);
  assert.match(prod['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(prod['Content-Security-Policy-Report-Only'], undefined, 'enforced: no separate report-only copy');
  assert.doesNotMatch(prod['Content-Security-Policy'], /unsafe-eval|script-src[^;]*unsafe-inline/, 'scripts never get unsafe-inline or eval');
});

test('error handler: bad JSON and oversized bodies get a clear JSON error, anything else is a generic 500 that is logged', () => {
  const logged: unknown[] = [];
  const handler = jsonErrorHandler((_m, e) => logged.push(e));
  const run = (err: unknown, headersSent = false) => {
    const out: { status?: number; body?: any; passed?: unknown } = {};
    const res = { headersSent, status: (c: number) => { out.status = c; return { json: (b: unknown) => { out.body = b; } }; } };
    handler(err, {}, res, (e) => { out.passed = e; });
    return out;
  };
  assert.deepEqual(run({ type: 'entity.parse.failed' }), { status: 400, body: { error: { code: 'invalid_body', message: 'Request body is not valid JSON' } } });
  assert.equal(run({ type: 'entity.too.large' }).status, 413);
  const boom = new Error('secret internals');
  const r = run(boom);
  assert.equal(r.status, 500);
  assert.equal(JSON.stringify(r.body).includes('secret internals'), false, 'internals are never sent to the client');
  assert.deepEqual(logged, [boom]);
  assert.equal(run(boom, true).passed, boom, 'if a response already started, hand it back to express');
});

test('access log: shows the route pattern, never the real path (attempt ids are secrets), and skips non-API and health checks', () => {
  assert.equal(accessLogLine({ method: 'GET', path: '/api/attempts/3f2b9c1e-aaaa', route: '/api/attempts/:id', status: 200, ms: 12 }), 'GET /api/attempts/:id 200 12ms');
  assert.equal(accessLogLine({ method: 'GET', path: '/api/nope', status: 404, ms: 1 }), 'GET (unmatched) 404 1ms');
  assert.equal(accessLogLine({ method: 'GET', path: '/api/health', route: '/api/health', status: 200, ms: 1 }), undefined);
  assert.equal(accessLogLine({ method: 'GET', path: '/assets/app.js', status: 200, ms: 1 }), undefined);
  assert.doesNotMatch(accessLogLine({ method: 'GET', path: '/api/attempts/SECRET-ID', route: '/api/attempts/:id', status: 200, ms: 1 })!, /SECRET/);
});
