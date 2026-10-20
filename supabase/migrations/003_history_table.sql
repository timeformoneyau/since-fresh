-- Migration 003 — history entries in their own table, change times set by the
-- server (sync plan, PR 2)
--
-- RUN ORDER: run this before installing the build that syncs history entries
-- separately (sync plan, PR 3). Builds before that ignore everything here, so
-- it is safe to run at any time.
--
-- Additive only, so older builds and rollbacks keep working:
--   - public.items keeps every column, including history (jsonb). Older builds
--     go on reading and writing it unchanged.
--   - New columns have defaults, so an older build's upsert, which doesn't
--     send them, still succeeds.
--
-- What it adds:
--   1. items.server_updated_at: set by the database on every insert and
--      update, never by the app. Pulls use it as their cursor, so a phone's
--      clock never decides what changed.
--   2. items.kind: 'task' for everything today; room to tell food items apart
--      later. Existing rows become 'task' (removed food items can't be told
--      apart any more).
--   3. public.completion_events: one row per history entry, so two phones
--      adding entries to the same item both keep them. Entries are soft
--      deleted (deleted_at) so a removal reaches other phones. created_by and
--      created_at can't be changed after the entry is written.
--
-- One transaction, safe to re-run: each step checks the current state first.

begin;

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

commit;
