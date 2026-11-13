// Verifies a Supabase project is set up for SpendX: the tables exist, the latest columns exist, and the
// server's key can reach them. Read-only: it never writes or deletes anything.

interface QueryResult { error: { message: string } | null }
export interface DbLike { from(table: string): { select(cols: string): { limit(n: number): PromiseLike<QueryResult> } } }

export async function checkDatabase(db: DbLike): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  const probe = async (table: string, cols: string, hint: string) => {
    let res: QueryResult;
    try { res = await db.from(table).select(cols).limit(1); }
    catch (e) { problems.push(`${table}: could not reach the database (${(e as Error).message})`); return; }
    if (res.error) problems.push(`${table} (${cols}): ${res.error.message}. ${hint}`);
  };
  const migrate = 'Run supabase/migrations/0001_init.sql in the Supabase SQL editor.';
  await probe('payment_requests', 'id', migrate);
  await probe('payment_attempts', 'id', migrate);
  // columns added after the first draft of the schema: an older copy of the migration will be missing them
  await probe('payment_requests', 'kind', 'This is an older schema: re-run the latest 0001_init.sql (drop the old tables first if they hold no data you need).');
  await probe('payment_attempts', 'wallet_signed', 'This is an older schema: re-run the latest 0001_init.sql (drop the old tables first if they hold no data you need).');
  return { ok: problems.length === 0, problems };
}
