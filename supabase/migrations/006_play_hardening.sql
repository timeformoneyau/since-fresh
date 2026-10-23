-- Migration 006 — Play hardening (readiness audit, 23 Oct 2026: Q18, Q21, Q22, Q25)
--
-- RUN ORDER: after 005. Safe to run before any app change: builds already on
-- phones keep working (see "Older builds" below). Needs Postgres 15 or later
-- (as 005).
--
-- Run migrations in order. Re-running an older migration after this one
-- would put back the older versions of the functions below.
--
-- Additive only. What it changes:
--
--   Invites
--   - Removing a member revokes every active invite code for the household,
--     so a removed person can't rejoin with a code they already had. The
--     owner can make a new code at any time ("Invite someone").
--   - Wrong codes are rate-limited. Each failed join is recorded
--     (household_join_failures: RLS on, no client access). More than
--     JOIN_FAILURES_PER_USER (5) failures in 15 minutes and join_household
--     refuses that account; more than JOIN_FAILURES_GLOBAL (100) failures
--     across everyone in 10 minutes and it refuses every account. Both
--     clear on their own as the window moves on.
--   - A wrong code is now *returned* as the same error (HTTP 404, code
--     P0002, same message) rather than raised, so the recorded failure is
--     committed. A raised error would roll it back with the rest of the
--     call. PostgREST turns the returned body into the client's error
--     exactly as it did for the raised one.
--   - New codes are uniform: each character comes from one random byte
--     (from gen_random_uuid(), which uses the server's cryptographic
--     source), skipping the UUID's fixed version and variant bytes, and
--     bytes 248 and above are discarded so every letter is equally likely.
--     Same length (8) and alphabet; existing codes stay valid until they
--     expire.
--   - At most 50 members per household and 50 active invite codes per
--     household.
--
--   Size limits, far above anything the app's screens produce:
--     item name 500 characters, category 100, entry note 5000,
--     items.history 20 000 entries and 10 MiB, 20 000 entries per item
--     (completion_events), 5000 items per account.
--   Enforced by triggers that raise a distinct error, with CHECK constraints
--   behind them: added NOT VALID, then validated. If an existing row already
--   breaks one, that constraint is left out (and a notice says so), so
--   existing data can never stop this migration or make those rows
--   uneditable; the trigger still refuses new values over the limit.
--
--   Account deletion
--   - delete_user() also removes the account's id from items.history on
--     items that stay (their entries keep date and note, unattributed), and
--     purges the account's soft-deleted entries. Every other column that
--     names the account is already cleared or removed by its foreign key.
--   - purge_soft_deleted_history(older_than): removes entries soft-deleted
--     longer ago than older_than (90 days at least). For scheduling later;
--     no app or signed-in user can call it.
--
--   Tombstones
--   - A household owner can still record the deletion of any item in their
--     household, but can no longer write a tombstone naming an account and
--     item that exist outside their household.
--
-- Errors. Every new error carries a stable identifier in its hint, for the
-- app to map. Errors from database functions the app calls directly use
-- P0001 so that builds already on phones show the message as written (they
-- show P0001 messages verbatim); errors on synced writes have their own
-- SQLSTATE:
--   P0001 since_join_rate_limited   too many wrong codes from this account
--   P0001 since_join_busy           too many wrong codes from everyone
--   P0001 since_household_full      50 members already
--   P0001 since_too_many_invites    50 active codes already
--   P0001 since_purge_too_soon      purge_soft_deleted_history under 90 days
--   SN001 since_item_name_too_long
--   SN002 since_item_category_too_long
--   SN003 since_history_too_many_entries
--   SN004 since_history_too_large
--   SN005 since_note_too_long
--   SN006 since_too_many_entries    (per item)
--   SN007 since_too_many_items      (per account)
--
-- Older builds. Nothing they send changes shape. A wrong invite code gives
-- them the same error as before. A limit can only refuse a write far beyond
-- what their screens allow; if one is ever hit during sync, that change
-- stays in the phone's sync queue and the sync fails each time until a
-- newer build handles it (see the PR's apply notes).
--
-- One transaction, safe to re-run: each step checks the current state first.

begin;

-- ─── Failed join attempts ───────────────────────────────────────────────────
create table if not exists public.household_join_failures (
  id        bigint      generated always as identity primary key,
  user_id   uuid        not null references auth.users(id) on delete cascade,
  failed_at timestamptz not null default now()
);
create index if not exists household_join_failures_user_idx
  on public.household_join_failures (user_id, failed_at);
create index if not exists household_join_failures_time_idx
  on public.household_join_failures (failed_at);

-- Only the database functions below read or write it
alter table public.household_join_failures enable row level security;
revoke all on public.household_join_failures from public, anon, authenticated;

-- ─── Invite codes: uniform, from a cryptographic source ─────────────────────
-- gen_random_uuid() (core Postgres, pg_strong_random) gives 16 bytes, of
-- which bytes 6 and 8 carry the fixed version and variant bits: they're
-- skipped. A byte is used only below 248 (= 31 × 8), so byte % 31 is uniform
-- over the alphabet. On average about 1.03 bytes per character.
create or replace function public.random_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  raw bytea;
  b int;
  code text := '';
begin
  while length(code) < 8 loop
    raw := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    for i in 0..15 loop
      continue when i = 6 or i = 8;
      b := get_byte(raw, i);
      continue when b >= 248;
      code := code || substr(alphabet, (b % 31) + 1, 1);
      exit when length(code) = 8;
    end loop;
  end loop;
  return code;
end;
$$;
revoke all on function public.random_invite_code() from public, anon, authenticated;

create or replace function public.create_invite()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  hid uuid := public.my_household_id();
  new_code text;
begin
  if hid is null or not public.is_household_owner(hid) then
    raise exception 'Only the household''s owner can invite people.' using errcode = '42501';
  end if;
  if (select count(*) from household_invites
      where household_id = hid and revoked_at is null and expires_at > now()) >= 50 then
    raise exception 'There are already 50 invite codes waiting to be used. They stop working after 7 days.'
      using errcode = 'P0001', hint = 'since_too_many_invites';
  end if;
  loop
    new_code := public.random_invite_code();
    exit when not exists (select 1 from household_invites where code = new_code);
  end loop;
  insert into household_invites (code, household_id, created_by) values (new_code, hid, auth.uid());
  return new_code;
end;
$$;

-- ─── Joining: rate-limited ──────────────────────────────────────────────────
-- The return type changes (uuid → json) so a wrong code can be returned as an
-- error with the failure committed; the signature apps call is unchanged.
drop function if exists public.join_household(text, text);
create function public.join_household(invite_code text, my_name text)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  hid uuid;
  per_user_limit  constant int := 5;
  per_user_window constant interval := interval '15 minutes';
  global_limit    constant int := 100;
  global_window   constant interval := interval '10 minutes';
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if exists (select 1 from household_members where user_id = auth.uid()) then
    raise exception 'You''re already in a household.' using errcode = 'P0001';
  end if;

  -- Old failures are no longer needed by either window
  delete from household_join_failures where failed_at < now() - interval '1 day';

  if (select count(*) from household_join_failures
      where user_id = auth.uid() and failed_at > now() - per_user_window) >= per_user_limit then
    raise exception 'Too many codes that didn''t work. Wait 15 minutes, then try again.'
      using errcode = 'P0001', hint = 'since_join_rate_limited';
  end if;
  if (select count(*) from household_join_failures
      where failed_at > now() - global_window) >= global_limit then
    raise exception 'Joining is paused for a few minutes. Please try again later.'
      using errcode = 'P0001', hint = 'since_join_busy';
  end if;

  select household_id into hid from household_invites
  where code = upper(replace(btrim(invite_code), '-', ''))
    and revoked_at is null and expires_at > now();

  if hid is null then
    insert into household_join_failures (user_id) values (auth.uid());
    -- Same response PostgREST gives for a raised P0002 (HTTP 404), without
    -- rolling back the failure just recorded
    perform set_config('response.status', '404', true);
    return json_build_object(
      'code', 'P0002',
      'message', 'That code isn''t right or has expired.',
      'details', null,
      'hint', null);
  end if;

  if (select count(*) from household_members where household_id = hid) >= 50 then
    raise exception 'That household is full.' using errcode = 'P0001', hint = 'since_household_full';
  end if;

  insert into household_members (household_id, user_id, role, display_name)
  values (hid, auth.uid(), 'member', btrim(my_name));
  return to_json(hid);
end;
$$;
revoke all on function public.join_household(text, text) from public, anon;
grant execute on function public.join_household(text, text) to authenticated;

-- ─── Removing a member revokes the household's codes ────────────────────────
-- The owner can make a new code straight away ("Invite someone").
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
  update household_invites set revoked_at = now()
  where household_id = hid and revoked_at is null and expires_at > now();
end;
$$;

-- ─── Size limits ────────────────────────────────────────────────────────────
-- Checked only when the value is written or changed, so an unrelated edit of
-- an existing row never trips over it. Counting checks skip rows that
-- already exist: an upsert of an existing item is an update, not a new one.
create or replace function public.items_limits_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' or new.name is distinct from old.name) and char_length(new.name) > 500 then
    raise exception 'An item''s name can be at most 500 characters.'
      using errcode = 'SN001', hint = 'since_item_name_too_long';
  end if;
  if (tg_op = 'INSERT' or new.category is distinct from old.category) and char_length(new.category) > 100 then
    raise exception 'A category can be at most 100 characters.'
      using errcode = 'SN002', hint = 'since_item_category_too_long';
  end if;
  if tg_op = 'INSERT' or new.history is distinct from old.history then
    if jsonb_typeof(new.history) = 'array' and jsonb_array_length(new.history) > 20000 then
      raise exception 'An item can keep at most 20000 history entries.'
        using errcode = 'SN003', hint = 'since_history_too_many_entries';
    end if;
    if octet_length(new.history::text) > 10485760 then
      raise exception 'An item''s history is too large.'
        using errcode = 'SN004', hint = 'since_history_too_large';
    end if;
  end if;
  if tg_op = 'INSERT'
     and not exists (select 1 from items where user_id = new.user_id and id = new.id)
     and (select count(*) from items where user_id = new.user_id) >= 5000 then
    raise exception 'An account can keep at most 5000 items.'
      using errcode = 'SN007', hint = 'since_too_many_items';
  end if;
  return new;
end;
$$;

drop trigger if exists items_limits_before_write on public.items;
create trigger items_limits_before_write
  before insert or update on public.items
  for each row execute function public.items_limits_before_write();

create or replace function public.completion_events_limits_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' or new.note is distinct from old.note) and char_length(new.note) > 5000 then
    raise exception 'A note can be at most 5000 characters.'
      using errcode = 'SN005', hint = 'since_note_too_long';
  end if;
  if tg_op = 'INSERT'
     and not exists (select 1 from completion_events
                     where user_id = new.user_id and item_id = new.item_id and id = new.id)
     and (select count(*) from completion_events
          where user_id = new.user_id and item_id = new.item_id) >= 20000 then
    raise exception 'An item can keep at most 20000 history entries.'
      using errcode = 'SN006', hint = 'since_too_many_entries';
  end if;
  return new;
end;
$$;

drop trigger if exists completion_events_limits_before_write on public.completion_events;
create trigger completion_events_limits_before_write
  before insert or update on public.completion_events
  for each row execute function public.completion_events_limits_before_write();

-- The same limits as constraints, behind the triggers. Added NOT VALID so
-- existing rows can't block the migration; validated only when no existing
-- row breaks them.
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('public.items'::regclass, 'items_name_length', 'check (char_length(name) <= 500)'),
      ('public.items'::regclass, 'items_category_length', 'check (char_length(category) <= 100)'),
      ('public.items'::regclass, 'items_history_entries',
        'check (jsonb_typeof(history) <> ''array'' or jsonb_array_length(history) <= 20000)'),
      ('public.items'::regclass, 'items_history_size', 'check (octet_length(history::text) <= 10485760)'),
      ('public.completion_events'::regclass, 'completion_events_note_length',
        'check (note is null or char_length(note) <= 5000)')
    ) as t(tbl, name, def)
  loop
    if not exists (select 1 from pg_constraint where conrelid = c.tbl and conname = c.name) then
      execute format('alter table %s add constraint %I %s not valid', c.tbl, c.name, c.def);
    end if;
    begin
      execute format('alter table %s validate constraint %I', c.tbl, c.name);
    exception when check_violation then
      -- Left in place NOT VALID, it would refuse every later edit of those
      -- rows, even one that doesn't touch the long value, and a phone's
      -- sync would retry it forever. Without it the trigger still refuses
      -- new values over the limit. Running 006 again after those rows are
      -- fixed adds it.
      execute format('alter table %s drop constraint %I', c.tbl, c.name);
      raise notice 'Constraint % not added: some existing rows are over the limit', c.name;
    end;
  end loop;
end $$;

-- ─── Tombstones: only for items in the owner's household ────────────────────
-- True unless the named account holds an item with this id outside the
-- household. An item already gone (deleted by someone else, or before a
-- retry) is fine, so a queued deletion never gets stuck.
create or replace function public.tombstone_in_household(owner uuid, iid text, hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from items i
    where i.user_id = owner and i.id = iid and i.household_id is distinct from hid
  );
$$;
revoke all on function public.tombstone_in_household(uuid, text, uuid) from public, anon;
grant execute on function public.tombstone_in_household(uuid, text, uuid) to authenticated;

drop policy if exists "deleted_items_insert" on public.deleted_items;
create policy "deleted_items_insert" on public.deleted_items for insert
  with check (
    auth.uid() = user_id
    or (household_id is not null and public.is_household_owner(household_id)
        and public.tombstone_in_household(user_id, id, household_id))
  );

drop policy if exists "deleted_items_update" on public.deleted_items;
create policy "deleted_items_update" on public.deleted_items for update
  using (auth.uid() = user_id or (household_id is not null and public.is_household_owner(household_id)))
  with check (
    auth.uid() = user_id
    or (household_id is not null and public.is_household_owner(household_id)
        and public.tombstone_in_household(user_id, id, household_id))
  );

-- ─── Account deletion leaves nothing that names the account ─────────────────
create or replace function public.delete_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  hid uuid := public.my_household_id();
  heir uuid;
begin
  if hid is not null then
    if public.is_household_owner(hid) then
      select user_id into heir from household_members
      where household_id = hid and user_id <> me
      order by joined_at, user_id limit 1;
      if heir is null then
        delete from households where id = hid;
        hid := null;
      else
        update household_members set role = 'member' where household_id = hid and user_id = me;
        update household_members set role = 'owner' where household_id = hid and user_id = heir;
      end if;
    end if;
    if hid is not null then
      perform public.hand_over_items(hid, me);
    end if;
  end if;

  -- Entries this account deleted, on any item: gone for good
  delete from completion_events where created_by = me and deleted_at is not null;
  -- Items that stay keep this account's entries in items.history (kept for
  -- older builds) with date and note, but no longer say who did them
  update items set history = (
    select coalesce(jsonb_agg(case when e->>'createdBy' = me::text then e - 'createdBy' else e end order by o),
                    '[]'::jsonb)
    from jsonb_array_elements(items.history) with ordinality as x(e, o)
  )
  where jsonb_typeof(history) = 'array'
    and history @> jsonb_build_array(jsonb_build_object('createdBy', me::text));

  -- The rest follows the foreign keys: own items, entries, tombstones, mutes,
  -- membership and failed joins are deleted; created_by on households,
  -- invites and other people's entries, and looked_after_by, are cleared.
  delete from auth.users where id = me;
end;
$$;
revoke all on function public.delete_user() from public, anon;
grant execute on function public.delete_user() to authenticated;

-- ─── Purging old soft-deleted entries (for scheduling later) ────────────────
-- A phone that hasn't synced since an entry was deleted could add it back
-- once the soft-deleted row is gone, hence the 90-day minimum.
create or replace function public.purge_soft_deleted_history(older_than interval)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if older_than is null or older_than < interval '90 days' then
    raise exception 'Only entries deleted more than 90 days ago can be purged.'
      using errcode = 'P0001', hint = 'since_purge_too_soon';
  end if;
  delete from completion_events where deleted_at is not null and deleted_at < now() - older_than;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.purge_soft_deleted_history(interval) from public, anon, authenticated;

commit;
