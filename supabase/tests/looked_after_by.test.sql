-- Who looks after a shared item (migration 005), tested as the household's
-- owner (O), two members (M, J) and someone outside it (X). Run by run.sh on
-- a fresh copy of the schema. Every check prints "ok   <what>"; the first
-- failure stops the run.

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

insert into auth.users (id) values (:o), (:m), (:x), (:j);

create function public._add_item(iid text, hid uuid)
returns void language sql as $$
  insert into public.items
    (id, user_id, name, category, last_done_date, history, repeat_value, repeat_unit, created_at, updated_at, household_id)
  values (iid, auth.uid(), iid, 'Household', '2026-10-01', '[]', null, null, now(), now(), hid);
$$;
grant execute on function public._add_item(text, uuid) to authenticated;

-- Who looks after an item, read as a superuser (so leaving doesn't hide it)
create function public._who(owner uuid, iid text)
returns uuid language sql security definer as $$
  select looked_after_by from public.items where user_id = owner and id = iid;
$$;
create function public._changed_at(owner uuid, iid text)
returns timestamptz language sql security definer as $$
  select server_updated_at from public.items where user_id = owner and id = iid;
$$;
grant execute on function public._who(uuid, text), public._changed_at(uuid, text) to authenticated;

set role authenticated;

-- ─── Setting it up ──────────────────────────────────────────────────────────
select _as(:o);
select set_config('t.hid', public.create_household('Home', 'Sam')::text, false);
select set_config('t.code', public.create_invite(), false);
select _as(:m);
select public.join_household(current_setting('t.code'), 'Alex');
select _as(:j);
select public.join_household(current_setting('t.code'), 'Jo');

select _as(:o);
select public._add_item('bins', current_setting('t.hid')::uuid);
select public._add_item('o-personal', null);
select _check((select looked_after_by is null from public.items where id = 'bins'),
  'a shared item starts with nobody chosen (Anyone)');

-- ─── Any member can choose ──────────────────────────────────────────────────
select _as(:m);
update public.items set looked_after_by = :m where id = 'bins';
select _check(_who(:o, 'bins') = :m, 'M says "I''ll look after this" on O''s shared item');
update public.items set looked_after_by = :j where id = 'bins';
select _check(_who(:o, 'bins') = :j, 'M can choose another member');
update public.items set looked_after_by = null where id = 'bins';
select _check(_who(:o, 'bins') is null, 'M can set it back to Anyone');
select _fails(format($$update public.items set looked_after_by = %L where id = 'bins'$$, :x), '23503',
  'nobody outside the household can be chosen');

select _as(:o);
update public.items set looked_after_by = :m where id = 'bins';
select _check(_who(:o, 'bins') = :m, 'the item''s owner can choose a member');
select _fails(format($$update public.items set looked_after_by = %L where id = 'o-personal'$$, :o), '23514',
  'a personal item can''t have someone looking after it');
select _fails(format($$insert into public.items (id, user_id, name, category, last_done_date, history, created_at, updated_at, looked_after_by)
    values ('p2', %L, 'p2', 'Other', '2026-10-01', '[]', now(), now(), %L)$$, :o, :o), '23514',
  'nor can a new personal item');
insert into public.items (id, user_id, name, category, last_done_date, history, created_at, updated_at, household_id, looked_after_by)
  values ('gutters', :o, 'Gutters', 'Household', '2026-10-01', '[]', now(), now(), current_setting('t.hid')::uuid, :j);
select _check(_who(:o, 'gutters') = :j, 'a new shared item can be saved with someone looking after it');

-- Anyone can still mark it done
select _as(:j);
insert into public.completion_events (user_id, item_id, id, date) values (:o, 'bins', 'by-j', '2026-10-10');
select _check((select created_by = :j from public.completion_events where id = 'by-j'),
  'J can mark done an item M looks after');

-- Outsiders can't touch it
select _as(:x);
update public.items set looked_after_by = null where id = 'bins';
select _as(:o);
select _check(_who(:o, 'bins') = :m, 'X can''t change who looks after a household item');

-- ─── Older builds, which don't know the column ─────────────────────────────
-- The app upserts its own items (PostgREST: "on conflict do update" sets only
-- the columns sent), and updates another member's item in place
-- (cloudStorage.ts). Neither sends looked_after_by.
insert into public.items (id, user_id, name, category, last_done_date, history, repeat_value, repeat_unit, created_at, updated_at, household_id)
  values ('bins', :o, 'Bins (renamed)', 'Household', '2026-10-01', '[]', 1, 'weeks', now(), now(), current_setting('t.hid')::uuid)
  on conflict (user_id, id) do update set
    name = excluded.name, category = excluded.category, last_done_date = excluded.last_done_date,
    history = excluded.history, repeat_value = excluded.repeat_value, repeat_unit = excluded.repeat_unit,
    created_at = excluded.created_at, updated_at = excluded.updated_at, household_id = excluded.household_id;
select _check((select name = 'Bins (renamed)' and looked_after_by = :m from public.items where id = 'bins'),
  'an older build''s upsert of its own item keeps who looks after it');
-- Builds before households didn't send household_id either
insert into public.items (id, user_id, name, category, last_done_date, history, created_at, updated_at)
  values ('bins', :o, 'Bins (pre-households build)', 'Household', '2026-10-01', '[]', now(), now())
  on conflict (user_id, id) do update set name = excluded.name, updated_at = excluded.updated_at;
select _check((select household_id is not null and looked_after_by = :m from public.items where id = 'bins'),
  'so does an upsert from a build before households');

select _as(:j);
update public.items set name = 'Bins (J)', category = 'Household', updated_at = now()
  where user_id = :o and id = 'bins';
select _check(_who(:o, 'bins') = :m, 'an older build''s in-place update of someone else''s item keeps it');

-- An older build changing an item to Just me sends household_id = null only
select _as(:o);
insert into public.items (id, user_id, name, category, last_done_date, history, created_at, updated_at, household_id)
  values ('gutters', :o, 'Gutters', 'Household', '2026-10-01', '[]', now(), now(), null)
  on conflict (user_id, id) do update set name = excluded.name, household_id = excluded.household_id;
select _check((select household_id is null and looked_after_by is null from public.items where id = 'gutters'),
  'an older build changing an item to Just me clears who looks after it');
update public.items set household_id = current_setting('t.hid')::uuid where id = 'gutters';
select _check(_who(:o, 'gutters') is null, 'shared again, it starts at Anyone');
select _fails(format($$update public.items set household_id = null, looked_after_by = %L where id = 'gutters'$$, :j), '23514',
  'a change to Just me that also names someone is refused');

-- ─── It clears when membership ends ─────────────────────────────────────────
select _as(:m);
select public._add_item('m-shared', current_setting('t.hid')::uuid);
update public.items set looked_after_by = :j where id = 'm-shared';
select set_config('t.before', _changed_at(:o, 'bins')::text, false);
select public.leave_household();
select _check(_who(:o, 'bins') is null, 'when M leaves, items M looked after go back to Anyone');
select _check(_changed_at(:o, 'bins') > current_setting('t.before')::timestamptz,
  'and the change time moves on, so other phones pull it');
select _check(_who(:o, 'm-shared') = :j, 'M''s shared item stays with the household, still looked after by J');

select _as(:o);
update public.items set looked_after_by = :j where id = 'bins';
select public.remove_member(:j);
select _check(_who(:o, 'bins') is null and _who(:o, 'm-shared') is null,
  'when J is removed, items J looked after go back to Anyone');

-- Deleting an account
select set_config('t.code2', public.create_invite(), false);
select _as(:x);
select public.join_household(current_setting('t.code2'), 'Kit');
update public.items set looked_after_by = :x where user_id = :o and id = 'bins';
select _check(_who(:o, 'bins') = :x, 'a new member can be chosen once they join');
select public.delete_user();
select _as(:o);
select _check(_who(:o, 'bins') is null, 'when a member deletes their account, their items go back to Anyone');

-- The household going: its items become personal
update public.items set looked_after_by = :o where id = 'bins';
select public.delete_household();
select _check((select bool_and(household_id is null and looked_after_by is null) from public.items where user_id = :o),
  'when the household is deleted, its items become personal with nobody chosen');
