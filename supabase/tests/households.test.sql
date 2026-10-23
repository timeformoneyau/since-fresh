-- Shared households (migration 004), tested as three users: the household's
-- owner (O), a member (M) and someone outside it (X). Run by run.sh on a
-- fresh copy of the schema. Every check prints "ok   <what>"; the first
-- failure stops the run.

\set ON_ERROR_STOP on
\set o '''00000000-0000-4000-8000-00000000000a'''
\set m '''00000000-0000-4000-8000-00000000000b'''
\set x '''00000000-0000-4000-8000-00000000000c'''

create function public._check(ok boolean, what text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise warning 'ok   %', what;
end $$;

-- Runs stmt as the current user and expects it to fail with sqlstate code.
create function public._fails(stmt text, code text, what text)
returns void language plpgsql as $$
declare
  ran boolean := false;
begin
  begin
    execute stmt;
    ran := true;
  exception when others then
    if sqlstate <> code then
      raise exception 'FAILED: % (expected %, got %: %)', what, code, sqlstate, sqlerrm;
    end if;
  end;
  if ran then raise exception 'FAILED: % (it was allowed)', what; end if;
  raise warning 'ok   %', what;
end $$;

create function public._as(who uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', who::text, false);
$$;

grant execute on function public._check(boolean, text), public._fails(text, text, text), public._as(uuid)
  to authenticated;

insert into auth.users (id) values (:o), (:m), (:x);

-- A small helper for adding items as the signed-in user
create function public._add_item(iid text, hid uuid)
returns void language sql as $$
  insert into public.items
    (id, user_id, name, category, last_done_date, history, repeat_value, repeat_unit, created_at, updated_at, household_id)
  values (iid, auth.uid(), iid, 'Household', '2026-10-01', '[]', null, null, now(), now(), hid);
$$;
grant execute on function public._add_item(text, uuid) to authenticated;

set role authenticated;

-- ─── Creating a household and inviting ──────────────────────────────────────
select _as(:o);
select set_config('t.hid', public.create_household('  Home  ', 'Sam')::text, false);
select _check((select name = 'Home' from public.households), 'O creates a household and can see it');
select _check((select role = 'owner' from public.household_members where user_id = :o), 'O is its owner');
select _fails($$select public.create_household('Second', 'Sam')$$, 'P0001', 'one household per person');

select set_config('t.code', public.create_invite(), false);
select _check(current_setting('t.code') ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$',
  'invite codes are 8 easy-to-read characters');

select _as(:m);
select _check((select count(*) = 0 from public.households), 'M can''t see the household before joining');
-- A wrong code comes back as an error response (P0002, HTTP 404) rather
-- than a raised error, so the failed attempt stays recorded (migration 006)
select _check((public.join_household('ZZZZ-ZZZZ', 'Alex')->>'code') = 'P0002', 'a wrong code is refused');
select public.join_household(
  lower(substr(current_setting('t.code'), 1, 4) || '-' || substr(current_setting('t.code'), 5)), ' Alex ');
select _check((select count(*) = 2 from public.household_members), 'M joins with the code, typed with a dash and in lower case');
select _check((select display_name = 'Alex' from public.household_members where user_id = :m), 'M''s name is trimmed');
select _fails($$select public.create_invite()$$, '42501', 'only the owner can invite');
select _check((select count(*) = 0 from public.household_invites), 'members can''t see invite codes');

-- Membership can only change through the functions
select _fails($$insert into public.household_members values (current_setting('t.hid')::uuid, '00000000-0000-4000-8000-00000000000c', 'member', 'Sneaky', now())$$,
  '42501', 'members can''t add people directly');
select _fails($$update public.household_members set role = 'owner' where user_id = auth.uid()$$,
  '42501', 'members can''t make themselves owner');
update public.household_members set display_name = 'Alex R' where user_id = :m;
select _check((select display_name = 'Alex R' from public.household_members where user_id = :m), 'M can change their own name');
update public.household_members set display_name = 'Hacked' where user_id = :o;
select _check((select display_name = 'Sam' from public.household_members where user_id = :o), 'M can''t change O''s name');

-- Revoked and expired codes
select _as(:o);
select set_config('t.revoked', public.create_invite(), false);
select public.revoke_invite(current_setting('t.revoked'));
reset role;
insert into public.household_invites (code, household_id, expires_at)
  values ('EXPRDCDE', current_setting('t.hid')::uuid, now() - interval '1 day');
set role authenticated;
select _as(:x);
select _check((public.join_household(current_setting('t.revoked'), 'X')->>'code') = 'P0002', 'a revoked code is refused');
select _check((public.join_household('EXPRDCDE', 'X')->>'code') = 'P0002', 'an expired code is refused');

-- ─── Personal and shared items ──────────────────────────────────────────────
select _as(:o);
select public._add_item('o-personal', null);
select public._add_item('o-shared', current_setting('t.hid')::uuid);
insert into public.completion_events (user_id, item_id, id, date) values (:o, 'o-personal', 'p1', '2026-10-01');
insert into public.completion_events (user_id, item_id, id, date) values (:o, 'o-shared', 's1', '2026-10-01');

select _as(:m);
select _check((select array_agg(id order by id) = array['o-shared'] from public.items),
  'M sees O''s shared item and not O''s personal one');
select _check((select array_agg(id) = array['s1'] from public.completion_events),
  'M sees the shared item''s history and not the personal item''s');

update public.items set name = 'Bins (shared)' where id = 'o-shared';
select _check((select name = 'Bins (shared)' from public.items where id = 'o-shared'), 'M can edit a shared item');
-- The app updates another member's item in place (cloudStorage.ts): an
-- upsert is checked against the insert rule even when the row exists, and
-- only an item's owner may insert it.
select _fails(format($$insert into public.items (id, user_id, name, category, last_done_date, history, created_at, updated_at, household_id)
    values ('o-shared', %L, 'Upserted', 'Household', '2026-10-01', '[]', now(), now(), %L)
    on conflict (user_id, id) do update set name = excluded.name$$, :o, current_setting('t.hid')),
  '42501', 'an upsert of someone else''s shared item is refused, so the app updates it instead');
update public.items set name = 'Nope' where id = 'o-personal';
select _fails($$update public.items set household_id = null where id = 'o-shared'$$, '42501',
  'only the person who added an item can change who it''s for');
select _fails(format($$update public.items set user_id = %L where id = 'o-shared'$$, :m), '42501',
  'nobody can take over an item''s ownership');
delete from public.items where id = 'o-shared';
select _check((select count(*) = 1 from public.items where id = 'o-shared'), 'a member can''t delete someone else''s shared item');

insert into public.completion_events (user_id, item_id, id, date) values (:o, 'o-shared', 'by-m', '2026-10-05');
select _check((select created_by = :m from public.completion_events where id = 'by-m'),
  'M can mark a shared item done, and the entry says M did it');
select _fails(format($$insert into public.completion_events (user_id, item_id, id, date) values (%L, 'o-personal', 'x', '2026-10-05')$$, :o),
  '42501', 'M can''t add entries to O''s personal item');

-- Sharing into a household you're not in
select _as(:x);
select _check((select count(*) = 0 from public.items), 'X sees none of the household''s items');
select _check((select count(*) = 0 from public.completion_events), 'X sees none of their history');
select _fails(format($$select public._add_item('x-item', %L)$$, current_setting('t.hid')), '42501',
  'X can''t share an item into a household they''re not in');
select _fails(format($$insert into public.completion_events (user_id, item_id, id, date) values (%L, 'o-shared', 'x', '2026-10-05')$$, :o),
  '42501', 'X can''t add entries to the household''s items');

-- The household's owner can delete a member's shared item, and the deletion
-- reaches everyone
select _as(:m);
select public._add_item('m-shared', current_setting('t.hid')::uuid);
select _as(:o);
delete from public.items where user_id = :m and id = 'm-shared';
insert into public.deleted_items (id, user_id, household_id) values ('m-shared', :m, current_setting('t.hid')::uuid);
select _as(:m);
select _check((select count(*) = 0 from public.items where id = 'm-shared'), 'the household''s owner can delete a member''s shared item');
select _check((select count(*) = 1 from public.deleted_items where id = 'm-shared'), 'and the member sees it was deleted');

-- ─── Mutes ──────────────────────────────────────────────────────────────────
insert into public.item_mutes (owner_id, item_id) values (:o, 'o-shared');
select _check((select count(*) = 1 from public.item_mutes), 'M can mute a shared item for themselves');
select _fails(format($$insert into public.item_mutes (owner_id, item_id) values (%L, 'o-personal')$$, :o), '42501',
  'M can''t mute an item they can''t see');
select _as(:o);
select _check((select count(*) = 0 from public.item_mutes), 'O doesn''t see M''s mutes');

-- ─── Leaving ────────────────────────────────────────────────────────────────
select _as(:m);
select public._add_item('m-shared-2', current_setting('t.hid')::uuid);
select public._add_item('m-personal', null);
insert into public.completion_events (user_id, item_id, id, date) values (:m, 'm-shared-2', 'm2', '2026-10-06');
select public.leave_household();

select _check((select count(*) = 0 from public.households), 'after leaving, M no longer sees the household');
select _check((select array_agg(id) = array['m-personal'] from public.items),
  'M keeps their personal item, and no longer sees shared ones');
select _check((select count(*) = 0 from public.item_mutes), 'M''s mutes for the household go');
select _as(:o);
select _check((select user_id = :o from public.items where id = 'm-shared-2'), 'M''s shared item stays with the household, now O''s');
select _check((select created_by = :m and user_id = :o from public.completion_events where id = 'm2'),
  'its history moves with it and still says M did it');
select _check((select created_by = :m from public.completion_events where id = 'by-m'),
  'M''s entries on other shared items stay, still M''s');
select _fails($$select public.leave_household()$$, 'P0001', 'the owner can''t just leave');

-- ─── Removing, handing over, deleting ───────────────────────────────────────
select set_config('t.code2', public.create_invite(), false);
select _as(:x);
select public.join_household(current_setting('t.code2'), 'Jo');
select _fails(format($$select public.remove_member(%L)$$, :o), '42501', 'a member can''t remove people');
select _fails($$select public.delete_household()$$, '42501', 'a member can''t delete the household');

select _as(:o);
select _fails($$select public.delete_household()$$, 'P0001', 'the household can''t be deleted with other people in it');
select public.transfer_ownership(:x);
select _check((select role = 'owner' from public.household_members where user_id = :x), 'O hands the household to X');
select _check((select role = 'member' from public.household_members where user_id = :o), 'and O is now a member');

select _as(:x);
select public.remove_member(:o);
select _check((select count(*) = 1 from public.household_members), 'the new owner can remove O');
select _check((select count(*) = 2 from public.items where household_id is not null and user_id = :x),
  'O''s shared items stay with the household, now X''s');

select public.delete_household();
select _check((select count(*) = 0 from public.households), 'the last member can delete the household');
select _check((select bool_and(household_id is null) from public.items where user_id = :x),
  'its shared items become personal items');

-- ─── Deleting an account ────────────────────────────────────────────────────
-- Owner O deletes their account while M is a member: M takes over, and the
-- household keeps O's shared items.
select _as(:o);
select public.create_household('Flat', 'Sam');
select set_config('t.hid2', public.my_household_id()::text, false);
select set_config('t.code3', public.create_invite(), false);
select public._add_item('o-flat', current_setting('t.hid2')::uuid);
insert into public.completion_events (user_id, item_id, id, date) values (:o, 'o-flat', 'f1', '2026-10-07');
select _as(:m);
select public.join_household(current_setting('t.code3'), 'Alex');
select _as(:o);
select public.delete_user();
select _as(:m);
select _check((select role = 'owner' from public.household_members where user_id = :m),
  'when the owner deletes their account, the longest-standing member takes over');
select _check((select user_id = :m from public.items where id = 'o-flat'), 'and the household keeps their shared items');
select _check((select count(*) = 1 from public.completion_events where id = 'f1'), 'with their history');
select _check((select created_by is null from public.completion_events where id = 'f1'),
  'whose "done by" is cleared, as the account is gone');

-- A sole member deleting their account takes their household with it
select public.delete_user();
reset role;
select _check((select count(*) = 0 from public.households where id = current_setting('t.hid2')::uuid),
  'a household goes when its last member deletes their account');
select _check((select count(*) = 0 from public.items where user_id = :m), 'along with that member''s items');
