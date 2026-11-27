-- Merchant email alerts. Run in the Supabase SQL editor after 0001 and 0002.
-- Same rule as the other tables: Row Level Security on, NO policies, so only the server (service-role key) can touch them.

-- One alert email per merchant wallet. A wallet has no email of its own, so the merchant adds one and proves it is theirs
-- with a code we email. `merchant_key` is the wallet address, lower-cased for EVM so checksum case never splits it.
create table if not exists merchant_contacts (
  merchant_key text primary key,
  email text not null check (length(email) <= 254),
  verified_at timestamptz,                    -- null until the code is confirmed; no alerts before that
  code_hash text,                             -- HMAC of the emailed code, never the code itself
  code_expires_at timestamptz,
  code_attempts int not null default 0,
  last_code_at timestamptz,
  code_sends int not null default 0,          -- codes sent in the current hour
  code_window_start timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Emails waiting to go out. A job is saved the moment a payment changes state, then sent by the background job, so
-- a restart (or Render's free plan sleeping) delays an alert but never loses it.
create table if not exists alert_outbox (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references payment_attempts(id) on delete cascade,
  request_id uuid not null,
  merchant_key text not null,
  kind text not null check (kind in ('paid', 'failed', 'refunded')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'dead')),
  tries int not null default 0,
  next_try_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (attempt_id, kind)                   -- one alert per payment outcome, however many times it is checked
);

create index if not exists alert_outbox_due_idx on alert_outbox (status, next_try_at);

alter table merchant_contacts enable row level security;
alter table alert_outbox enable row level security;
