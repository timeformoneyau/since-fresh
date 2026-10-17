-- Since app — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Describes the final state for a fresh project. An existing project applies
-- the changes in supabase/migrations/ instead (002_composite_keys.sql moves
-- items to the (user_id, id) key and drops the food-tracking columns).
--
-- Mirrors the SinceItem model in src/types/index.ts; history holds the
-- completion log.

-- Item ids are unique per account, not globally: the key is (user_id, id), so
-- two accounts can hold the same id. The app's upsert names (user_id, id) as
-- its conflict target.
create table if not exists public.items (
  id             text        not null,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  name           text        not null,
  category       text        not null default 'Other',
  last_done_date text        not null,
  history        jsonb       not null default '[]'::jsonb,
  repeat_value   integer,
  repeat_unit    text        check (repeat_unit in ('days', 'weeks', 'months', 'years')),
  created_at     timestamptz not null,
  updated_at     timestamptz not null,
  constraint items_pkey primary key (user_id, id)
);

-- Pull-by-timestamp support for incremental sync
create index if not exists items_user_updated_idx
  on public.items (user_id, updated_at desc);

-- Tombstones. Without these, a delete made on one device is resurrected by
-- the next pull from another device that still holds the item.
create table if not exists public.deleted_items (
  id         text        not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  primary key (id, user_id)
);

create index if not exists deleted_items_user_idx
  on public.deleted_items (user_id, deleted_at desc);

-- Row-level security: users can only access their own rows
alter table public.items enable row level security;
alter table public.deleted_items enable row level security;

drop policy if exists "users_own_items" on public.items;
create policy "users_own_items"
  on public.items
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users_own_deletions" on public.deleted_items;
create policy "users_own_deletions"
  on public.deleted_items
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Allow authenticated users to delete their own auth account
-- (cascades to items and tombstones via foreign key)
create or replace function public.delete_user()
returns void
language sql
security definer
set search_path = public
as $$
  delete from auth.users where id = auth.uid();
$$;

grant execute on function public.delete_user() to authenticated;
