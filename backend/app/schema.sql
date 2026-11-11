-- ShopPilot schema for Supabase Postgres. Safe to run repeatedly.

create table if not exists categories (
  slug        text primary key,
  name        text not null,
  singular    text not null,
  key_specs   text[] not null default '{}',
  specs       jsonb not null default '[]'::jsonb,   -- spec definitions (label, unit, type, better)
  sort_order  integer not null default 0
);

create table if not exists products (
  id            text primary key,
  category      text not null references categories(slug),
  name          text not null,
  brand         text not null,
  price         numeric(10, 2) not null check (price >= 0),
  currency      text not null default 'USD',
  rating        numeric(2, 1) not null check (rating between 0 and 5),
  review_count  integer not null default 0,
  stock         integer not null default 0 check (stock >= 0),
  description   text not null,
  specs         jsonb not null default '{}'::jsonb,  -- category-specific specs
  tags          text[] not null default '{}',        -- use cases: gaming, travel, student…
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists products_category_price_idx on products (category, price);
create index if not exists products_specs_idx on products using gin (specs);
create index if not exists products_tags_idx on products using gin (tags);

-- Product photo + photographer credit (Unsplash). Added after launch, so it's an
-- alter that is also safe on databases created before photos existed.
alter table products add column if not exists image_url text;
alter table products add column if not exists image_credit text;
alter table products add column if not exists image_credit_url text;

-- One row per shopping request, with what the AI understood and what it recommended.
create table if not exists missions (
  id           text primary key,
  query        text not null,
  intent       jsonb,
  result       jsonb,
  status       text not null default 'running' check (status in ('running', 'done', 'error')),
  intent_engine text,
  explain_engine text,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);

create table if not exists mission_steps (
  id           bigserial primary key,
  mission_id   text not null references missions(id) on delete cascade,
  agent        text not null,
  message      text not null,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);
create index if not exists mission_steps_mission_idx on mission_steps (mission_id);

create table if not exists recommendations (
  id           bigserial primary key,
  mission_id   text not null references missions(id) on delete cascade,
  product_id   text not null references products(id),
  rank         integer not null,
  score        integer not null,
  breakdown    jsonb not null,
  reasons      jsonb not null,
  tradeoffs    jsonb not null,
  over_budget  boolean not null default false
);
create index if not exists recommendations_mission_idx on recommendations (mission_id);

-- Payments. The amount always comes from products.price on the server.
create table if not exists orders (
  id                 text primary key,
  paypal_order_id    text not null unique,
  capture_id         text,
  product_id         text not null references products(id),
  mission_id         text references missions(id) on delete set null,
  amount             numeric(10, 2) not null,
  currency           text not null default 'USD',
  status             text not null default 'CREATED' check (status in ('CREATED', 'COMPLETED', 'FAILED')),
  payment_mode       text not null default 'sandbox',   -- sandbox | simulated
  paypal_response    jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists orders_created_idx on orders (created_at desc);

-- Lock every table to the public Supabase API (anon / publishable keys).
-- The backend connects as the database owner, which is not affected by RLS.
alter table categories      enable row level security;
alter table products        enable row level security;
alter table missions        enable row level security;
alter table mission_steps   enable row level security;
alter table recommendations enable row level security;
alter table orders          enable row level security;
