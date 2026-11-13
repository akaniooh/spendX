// Small pieces of the HTTP layer that are easy to get subtly wrong, kept apart from the server entry point so they can be tested.

interface ResLike {
  headersSent: boolean;
  status(code: number): { json(body: unknown): void };
}

/** Express error handler: any failure (bad JSON, oversized body, a bug) becomes the same JSON error shape as the API's own errors. */
export function jsonErrorHandler(log: (message: string, error?: unknown) => void) {
  return (err: unknown, _req: unknown, res: ResLike, next: (e?: unknown) => void): void => {
    if (res.headersSent) return next(err);
    const type = (err as { type?: string } | null)?.type;
    if (type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'invalid_body', message: 'Request body is not valid JSON' } });
    } else if (type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'invalid_body', message: 'Request body is too large' } });
    } else {
      log('Unhandled HTTP error', err);
      res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on our side' } });
    }
  };
}

/**
 * One line per API request. Uses the ROUTE PATTERN ("/api/attempts/:id"), never the real path: attempt ids work as
 * bearer secrets, so they must not end up in logs. Returns undefined for requests that should not be logged.
 */
export function accessLogLine(r: { method: string; path: string; route?: string; status: number; ms: number }): string | undefined {
  if (!r.path.startsWith('/api/') || r.path === '/api/health') return undefined;
  return `${r.method} ${r.route ?? '(unmatched)'} ${r.status} ${r.ms}ms`;
}
