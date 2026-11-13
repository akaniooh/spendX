// Usage: npm run db:check   (or: node --env-file=.env scripts/db-check.ts)
import { createClient } from '@supabase/supabase-js';
import { checkDatabase } from '../server/src/db-check.ts';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env (see README, "Set up Supabase").');
  process.exit(1);
}

const { ok, problems } = await checkDatabase(createClient(url, key, { auth: { persistSession: false } }) as never);
if (ok) {
  console.log('Supabase is ready: both tables exist with the expected columns, and the server key can reach them.');
} else {
  console.error('Supabase is not ready:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
