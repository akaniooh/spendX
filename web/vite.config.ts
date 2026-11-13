import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Run the API (npm start, port 8787) in one terminal and this dev server (npm run dev) in another.
export default defineConfig({
  root: 'web',
  // Read VITE_* settings (like VITE_SOLANA_RPC_URL) from the project's .env, not from web/.env. Only VITE_-prefixed names reach the browser; server secrets never do.
  envDir: '..',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
