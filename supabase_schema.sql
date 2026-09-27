-- Run this in the Supabase SQL editor.

create table if not exists tracked_products (
  id uuid primary key default gen_random_uuid(),
  store_product_id text not null,        -- id as shown in the product page URL
  product_name text not null,
  option_label text not null,            -- e.g. "128GB", "Pack of 3"
  product_url text not null,             -- direct URL to the product page
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_product_id, option_label)
);

create table if not exists price_history (
  id bigint generated always as identity primary key,
  tracked_product_id uuid not null references tracked_products(id) on delete cascade,
  scraped_at timestamptz not null default now(),
  price numeric,                         -- null when outcome != 'success'
  stock text,                            -- null when outcome != 'success' ("in_stock" / "out_of_stock" / raw text)
  outcome text not null check (outcome in ('success', 'retried', 'failed')),
  attempt_count int not null default 1,
  error_message text                     -- populated on failure, for debugging
);

create index if not exists idx_price_history_product_time
  on price_history (tracked_product_id, scraped_at desc);

-- Convenience view for the dashboard's latest-price column
create or replace view latest_price as
select distinct on (tracked_product_id)
  tracked_product_id, scraped_at, price, stock, outcome
from price_history
order by tracked_product_id, scraped_at desc;
