-- SpendX schema. Run in the Supabase SQL editor (or `supabase db push`).
-- Row Level Security is enabled with NO policies: the anon/public key can read nothing.
-- Only the backend, using the service-role key (server-side only), can access these tables.

create extension if not exists pgcrypto;

create table if not exists payment_requests (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                 -- unguessable id used in the payment link
  kind text not null default 'payment' check (kind in ('payment', 'swap')),
  merchant_address text not null,            -- wallet that created the request
  merchant_family text not null,             -- 'evm' | 'svm' | ...
  dest_asset_id text not null,               -- 1Click assetId, never a symbol
  dest_blockchain text not null,
  dest_symbol text not null,
  dest_decimals int not null check (dest_decimals >= 0),
  amount_base_units text not null check (amount_base_units ~ '^[1-9][0-9]*$'),  -- text: JSON numbers would lose precision
  recipient text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists payment_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references payment_requests(id) on delete restrict,
  origin_asset_id text not null,
  origin_blockchain text not null,
  origin_symbol text not null,
  origin_decimals int not null,
  payer_address text not null,
  payer_family text not null,
  deposit_address text unique,               -- from the live quote; also the key for /v0/status
  deposit_memo text,
  quote jsonb not null,                      -- full 1Click quote response, kept for dispute resolution
  quote_signature text,
  quote_deadline timestamptz,
  amount_in text not null check (amount_in ~ '^[1-9][0-9]*$'),  -- text for the same reason
  wallet_signed boolean not null default false,
  source_tx_hash text,
  source_tx_url text,
  oneclick_status text,
  state text not null default 'awaiting_payment' check (state in (
    'awaiting_payment', 'payment_initiated', 'source_submitted', 'processing',
    'destination_confirmed', 'incomplete_deposit', 'refunded', 'failed',
    'expired', 'needs_review', 'cancelled'
  )),
  verification text not null default 'pending'
    check (verification in ('pending', 'verified', 'reported', 'mismatch')),
  dest_txs jsonb not null default '[]'::jsonb,   -- [{hash, explorerUrl}] from 1Click status
  near_tx_hashes jsonb not null default '[]'::jsonb,
  intent_hashes jsonb not null default '[]'::jsonb,
  refund jsonb,                              -- {amount, amountFormatted, reason} when refunded
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Duplicate-payment guard: a request can have only ONE live attempt. An attempt stops counting
-- once it ends in failed / refunded / expired / cancelled, which frees the request for a retry.
-- 'destination_confirmed' is deliberately NOT excluded, so a paid request can never be paid twice.
create unique index if not exists one_live_attempt_per_request
  on payment_attempts (request_id)
  where state not in ('failed', 'refunded', 'expired', 'cancelled');

create index if not exists payment_requests_merchant_idx on payment_requests (merchant_address, created_at desc);
create index if not exists payment_attempts_request_idx on payment_attempts (request_id);

alter table payment_requests enable row level security;
alter table payment_attempts enable row level security;
