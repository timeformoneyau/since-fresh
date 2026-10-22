-- Since app — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Describes the final state for a fresh project. An existing project applies
-- the changes in supabase/migrations/ instead (002_composite_keys.sql moves
-- items to the (user_id, id) key and drops the food-tracking columns;
-- 003_history_table.sql adds completion_events, server_updated_at and kind;
-- 004_households.sql adds shared households; 005_looked_after_by.sql adds who
-- looks after a shared item).
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

-- ════ Shared households (migration 004) ════════════════════════════════════

-- ─── Tables ─────────────────────────────────────────────────────────────────
create table if not exists public.households (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null check (length(btrim(name)) between 1 and 60),
  created_by uuid        references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid        not null references public.households(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  role         text        not null check (role in ('owner', 'member')),
  display_name text        not null check (length(btrim(display_name)) between 1 and 40),
  joined_at    timestamptz not null default now(),
  constraint household_members_pkey primary key (household_id, user_id),
  -- Households v1: one household per user
  constraint household_members_one_household unique (user_id)
);

create unique index if not exists household_members_one_owner
  on public.household_members (household_id) where role = 'owner';

create table if not exists public.household_invites (
  code         text        primary key,
  household_id uuid        not null references public.households(id) on delete cascade,
  created_by   uuid        references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  revoked_at   timestamptz
);

alter table public.items
  add column if not exists household_id uuid references public.households(id) on delete set null;
create index if not exists items_household_server_updated_idx
  on public.items (household_id, server_updated_at) where household_id is not null;

alter table public.deleted_items
  add column if not exists household_id uuid references public.households(id) on delete set null;
create index if not exists deleted_items_household_idx
  on public.deleted_items (household_id, deleted_at desc) where household_id is not null;

-- A shared item's owner can move to another member (leaving, removal,
-- account deletion), so entries follow the item's key.
alter table public.completion_events drop constraint if exists completion_events_item_fkey;
alter table public.completion_events
  add constraint completion_events_item_fkey foreign key (user_id, item_id)
    references public.items (user_id, id) on delete cascade on update cascade;

create table if not exists public.item_mutes (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  owner_id   uuid        not null,
  item_id    text        not null,
  created_at timestamptz not null default now(),
  constraint item_mutes_pkey primary key (user_id, owner_id, item_id),
  constraint item_mutes_item_fkey foreign key (owner_id, item_id)
    references public.items (user_id, id) on delete cascade on update cascade
);

-- Who wrote an entry still can't be changed, but it can be cleared: when an
-- account is deleted, its entries on other people's shared items stay, with
-- created_by set to null (the foreign key's "on delete set null").
create or replace function public.completion_events_before_write()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := case when new.created_by is null then null else old.created_by end;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- ─── Helpers (security definer, so access rules can use them without
--     recursing through the membership table's own rules) ─────────────────
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from household_members where household_id = hid and user_id = auth.uid()
  );
$$;

create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from household_members
    where household_id = hid and user_id = auth.uid() and role = 'owner'
  );
$$;

-- Whether the signed-in user may see an item: their own, or shared with
-- their household.
create or replace function public.can_access_item(owner uuid, iid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select owner = auth.uid() or exists (
    select 1 from items i
    where i.user_id = owner and i.id = iid
      and i.household_id is not null and public.is_household_member(i.household_id)
  );
$$;

-- ─── Items: who may change what ─────────────────────────────────────────────
-- An item's owner (user_id) never changes from the app; only the functions
-- below move it, when a member leaves. Whether an item is shared can only be
-- changed by the person who created it.
create or replace function public.items_guard_update()
returns trigger
language plpgsql
as $$
begin
  if current_setting('since.moving_items', true) = 'on' then
    return new;
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'An item''s owner can''t be changed.' using errcode = '42501';
  end if;
  if new.household_id is distinct from old.household_id and old.user_id <> auth.uid() then
    raise exception 'Only the person who added an item can change who it''s for.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists items_guard_update on public.items;
create trigger items_guard_update
  before update on public.items
  for each row execute function public.items_guard_update();

drop policy if exists "users_own_items" on public.items;
drop policy if exists "items_select" on public.items;
drop policy if exists "items_insert" on public.items;
drop policy if exists "items_update" on public.items;
drop policy if exists "items_delete" on public.items;

create policy "items_select" on public.items for select
  using (auth.uid() = user_id or (household_id is not null and public.is_household_member(household_id)));

create policy "items_insert" on public.items for insert
  with check (auth.uid() = user_id and (household_id is null or public.is_household_member(household_id)));

create policy "items_update" on public.items for update
  using (auth.uid() = user_id or (household_id is not null and public.is_household_member(household_id)))
  with check (
    (household_id is null and auth.uid() = user_id)
    or (household_id is not null and public.is_household_member(household_id))
  );

create policy "items_delete" on public.items for delete
  using (auth.uid() = user_id or (household_id is not null and public.is_household_owner(household_id)));

-- ─── Tombstones: a shared item's deletion reaches every member ─────────────
drop policy if exists "users_own_deletions" on public.deleted_items;
drop policy if exists "deleted_items_select" on public.deleted_items;
drop policy if exists "deleted_items_insert" on public.deleted_items;
drop policy if exists "deleted_items_update" on public.deleted_items;
drop policy if exists "deleted_items_delete" on public.deleted_items;

create policy "deleted_items_select" on public.deleted_items for select
  using (auth.uid() = user_id or (household_id is not null and public.is_household_member(household_id)));

create policy "deleted_items_insert" on public.deleted_items for insert
  with check (auth.uid() = user_id or (household_id is not null and public.is_household_owner(household_id)));

create policy "deleted_items_update" on public.deleted_items for update
  using (auth.uid() = user_id or (household_id is not null and public.is_household_owner(household_id)))
  with check (auth.uid() = user_id or (household_id is not null and public.is_household_owner(household_id)));

create policy "deleted_items_delete" on public.deleted_items for delete
  using (auth.uid() = user_id);

-- ─── History entries: follow their item ─────────────────────────────────────
drop policy if exists "users_own_completion_events" on public.completion_events;
drop policy if exists "completion_events_access" on public.completion_events;
create policy "completion_events_access" on public.completion_events for all
  using (public.can_access_item(user_id, item_id))
  with check (public.can_access_item(user_id, item_id));

-- ─── Mutes: each member's own ───────────────────────────────────────────────
alter table public.item_mutes enable row level security;
drop policy if exists "item_mutes_own" on public.item_mutes;
create policy "item_mutes_own" on public.item_mutes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.can_access_item(owner_id, item_id));
grant select, insert, delete on public.item_mutes to authenticated;

-- ─── Households, members, invites: read through rules, change through
--     the functions below ───────────────────────────────────────────────────
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

revoke all on public.households, public.household_members, public.household_invites from anon, authenticated;
grant select on public.households, public.household_members, public.household_invites to authenticated;
grant update (name) on public.households to authenticated;
grant update (display_name) on public.household_members to authenticated;

drop policy if exists "households_select" on public.households;
create policy "households_select" on public.households for select
  using (public.is_household_member(id));
drop policy if exists "households_rename" on public.households;
create policy "households_rename" on public.households for update
  using (public.is_household_owner(id)) with check (public.is_household_owner(id));

drop policy if exists "household_members_select" on public.household_members;
create policy "household_members_select" on public.household_members for select
  using (public.is_household_member(household_id));
drop policy if exists "household_members_own_name" on public.household_members;
create policy "household_members_own_name" on public.household_members for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "household_invites_select" on public.household_invites;
create policy "household_invites_select" on public.household_invites for select
  using (public.is_household_owner(household_id));

-- ─── Membership functions ───────────────────────────────────────────────────
create or replace function public.my_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from household_members where user_id = auth.uid();
$$;

-- Move a member's shared items to the household's owner, so the household
-- keeps them when that member leaves, is removed or deletes their account.
-- Their personal items stay theirs. Entries and mutes follow (on update
-- cascade); entries keep who wrote them.
create or replace function public.hand_over_items(hid uuid, from_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  to_user uuid;
begin
  select user_id into to_user from household_members
  where household_id = hid and role = 'owner' and user_id <> from_user;
  if to_user is null then
    return; -- no one to hand over to
  end if;
  perform set_config('since.moving_items', 'on', true);
  update items set user_id = to_user
  where user_id = from_user and household_id = hid
    and not exists (select 1 from items mine where mine.user_id = to_user and mine.id = items.id);
  -- An id the owner already uses (vanishingly rare): the item becomes the
  -- leaver's personal item rather than being lost
  update items set household_id = null
  where user_id = from_user and household_id = hid;
  perform set_config('since.moving_items', 'off', true);
end;
$$;
revoke all on function public.hand_over_items(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_household(household_name text, my_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if exists (select 1 from household_members where user_id = auth.uid()) then
    raise exception 'You''re already in a household.' using errcode = 'P0001';
  end if;
  insert into households (name, created_by) values (btrim(household_name), auth.uid()) returning id into hid;
  insert into household_members (household_id, user_id, role, display_name)
  values (hid, auth.uid(), 'owner', btrim(my_name));
  return hid;
end;
$$;

-- Codes are 8 characters (shown as XXXX-XXXX), from letters and digits that
-- are hard to mix up when read aloud: no 0/O, 1/I/L.
create or replace function public.create_invite()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  hid uuid := public.my_household_id();
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  raw bytea;
  new_code text;
begin
  if hid is null or not public.is_household_owner(hid) then
    raise exception 'Only the household''s owner can invite people.' using errcode = '42501';
  end if;
  loop
    raw := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    new_code := '';
    for i in 0..7 loop
      new_code := new_code || substr(alphabet, (get_byte(raw, i) % length(alphabet)) + 1, 1);
    end loop;
    exit when not exists (select 1 from household_invites where code = new_code);
  end loop;
  insert into household_invites (code, household_id, created_by) values (new_code, hid, auth.uid());
  return new_code;
end;
$$;

create or replace function public.revoke_invite(invite_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update household_invites set revoked_at = now()
  where code = upper(replace(invite_code, '-', '')) and revoked_at is null
    and public.is_household_owner(household_id);
end;
$$;

create or replace function public.join_household(invite_code text, my_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if exists (select 1 from household_members where user_id = auth.uid()) then
    raise exception 'You''re already in a household.' using errcode = 'P0001';
  end if;
  select household_id into hid from household_invites
  where code = upper(replace(btrim(invite_code), '-', ''))
    and revoked_at is null and expires_at > now();
  if hid is null then
    raise exception 'That code isn''t right or has expired.' using errcode = 'P0002';
  end if;
  insert into household_members (household_id, user_id, role, display_name)
  values (hid, auth.uid(), 'member', btrim(my_name));
  return hid;
end;
$$;

create or replace function public.leave_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid := public.my_household_id();
begin
  if hid is null then
    return;
  end if;
  if public.is_household_owner(hid) then
    raise exception 'Hand the household to someone else first, or delete it.' using errcode = 'P0001';
  end if;
  perform public.hand_over_items(hid, auth.uid());
  delete from item_mutes m using items i
  where m.user_id = auth.uid() and i.user_id = m.owner_id and i.id = m.item_id and i.household_id = hid;
  delete from household_members where household_id = hid and user_id = auth.uid();
end;
$$;

create or replace function public.remove_member(member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid := public.my_household_id();
begin
  if hid is null or not public.is_household_owner(hid) then
    raise exception 'Only the household''s owner can remove people.' using errcode = '42501';
  end if;
  if member = auth.uid() then
    raise exception 'You can''t remove yourself. Delete the household instead.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from household_members where household_id = hid and user_id = member) then
    return;
  end if;
  perform public.hand_over_items(hid, member);
  delete from item_mutes m using items i
  where m.user_id = member and i.user_id = m.owner_id and i.id = m.item_id and i.household_id = hid;
  delete from household_members where household_id = hid and user_id = member;
end;
$$;

create or replace function public.transfer_ownership(new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid := public.my_household_id();
begin
  if hid is null or not public.is_household_owner(hid) then
    raise exception 'Only the household''s owner can hand it over.' using errcode = '42501';
  end if;
  if not exists (select 1 from household_members where household_id = hid and user_id = new_owner and role = 'member') then
    raise exception 'That person isn''t in the household.' using errcode = 'P0002';
  end if;
  update household_members set role = 'member' where household_id = hid and user_id = auth.uid();
  update household_members set role = 'owner' where household_id = hid and user_id = new_owner;
end;
$$;

-- Only when the owner is the last member. Shared items become personal
-- items of whoever added them (items.household_id is set to null).
create or replace function public.delete_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid := public.my_household_id();
begin
  if hid is null or not public.is_household_owner(hid) then
    raise exception 'Only the household''s owner can delete it.' using errcode = '42501';
  end if;
  if exists (select 1 from household_members where household_id = hid and user_id <> auth.uid()) then
    raise exception 'Remove everyone else first.' using errcode = 'P0001';
  end if;
  perform set_config('since.moving_items', 'on', true);
  update items set household_id = null where household_id = hid;
  perform set_config('since.moving_items', 'off', true);
  delete from households where id = hid;
end;
$$;

-- Deleting an account: an owner with other members hands the household to
-- the longest-standing one first; shared items pass to the household's
-- owner. A sole member's household goes with the account, and its shared
-- items, being theirs, go too.
create or replace function public.delete_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid := public.my_household_id();
  heir uuid;
begin
  if hid is not null then
    if public.is_household_owner(hid) then
      select user_id into heir from household_members
      where household_id = hid and user_id <> auth.uid()
      order by joined_at, user_id limit 1;
      if heir is null then
        delete from households where id = hid;
        hid := null;
      else
        update household_members set role = 'member' where household_id = hid and user_id = auth.uid();
        update household_members set role = 'owner' where household_id = hid and user_id = heir;
      end if;
    end if;
    if hid is not null then
      perform public.hand_over_items(hid, auth.uid());
    end if;
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function
  public.create_household(text, text), public.create_invite(), public.revoke_invite(text),
  public.join_household(text, text), public.leave_household(), public.remove_member(uuid),
  public.transfer_ownership(uuid), public.delete_household(), public.delete_user(),
  public.my_household_id()
from public, anon;
grant execute on function
  public.create_household(text, text), public.create_invite(), public.revoke_invite(text),
  public.join_household(text, text), public.leave_household(), public.remove_member(uuid),
  public.transfer_ownership(uuid), public.delete_household(), public.delete_user(),
  public.my_household_id()
to authenticated;

-- ════ Who looks after a shared item (migration 005) ═════════════════════════
-- null is "Anyone". Only a member of the item's household; clears when their
-- membership ends or the item stops being shared. Needs Postgres 15+.

alter table public.items
  add column if not exists looked_after_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.items'::regclass and conname = 'items_looked_after_by_needs_household'
  ) then
    alter table public.items
      add constraint items_looked_after_by_needs_household
        check (looked_after_by is null or household_id is not null);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.items'::regclass and conname = 'items_looked_after_by_fkey'
  ) then
    alter table public.items
      add constraint items_looked_after_by_fkey foreign key (household_id, looked_after_by)
        references public.household_members (household_id, user_id)
        on delete set null (looked_after_by);
  end if;
end $$;

-- For the foreign key: finding a leaving member's items
create index if not exists items_looked_after_by_idx
  on public.items (household_id, looked_after_by) where looked_after_by is not null;

-- An item that changes household (to "Just me", or handed back when its
-- household goes) loses whoever looked after it, unless the same write set
-- it. Runs for every write, including the membership functions'.
create or replace function public.items_looked_after_by_before_write()
returns trigger
language plpgsql
as $$
begin
  if new.household_id is distinct from old.household_id
     and new.looked_after_by is not distinct from old.looked_after_by then
    new.looked_after_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists items_looked_after_by_before_write on public.items;
create trigger items_looked_after_by_before_write
  before update on public.items
  for each row execute function public.items_looked_after_by_before_write();
