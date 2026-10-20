-- Access rules and server-owned fields, tested as two signed-in users (A, B)
-- and a signed-out one. Run by run.sh on a database holding the schema.
-- Every check prints "ok   <what>"; the first failure stops the run.

\set ON_ERROR_STOP on
\set a '''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'''
\set b '''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'''

create function public._check(ok boolean, what text)
returns void
language plpgsql
as $$
begin
  if not coalesce(ok, false) then
    raise exception 'FAILED: %', what;
  end if;
  raise warning 'ok   %', what;
end;
$$;
grant execute on function public._check(boolean, text) to anon, authenticated;

insert into auth.users (id) values (:a), (:b);

-- ─── Signed in as A ─────────────────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claim.sub', :a, false);

-- Exactly the columns an older build sends, in the upsert it makes.
insert into public.items
  (id, user_id, name, category, last_done_date, history, repeat_value, repeat_unit, created_at, updated_at)
values
  ('item-1', :a, 'Gutters', 'Household', '2026-05-01', '[{"id":"e1","date":"2026-05-01"}]', 6, 'months',
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
on conflict (user_id, id) do update set name = excluded.name, updated_at = excluded.updated_at;

select _check((select kind = 'task' from public.items where id = 'item-1'),
  'an older build''s item upsert still works, and the item is a task');
select _check((select history->0->>'id' = 'e1' from public.items where id = 'item-1'),
  'items.history (jsonb) is still stored for older builds');
select _check((select server_updated_at > now() - interval '1 minute' from public.items where id = 'item-1'),
  'the server sets items.server_updated_at on insert');

update public.items set server_updated_at = '2000-01-01', name = 'Clean gutters' where id = 'item-1';
select _check((select server_updated_at > '2001-01-01' from public.items where id = 'item-1'),
  'a phone can''t set items.server_updated_at');

-- A history entry. The phone claims B wrote it, and an old server time.
insert into public.completion_events (user_id, item_id, id, date, created_by, created_at, server_updated_at)
values (:a, 'item-1', 'e1', '2026-05-01', :b, '2026-05-01T08:00:00Z', '2000-01-01');

select _check((select created_by = :a from public.completion_events where id = 'e1'),
  'created_by is the signed-in user, whatever the phone sends');
select _check((select created_at = '2026-05-01T08:00:00Z' from public.completion_events where id = 'e1'),
  'created_at is kept as recorded on the phone');
select _check((select server_updated_at > '2001-01-01' from public.completion_events where id = 'e1'),
  'the server sets completion_events.server_updated_at');
select _check((select date = '2026-05-01'::date from public.completion_events where id = 'e1'),
  'the entry date is stored as a calendar date');

update public.completion_events
  set note = 'Used the long ladder', created_by = :b, created_at = '2030-01-01'
  where id = 'e1';
select _check((select note = 'Used the long ladder' and created_by = :a and created_at = '2026-05-01T08:00:00Z'
               from public.completion_events where id = 'e1'),
  'editing an entry changes its note but never who wrote it or when');

update public.completion_events set deleted_at = now() where id = 'e1';
select _check((select deleted_at is not null from public.completion_events where id = 'e1'),
  'an entry can be soft deleted, and stays readable so the removal can sync');
update public.completion_events set deleted_at = null where id = 'e1';

do $$
begin
  insert into public.completion_events (user_id, item_id, id, date)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'no-such-item', 'e9', '2026-05-01');
  raise exception 'FAILED: an entry for a missing item was accepted';
exception when foreign_key_violation then
  raise warning 'ok   an entry needs its item to exist';
end $$;

-- ─── Signed in as B ─────────────────────────────────────────────────────────
select set_config('request.jwt.claim.sub', :b, false);

select _check((select count(*) = 0 from public.items), 'B can''t read A''s items');
select _check((select count(*) = 0 from public.completion_events), 'B can''t read A''s history entries');

update public.completion_events set note = 'B was here' where id = 'e1';
delete from public.completion_events where id = 'e1';
delete from public.items where id = 'item-1';

do $$
begin
  insert into public.completion_events (user_id, item_id, id, date)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'item-1', 'e-from-b', '2026-05-02');
  raise exception 'FAILED: B wrote an entry into A''s account';
exception when insufficient_privilege then
  raise warning 'ok   B can''t write entries into A''s account';
end $$;

-- B can hold the same item and entry ids as A: keys are per account.
insert into public.items
  (id, user_id, name, category, last_done_date, history, repeat_value, repeat_unit, created_at, updated_at)
values ('item-1', :b, 'B''s item', 'Other', '2026-06-01', '[]', null, null, now(), now());
insert into public.completion_events (user_id, item_id, id, date) values (:b, 'item-1', 'e1', '2026-06-01');
select _check((select count(*) = 1 from public.completion_events), 'B''s own entry is stored, with the same ids as A''s');

-- ─── Signed out ─────────────────────────────────────────────────────────────
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select _check((select count(*) = 0 from public.items), 'signed out, no items are readable');
select _check((select count(*) = 0 from public.completion_events), 'signed out, no history entries are readable');

-- ─── Back as A: B changed nothing ──────────────────────────────────────────
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :a, false);
select _check((select note = 'Used the long ladder' from public.completion_events where id = 'e1'),
  'B''s edit and delete of A''s entry did nothing');
select _check((select count(*) = 1 from public.items where id = 'item-1'), 'B''s delete of A''s item did nothing');

-- Deleting an item removes its entries, and only its own.
delete from public.items where id = 'item-1';
select _check((select count(*) = 0 from public.completion_events), 'deleting an item removes its history entries');

-- Deleting the account removes everything of A's and nothing of B's.
insert into public.items
  (id, user_id, name, category, last_done_date, history, repeat_value, repeat_unit, created_at, updated_at)
values ('item-2', :a, 'Dentist', 'Health', '2026-04-01', '[]', 6, 'months', now(), now());
insert into public.completion_events (user_id, item_id, id, date) values (:a, 'item-2', 'e2', '2026-04-01');
select public.delete_user();

reset role;
select _check((select count(*) = 0 from public.items where user_id = :a), 'deleting the account removes its items');
select _check((select count(*) = 0 from public.completion_events where user_id = :a),
  'deleting the account removes its history entries');
select _check((select count(*) = 1 from public.completion_events where user_id = :b),
  'deleting A''s account leaves B''s entries alone');
