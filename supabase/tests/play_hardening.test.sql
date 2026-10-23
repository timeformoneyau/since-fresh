-- Play hardening (migration 006), tested as the household's owner (O),
-- members (M, J) and someone outside it (X), plus writes in the shape older
-- builds send. Run by run.sh on a fresh copy of the schema. Every check
-- prints "ok   <what>"; the first failure stops the run.

\set ON_ERROR_STOP on
\set o '''00000000-0000-4000-8000-00000000000a'''
\set m '''00000000-0000-4000-8000-00000000000b'''
\set x '''00000000-0000-4000-8000-00000000000c'''
\set j '''00000000-0000-4000-8000-00000000000d'''

create function public._check(ok boolean, what text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise warning 'ok   %', what;
end $$;

-- Runs stmt and expects it to fail with sqlstate code (and hint, if given).
create function public._fails(stmt text, code text, what text, want_hint text default null)
returns void language plpgsql as $$
declare
  ran boolean := false;
  got_hint text;
begin
  begin
    execute stmt;
    ran := true;
  exception when others then
    get stacked diagnostics got_hint = pg_exception_hint;
    if sqlstate <> code then
      raise exception 'FAILED: % (expected %, got %: %)', what, code, sqlstate, sqlerrm;
    end if;
    if want_hint is not null and got_hint is distinct from want_hint then
      raise exception 'FAILED: % (expected hint %, got %)', what, want_hint, got_hint;
    end if;
  end;
  if ran then raise exception 'FAILED: % (it was allowed)', what; end if;
  raise warning 'ok   %', what;
end $$;

create function public._as(who uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', who::text, false);
$$;

grant execute on function public._check(boolean, text), public._fails(text, text, text, text), public._as(uuid)
  to authenticated;

insert into auth.users (id) values (:o), (:m), (:x), (:j);
-- More people, for the household and global limits
create table public._crowd as select gen_random_uuid() as id from generate_series(1, 120);
insert into auth.users (id) select id from public._crowd;

create function public._add_item(iid text, hid uuid)
returns void language sql as $$
  insert into public.items
    (id, user_id, name, category, last_done_date, history, repeat_value, repeat_unit, created_at, updated_at, household_id)
  values (iid, auth.uid(), iid, 'Household', '2026-10-01', '[]', null, null, now(), now(), hid);
$$;
grant execute on function public._add_item(text, uuid) to authenticated;

set role authenticated;

select _as(:o);
select set_config('t.hid', public.create_household('Home', 'Sam')::text, false);
select set_config('t.code', public.create_invite(), false);

-- ════ Invite codes ═════════════════════════════════════════════════════════
-- Older builds call join_household and read the result or the error as
-- before: the household's id on success, P0002 and the same message for a
-- wrong code.
select _as(:m);
select _check(public.join_household(current_setting('t.code'), 'Alex') #>> '{}' = current_setting('t.hid'),
  'joining still returns the household''s id, as older builds expect');
select _as(:x);
-- One transaction, as PostgREST runs each call: the status is set for it
begin;
select set_config('t.r', public.join_household('WRNG-CODE', 'X')::text, false);
select _check(current_setting('t.r')::json->>'code' = 'P0002'
  and current_setting('t.r')::json->>'message' = 'That code isn''t right or has expired.',
  'a wrong code gives the same error code and message as before');
select _check(current_setting('response.status', true) = '404',
  'with the same HTTP status (404) PostgREST gives a raised P0002');
commit;

-- Each failure is recorded, and nobody can read or change the record
reset role;
select _check((select count(*) = 1 from public.household_join_failures where user_id = :x),
  'the wrong code is recorded (the call ends normally, so it is kept)');
set role authenticated;
select _fails($$select * from public.household_join_failures$$, '42501', 'members can''t read failed joins');
select _fails(format($$insert into public.household_join_failures (user_id) values (%L)$$, :x), '42501',
  'nor write them');
select _fails(format($$delete from public.household_join_failures where user_id = %L$$, :x), '42501',
  'nor clear their own');

-- Rate limit: 5 wrong codes in 15 minutes, then refused
select public.join_household('WRNG-COD' || n, 'X') from generate_series(2, 5) as n;
select _fails($$select public.join_household('WRNG-CODX', 'X')$$, 'P0001',
  'a sixth try within 15 minutes is refused, with its own hint', 'since_join_rate_limited');
select _fails(format($$select public.join_household(%L, 'X')$$, current_setting('t.code')), 'P0001',
  'even with the right code, until the window passes', 'since_join_rate_limited');
reset role;
select _check((select count(*) = 5 from public.household_join_failures where user_id = :x),
  'refused tries aren''t recorded as more failures');
update public.household_join_failures set failed_at = now() - interval '16 minutes' where user_id = :x;
set role authenticated;
select _as(:x);
select _check(public.join_household(current_setting('t.code'), 'Kit') #>> '{}' = current_setting('t.hid'),
  'after 15 minutes the right code works again');
select public.leave_household();

-- Global ceiling: 100 failures across everyone in 10 minutes
reset role;
insert into public.household_join_failures (user_id) select id from public._crowd limit 100;
set role authenticated;
select _as(:j);
select _fails(format($$select public.join_household(%L, 'Jo')$$, current_setting('t.code')), 'P0001',
  'when everyone together has 100 failures in 10 minutes, joining pauses for all', 'since_join_busy');
reset role;
update public.household_join_failures set failed_at = now() - interval '11 minutes';
set role authenticated;
select _check(public.join_household(current_setting('t.code'), 'Jo') #>> '{}' = current_setting('t.hid'),
  'and resumes once they''re older than 10 minutes');
reset role;
update public.household_join_failures set failed_at = now() - interval '2 days';
set role authenticated;
select _as(:x);
select public.join_household('WRNG-CODE', 'X');
reset role;
select _check((select count(*) = 1 from public.household_join_failures),
  'failures older than a day are cleared as people join');
set role authenticated;

-- Removing a member revokes the household's codes
select _as(:o);
select set_config('t.code2', public.create_invite(), false);
select public.remove_member(:j);
select _check((select bool_and(revoked_at is not null) from public.household_invites
               where expires_at > now()),
  'removing a member revokes every active code');
select _as(:j);
select _check((public.join_household(current_setting('t.code2'), 'Jo')->>'code') = 'P0002',
  'so the removed person can''t rejoin with a code they had');
select _as(:o);
select set_config('t.code3', public.create_invite(), false);
select _as(:j);
select _check(public.join_household(current_setting('t.code3'), 'Jo') #>> '{}' = current_setting('t.hid'),
  'the owner can make a new code, which works');

-- Codes made before this migration still work until they expire
reset role;
insert into public.household_invites (code, household_id) values ('ABCD2345', current_setting('t.hid')::uuid);
set role authenticated;
select _as(:x);
select _check(public.join_household('abcd-2345', 'X') #>> '{}' = current_setting('t.hid'),
  'an existing code keeps working');
select public.leave_household();

-- Uniform codes: every character equally likely in every position
reset role;
create table public._codes as select public.random_invite_code() as c from generate_series(1, 20000);
select _check((select bool_and(c ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$') from public._codes),
  'codes are still 8 characters from the same alphabet');
-- Expected 20000 / 31 ≈ 645 per letter per position (sd ≈ 25). The old
-- generator used the UUID's version byte for the 7th character, so only 16
-- letters could appear there.
select _check((
  select min(n) > 520 and max(n) < 780 and count(*) = 31 * 8 from (
    select p, substr(c, p, 1) as ch, count(*) as n
    from public._codes, generate_series(1, 8) as p group by 1, 2) s),
  'every letter appears about equally often in every position, the 7th included');
drop table public._codes;
set role authenticated;
select _fails($$select public.random_invite_code()$$, '42501', 'apps can''t call the code generator directly');

-- Limits on members and codes
select _as(:o);
reset role;
insert into public.household_invites (code, household_id, expires_at)
  select 'TEST' || lpad(n::text, 4, '0'), current_setting('t.hid')::uuid, now() + interval '7 days'
  from generate_series(1, 49) as n;
insert into public.household_invites (code, household_id, revoked_at)
  values ('REVOKED1', current_setting('t.hid')::uuid, now());
set role authenticated;
select _fails($$select public.create_invite()$$, 'P0001',
  'a household can have at most 50 active codes (revoked ones don''t count)', 'since_too_many_invites');
reset role;
update public.household_invites set revoked_at = now() where code like 'TEST%';
insert into public.household_members (household_id, user_id, role, display_name)
  select current_setting('t.hid')::uuid, id, 'member', 'Crowd' from public._crowd limit 47;
set role authenticated;
select set_config('t.code4', public.create_invite(), false);
select _as(:x);
select _fails(format($$select public.join_household(%L, 'X')$$, current_setting('t.code4')), 'P0001',
  'a household can have at most 50 members', 'since_household_full');
reset role;
delete from public.household_members where display_name = 'Crowd';
set role authenticated;

-- ════ Size limits ══════════════════════════════════════════════════════════
select _as(:o);
select public._add_item('bins', current_setting('t.hid')::uuid);
update public.items set name = repeat('n', 500), category = repeat('c', 100) where id = 'bins';
select _check(true, 'a 500-character name and a 100-character category are fine');
select _fails($$update public.items set name = repeat('n', 501) where id = 'bins'$$, 'SN001',
  'a longer name is refused, with its own code', 'since_item_name_too_long');
select _fails($$update public.items set category = repeat('c', 101) where id = 'bins'$$, 'SN002',
  'a longer category is refused, with its own code', 'since_item_category_too_long');
update public.items set history = (
  select jsonb_agg(jsonb_build_object('id', 'e' || n, 'date', '2026-01-01')) from generate_series(1, 20000) n)
  where id = 'bins';
select _check(true, 'a history of 20000 entries is fine');
select _fails($$update public.items set history = history || '[{"id":"one-more","date":"2026-01-02"}]' where id = 'bins'$$,
  'SN003', 'more is refused, with its own code', 'since_history_too_many_entries');
select _fails($$update public.items set history = jsonb_build_array(jsonb_build_object('id', 'e', 'note', repeat('x', 10500000))) where id = 'bins'$$,
  'SN004', 'a history over 10 MiB is refused, with its own code', 'since_history_too_large');
update public.items set history = '[]' where id = 'bins';

insert into public.completion_events (user_id, item_id, id, date, note) values (:o, 'bins', 'n1', '2026-10-01', repeat('x', 5000));
select _check(true, 'a 5000-character note is fine');
select _fails(format($$insert into public.completion_events (user_id, item_id, id, date, note) values (%L, 'bins', 'n2', '2026-10-01', repeat('x', 5001))$$, :o),
  'SN005', 'a longer note is refused, with its own code', 'since_note_too_long');
select _fails($$update public.completion_events set note = repeat('x', 5001) where id = 'n1'$$,
  'SN005', 'also when edited', 'since_note_too_long');

-- Entries per item, and items per account (filled in directly to the limit)
reset role;
insert into public.completion_events (user_id, item_id, id, date)
  select :o, 'bins', 'fill' || n, '2026-01-01' from generate_series(1, 19999) n;
set role authenticated;
select _as(:m);
select _fails(format($$insert into public.completion_events (user_id, item_id, id, date) values (%L, 'bins', 'too-many', '2026-10-02')$$, :o),
  'SN006', 'an item can have at most 20000 entries, with its own code', 'since_too_many_entries');
-- Older builds send every entry of an item they push, insert-only
insert into public.completion_events (user_id, item_id, id, date) values (:o, 'bins', 'n1', '2026-10-01')
  on conflict (user_id, item_id, id) do nothing;
select _check(true, 'an older build re-sending an entry already there still works at the limit');

reset role;
insert into public.items (id, user_id, name, category, last_done_date, history, created_at, updated_at)
  select 'many' || n, :x, 'x', 'Other', '2026-01-01', '[]', now(), now() from generate_series(1, 5000) n;
set role authenticated;
select _as(:x);
select _fails($$select public._add_item('one-too-many', null)$$, 'SN007',
  'an account can have at most 5000 items, with its own code', 'since_too_many_items');
insert into public.items (id, user_id, name, category, last_done_date, history, created_at, updated_at)
  values ('many1', :x, 'Renamed', 'Other', '2026-01-01', '[]', now(), now())
  on conflict (user_id, id) do update set name = excluded.name, updated_at = excluded.updated_at;
select _check((select name = 'Renamed' from public.items where user_id = :x and id = 'many1'),
  'an older build''s upsert of an existing item still works at the limit');
reset role;
delete from public.items where user_id = :x;
delete from public.completion_events where id like 'fill%';
set role authenticated;

-- Rows already over a limit never stop the migration, and stay editable
reset role;
alter table public.items drop constraint items_name_length;
alter table public.items disable trigger items_limits_before_write;
insert into public.items (id, user_id, name, category, last_done_date, history, created_at, updated_at)
  values ('huge', :o, repeat('n', 600), 'Other', '2026-01-01', '[]', now(), now());
alter table public.items enable trigger items_limits_before_write;
\ir ../migrations/006_play_hardening.sql
select _check((select count(*) = 0 from pg_constraint where conname = 'items_name_length'),
  're-running 006 over a row already too long succeeds, and leaves that limit to the trigger');
set role authenticated;
select _as(:o);
update public.items set category = 'Health' where id = 'huge';
select _check((select category = 'Health' from public.items where id = 'huge'),
  'that row can still be edited');
select _fails($$update public.items set name = repeat('n', 700) where id = 'huge'$$, 'SN001',
  'but not made longer');
reset role;
delete from public.items where id = 'huge';
\ir ../migrations/006_play_hardening.sql
select _check((select convalidated from pg_constraint where conname = 'items_name_length'),
  'once it''s gone, re-running 006 adds the constraint, validated');
set role authenticated;

-- ════ Tombstones ═══════════════════════════════════════════════════════════
select _as(:o);
select public._add_item('o-personal', null);
insert into public.deleted_items (id, user_id) values ('o-personal-gone', :o);
insert into public.deleted_items (id, user_id, household_id) values ('bins-gone', :o, current_setting('t.hid')::uuid);
select _check(true, 'anyone can record deleting their own item, personal or shared');

select _as(:m);
select public._add_item('m-shared', current_setting('t.hid')::uuid);
select public._add_item('m-personal', null);
select _as(:x);
select public._add_item('x-personal', null);
select _as(:o);
-- As the app does it (cloudStorage.ts): tombstone first, then the delete
insert into public.deleted_items (id, user_id, household_id) values ('m-shared', :m, current_setting('t.hid')::uuid)
  on conflict (id, user_id) do update set deleted_at = now();
delete from public.items where user_id = :m and id = 'm-shared';
select _check((select count(*) = 1 from public.deleted_items where id = 'm-shared'),
  'the owner can record deleting a member''s shared item');
insert into public.deleted_items (id, user_id, household_id) values ('m-shared', :m, current_setting('t.hid')::uuid)
  on conflict (id, user_id) do update set deleted_at = now();
select _check(true, 'and send it again after the item is gone (a retry, or someone else deleted it)');
insert into public.deleted_items (id, user_id, household_id) values ('left-long-ago', :m, current_setting('t.hid')::uuid);
select _check(true, 'or for an item no longer in the cloud (a phone with an old owner for it)');

select _fails(format($$insert into public.deleted_items (id, user_id, household_id) values ('x-personal', %L, %L)$$, :x, current_setting('t.hid')),
  '42501', 'the owner can''t name an outsider''s item');
select _fails(format($$insert into public.deleted_items (id, user_id, household_id) values ('m-personal', %L, %L)$$, :m, current_setting('t.hid')),
  '42501', 'nor a member''s personal item');
reset role;
insert into public.deleted_items (id, user_id, household_id) values ('m-personal', :m, null);
set role authenticated;
select _fails(format($$insert into public.deleted_items (id, user_id, household_id) values ('m-personal', %L, %L)
  on conflict (id, user_id) do update set household_id = excluded.household_id$$, :m, current_setting('t.hid')),
  '42501', 'nor take over someone else''s tombstone with an upsert');
select _as(:j);
select _fails(format($$insert into public.deleted_items (id, user_id, household_id) values ('bins', %L, %L)$$, :o, current_setting('t.hid')),
  '42501', 'a member still can''t record deleting someone else''s item');

-- ════ Deleting an account ══════════════════════════════════════════════════
-- M marks O's shared item done (with a note), deletes one entry, and has a
-- shared item of their own. The items.history copy (kept for older builds)
-- names M too.
select _as(:o);
select public._add_item('gutters', current_setting('t.hid')::uuid);
select _as(:m);
insert into public.completion_events (user_id, item_id, id, date, note) values (:o, 'gutters', 'by-m', '2026-10-05', 'Ladder in the shed');
insert into public.completion_events (user_id, item_id, id, date) values (:o, 'gutters', 'deleted-by-m', '2026-10-06');
update public.completion_events set deleted_at = now() where id = 'deleted-by-m';
update public.items set history = jsonb_build_array(
    jsonb_build_object('id', 'by-m', 'date', '2026-10-05', 'note', 'Ladder in the shed', 'createdBy', :m),
    jsonb_build_object('id', 'by-o', 'date', '2026-10-01', 'createdBy', :o))
  where user_id = :o and id = 'gutters';
select public._add_item('m-shared-2', current_setting('t.hid')::uuid);
update public.items set looked_after_by = :m where user_id = :o and id = 'gutters';
reset role;
insert into public.household_join_failures (user_id) values (:m);
set role authenticated;
select public.delete_user();

reset role;
select _check((select history = jsonb_build_array(
    jsonb_build_object('id', 'by-m', 'date', '2026-10-05', 'note', 'Ladder in the shed'),
    jsonb_build_object('id', 'by-o', 'date', '2026-10-01', 'createdBy', :o))
  from public.items where id = 'gutters'),
  'their entries in items.history keep date and note but no longer say who, in the same order');
select _check((select created_by is null and note = 'Ladder in the shed' from public.completion_events where id = 'by-m'),
  'their entries on other people''s items stay, unattributed');
select _check((select count(*) = 0 from public.completion_events where id = 'deleted-by-m'),
  'entries they deleted are purged');
select _check((select user_id = :o from public.items where id = 'm-shared-2'), 'their shared item stays with the household');
-- Nothing anywhere still holds their id
create function pg_temp.mentions(who text)
returns bigint language plpgsql as $$
declare
  t record;
  n bigint;
  total bigint := 0;
begin
  for t in select c.oid::regclass as tbl from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname not like '\_%' loop
    execute format('select count(*) from %s r where row_to_json(r)::text like %L', t.tbl, '%' || who || '%') into n;
    total := total + n;
  end loop;
  return total;
end $$;
select _check(pg_temp.mentions(:m) = 0, 'no row in any table still contains their account id');

-- ════ Purging old soft-deleted entries ═════════════════════════════════════
set role authenticated;
select _as(:o);
select _fails($$select public.purge_soft_deleted_history(interval '90 days')$$, '42501',
  'apps and signed-in people can''t purge');
reset role;
insert into public.completion_events (user_id, item_id, id, date, deleted_at) values
  (:o, 'gutters', 'old-deleted', '2026-01-01', now() - interval '100 days'),
  (:o, 'gutters', 'new-deleted', '2026-01-02', now() - interval '10 days');
select _fails($$select public.purge_soft_deleted_history(interval '30 days')$$, 'P0001',
  'under 90 days is refused (a phone that hasn''t synced could add them back)', 'since_purge_too_soon');
select _check(public.purge_soft_deleted_history(interval '90 days') = 1, 'purging 90 days removes one entry');
select _check((select array_agg(id order by id) = array['by-m', 'new-deleted'] from public.completion_events where item_id = 'gutters'),
  'the old deleted one; recent deletions and live entries stay');
