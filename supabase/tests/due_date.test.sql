-- "Until it's due" (migration 007), tested as an account (O) and an older
-- build that doesn't know the column. Run by run.sh on a fresh copy of the
-- schema. Every check prints "ok   <what>"; the first failure stops the run.

\set ON_ERROR_STOP on
\set o '''00000000-0000-4000-8000-00000000000a'''

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

grant execute on function public._check(boolean, text), public._fails(text, text, text) to authenticated;

insert into auth.users (id) values (:o);
set role authenticated;
select set_config('request.jwt.claim.sub', :o, false);

-- ─── This build ─────────────────────────────────────────────────────────────
-- A date item not done yet: no history, last_done_date is the day it was added
insert into public.items
  (id, user_id, name, category, last_done_date, history, repeat_value, repeat_unit, created_at, updated_at, due_date)
values ('rego', :o, 'Car rego', 'Auto', '2026-10-25', '[]', 1, 'years', now(), now(), '2026-12-05');
select _check((select due_date = '2026-12-05' from public.items where id = 'rego'),
  'a date item is saved with its due date');

update public.items set due_date = '2027-12-05' where id = 'rego';
select _check((select due_date = '2027-12-05' from public.items where id = 'rego'),
  'its due date can change (Done moves it on)');
update public.items set due_date = null where id = 'rego';
select _check((select due_date is null from public.items where id = 'rego'),
  'and can be cleared (Done on a one-off)');
update public.items set due_date = '2028-02-29' where id = 'rego';
select _check((select due_date = '2028-02-29' from public.items where id = 'rego'), 'a leap day is a real date');

select _fails($$update public.items set due_date = '2026-02-30' where id = 'rego'$$, 'SN008',
  'a date that doesn''t exist is refused with its own code');
select _fails($$update public.items set due_date = '5 Dec 2026' where id = 'rego'$$, 'SN008',
  'so is a date not written YYYY-MM-DD');
select _fails($$update public.items set due_date = '2026-1-5' where id = 'rego'$$, 'SN008',
  'and one without leading zeros');
select _fails($$insert into public.items (id, user_id, name, category, last_done_date, history, created_at, updated_at, due_date)
  values ('bad', auth.uid(), 'Bad', 'Other', '2026-10-25', '[]', now(), now(), 'soon')$$, 'SN008',
  'a new item with a bad due date is refused too');

do $$
declare h text;
begin
  update public.items set due_date = 'nope' where id = 'rego';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  perform _check(h = 'since_item_due_date_invalid', 'the refusal carries a stable hint');
end $$;

-- ─── Older builds, which don't know the column ─────────────────────────────
-- Exactly the columns an older build upserts (cloudStorage.ts before 007)
insert into public.items (id, user_id, name, category, last_done_date, history, repeat_value, repeat_unit, created_at, updated_at)
  values ('rego', :o, 'Car rego (old build)', 'Auto', '2026-11-01', '[{"id":"e1","date":"2026-11-01"}]', 1, 'years', now(), now())
  on conflict (user_id, id) do update set
    name = excluded.name, category = excluded.category, last_done_date = excluded.last_done_date,
    history = excluded.history, repeat_value = excluded.repeat_value, repeat_unit = excluded.repeat_unit,
    created_at = excluded.created_at, updated_at = excluded.updated_at;
select _check((select name = 'Car rego (old build)' and due_date = '2028-02-29' from public.items where id = 'rego'),
  'an older build''s upsert keeps the due date');

insert into public.items (id, user_id, name, category, last_done_date, history, repeat_value, repeat_unit, created_at, updated_at)
  values ('dentist', :o, 'Dentist', 'Health', '2026-10-01', '[{"id":"d1","date":"2026-10-01"}]', 6, 'months', now(), now());
select _check((select due_date is null from public.items where id = 'dentist'),
  'an older build''s new item has no due date ("since I last did it")');
update public.items set name = 'Dentist (renamed)' where id = 'dentist';
select _check((select name = 'Dentist (renamed)' from public.items where id = 'dentist'),
  'an older build''s in-place update still works');

-- A row with a bad value from before the trigger (none can exist, but an
-- unrelated edit must never trip over the check)
reset role;
alter table public.items disable trigger items_due_date_before_write;
alter table public.items drop constraint items_due_date_format;
update public.items set due_date = 'old junk' where id = 'dentist';
alter table public.items enable trigger items_due_date_before_write;
set role authenticated;
update public.items set name = 'Dentist again' where id = 'dentist';
select _check((select name = 'Dentist again' from public.items where id = 'dentist'),
  'an unrelated edit of a row with an unreadable due date still goes through');
