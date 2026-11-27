// Sends one email through a provider's web API. No extra packages: just fetch.
// Two providers are supported so a merchant-facing app can start for free:
//  - Brevo: free plan, and you can send from a single verified email address (no domain needed).
//  - Resend: free plan, but sending to anyone other than yourself needs a domain you own and have verified.

export interface EmailMessage { to: string; subject: string; text: string; html: string }
export interface Emailer { send(m: EmailMessage): Promise<void> }
export interface EmailConfig { provider: 'brevo' | 'resend'; apiKey: string; fromEmail: string; fromName: string; timeoutMs?: number }

export function createEmailer(c: EmailConfig, fetchFn: typeof fetch = fetch): Emailer {
  return {
    async send(m) {
      const signal = AbortSignal.timeout(c.timeoutMs ?? 10_000);
      const res = c.provider === 'brevo'
        ? await fetchFn('https://api.brevo.com/v3/smtp/email', {
            method: 'POST', signal,
            headers: { 'api-key': c.apiKey, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sender: { name: c.fromName, email: c.fromEmail }, to: [{ email: m.to }], subject: m.subject, textContent: m.text, htmlContent: m.html }),
          })
        : await fetchFn('https://api.resend.com/emails', {
            method: 'POST', signal,
            headers: { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ from: `${c.fromName} <${c.fromEmail}>`, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
          });
      // Never include the address we were sending to, or the key, in an error that ends up in the logs.
      if (!res.ok) throw new Error(`Email provider answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    },
  };
}
