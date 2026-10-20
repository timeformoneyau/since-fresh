-- Since app — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Describes the final state for a fresh project. An existing project applies
-- the changes in supabase/migrations/ instead (002_composite_keys.sql moves
-- items to the (user_id, id) key and drops the food-tracking columns;
-- 003_history_table.sql adds completion_events, server_updated_at and kind).
-- supabase/tests/ checks that both routes end in the same schema.
--
-- Mirrors the SinceItem model in src/types/index.ts. items.history holds the
-- completion log for older builds; completion_events holds it one row per
-- entry, for sync that keeps every entry.

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

-- ════ History entries and server change times (migration 003) ════════════

-- ─── Shared trigger: the server owns server_updated_at ──────────────────────
create or replace function public.set_server_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

-- ─── 1. items.server_updated_at ────────────────────────────────────────────
alter table public.items
  add column if not exists server_updated_at timestamptz not null default now();

drop trigger if exists items_server_updated_at on public.items;
create trigger items_server_updated_at
  before insert or update on public.items
  for each row execute function public.set_server_updated_at();

create index if not exists items_user_server_updated_idx
  on public.items (user_id, server_updated_at);

-- ─── 2. items.kind ──────────────────────────────────────────────────────────
alter table public.items
  add column if not exists kind text not null default 'task';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.items'::regclass and conname = 'items_kind_check'
  ) then
    alter table public.items
      add constraint items_kind_check check (kind in ('task', 'food'));
  end if;
end $$;

-- ─── 3. completion_events ───────────────────────────────────────────────────
-- Keyed by (user_id, item_id, id): entry ids from older builds are only
-- unique within an item (e.g. "<item id>_seed").
create table if not exists public.completion_events (
  user_id           uuid        not null,
  item_id           text        not null,
  id                text        not null,
  date              date        not null,
  note              text,
  created_by        uuid        references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint completion_events_pkey primary key (user_id, item_id, id),
  constraint completion_events_item_fkey foreign key (user_id, item_id)
    references public.items (user_id, id) on delete cascade
);

create index if not exists completion_events_user_server_updated_idx
  on public.completion_events (user_id, server_updated_at);

-- created_by is whoever wrote the entry; created_at is when it was first
-- recorded (the app sends it, in UTC). Neither changes afterwards.
create or replace function public.completion_events_before_write()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists completion_events_before_write on public.completion_events;
create trigger completion_events_before_write
  before insert or update on public.completion_events
  for each row execute function public.completion_events_before_write();

alter table public.completion_events enable row level security;

drop policy if exists "users_own_completion_events" on public.completion_events;
create policy "users_own_completion_events"
  on public.completion_events
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.completion_events to authenticated;
