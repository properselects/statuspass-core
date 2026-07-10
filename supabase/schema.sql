-- StatusPass schema. Run in the Supabase SQL editor (or supabase db push).
-- Rules are data, not code: defaults/overrides are JSONB RuleSet objects.

create table if not exists accounts (
  id                 text primary key,
  name               text not null,
  defaults           jsonb not null default '{}'::jsonb,
  internal_names     text[] not null default '{}',
  email              text unique,
  password_hash      text,
  tier               text not null default 'free' check (tier in ('free','solo','studio','agency')),
  stripe_customer_id text
);

create table if not exists profile_configs (
  account_id text not null references accounts(id),
  profile    text not null check (profile in ('internal-program','client-delivery')),
  overrides  jsonb not null default '{}'::jsonb,
  primary key (account_id, profile)
);

create table if not exists passes (
  id              text primary key,
  account_id      text not null references accounts(id),
  profile         text not null check (profile in ('internal-program','client-delivery')),
  recipient_label text not null,
  board_id        text not null,
  current_phase   text not null,
  current_rag     text check (current_rag in ('green','yellow','red')),
  primary_link    jsonb,
  last_updated_at timestamptz not null default now(),
  last_push_at    timestamptz,
  overrides       jsonb not null default '{}'::jsonb,
  vendor_serial   text,           -- WalletWallet serial after issuance
  add_url         text,           -- hosted add-to-wallet page
  active          boolean not null default true
);
create index if not exists passes_active_idx on passes (active) where active;

create table if not exists card_index (
  board_id text not null,
  card_id  text not null,
  pass_id  text not null references passes(id),
  primary key (board_id, card_id)
);

create table if not exists branding (
  pass_id        text primary key references passes(id),
  title          text not null default '',
  operator_name  text not null default '',
  brand_color    text,
  logo_asset_id  text,
  strip_asset_id text,
  completed_at   timestamptz
);

create table if not exists deliverables (
  id       text primary key,
  pass_id  text not null references passes(id),
  kind     text not null check (kind in ('image','link')),
  title    text not null,
  asset_id text,
  url      text,
  added_at timestamptz not null default now()
);
create index if not exists deliverables_pass_idx on deliverables (pass_id);

create table if not exists assets (
  id           text primary key,
  content_type text not null
);

-- Storage bucket for branding images (public read so the wallet vendor can
-- fetch logoUrl/stripImageUrl; ids are UUIDs, not guessable).
insert into storage.buckets (id, name, public)
values ('branding-assets', 'branding-assets', true)
on conflict (id) do nothing;
