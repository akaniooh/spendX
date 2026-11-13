-- Speeds up "show me my activity" (GET /api/activity), which looks attempts up by the paying wallet.
create index if not exists payment_attempts_payer_idx
  on payment_attempts (payer_address, created_at desc);
