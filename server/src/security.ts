// Response headers for the website and API.
//
// Always enforced (they cannot break the app): no framing, no plugins, no <base> tricks, forms only post to ourselves.
// The resource policy (what scripts, styles and connections the page may use) starts as REPORT-ONLY: wallet libraries
// load code and open connections in ways that are easy to get wrong, so run the app, check the browser console for
// "Content-Security-Policy-Report-Only" messages, and set CSP_ENFORCE=1 once it is quiet.

const ALWAYS = ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"];

const RESOURCES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https: wss:", // wallets and RPC providers: any https host, but no plain http
  'frame-src https:',                // some wallets open their own page in a frame
];

export function securityHeaders(o: { production: boolean; enforceCsp: boolean }): Record<string, string> {
  const h: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy': (o.enforceCsp ? [...RESOURCES, ...ALWAYS] : ALWAYS).join('; '),
  };
  if (!o.enforceCsp) h['Content-Security-Policy-Report-Only'] = [...RESOURCES, ...ALWAYS].join('; ');
  // Only meaningful (and only honoured by browsers) over https, which production should be.
  if (o.production) h['Strict-Transport-Security'] = 'max-age=15552000; includeSubDomains';
  return h;
}
