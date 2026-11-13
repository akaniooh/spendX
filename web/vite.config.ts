import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Anything VITE_-prefixed is inlined into the public JavaScript bundle, so it must never carry a secret.
// A provider key in the RPC URL (e.g. "?api-key=..." or "/v2/<key>") would be readable by every visitor.
export function rpcUrlProblem(url: string | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return 'it is not a valid URL'; }
  if (u.username || u.password) return 'it contains a username/password';
  const param = [...u.searchParams.keys()].find((k) => /key|token|secret|auth/i.test(k));
  if (param) return `the query parameter "${param}" looks like a credential`;
  if (u.pathname.split('/').some((seg) => /^[A-Za-z0-9_-]{24,}$/.test(seg))) return 'the URL path has a long token-like segment';
  return null;
}

const mask = (url: string) => url.replace(/([?&][^=&]*=)[^&]*/g, '$1***').replace(/\/[A-Za-z0-9_-]{24,}/g, '/***');

// Run the API (npm start, port 8787) in one terminal and this dev server (npm run dev) in another.
export default defineConfig(({ mode }) => {
  // Read VITE_* settings (like VITE_SOLANA_RPC_URL) from the project's .env, not from web/.env. Only VITE_-prefixed names reach the browser; server secrets never do.
  // loadEnv also merges real environment variables, so a value set in the shell counts too.
  const rpc = loadEnv(mode, process.cwd(), 'VITE_').VITE_SOLANA_RPC_URL;
  const problem = rpcUrlProblem(rpc);
  if (problem) {
    throw new Error(
      `VITE_SOLANA_RPC_URL (${mask(rpc!)}) was rejected because ${problem}. ` +
      'VITE_* values are shipped to the browser. Remove it (the public endpoint is the default), or keep the keyed RPC server-side (SOLANA_RPC_URL). ' +
      'Check .env, .env.local, .env.production and your shell environment.',
    );
  }
  return {
    root: 'web',
    envDir: '..',
    plugins: [react()],
    server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
