-- Migration 007 — "Until it's due": items tracked against a date
--
-- RUN ORDER: after 006, and before installing the build that offers "Until
-- it's due". Earlier builds ignore everything here: they never send
-- items.due_date, so their writes leave it as it is ("on conflict do update"
-- sets only the columns sent), and their new items get null.
--
-- Additive only. What it adds:
--   - items.due_date: null means "since I last did it", as before. Otherwise
--     the date it's next due, written YYYY-MM-DD like last_done_date (text,
--     so a bad value reaches the check below instead of failing as a type
--     error that sync would retry for ever).
--   - A value that isn't a real YYYY-MM-DD date is refused with SN008 (hint
--     since_item_due_date_invalid), so the app parks the change like the
--     other size limits (006) instead of retrying it. Checked only when the
--     value is written or changed.
--   - The same rule as a constraint behind the trigger.
--   - No change to access rules: due_date is an item field like repeat_value.
--
-- One transaction, safe to re-run: each step checks the current state first.

begin;

alter table public.items
  add column if not exists due_date text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.items'::regclass and conname = 'items_due_date_format'
  ) then
    alter table public.items
      add constraint items_due_date_format
        check (due_date is null or due_date ~ '^\d{4}-\d{2}-\d{2}$');
  end if;
end $$;

create or replace function public.items_due_date_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ok boolean;
begin
  if new.due_date is not null and (tg_op = 'INSERT' or new.due_date is distinct from old.due_date) then
    begin
      ok := new.due_date ~ '^\d{4}-\d{2}-\d{2}$'
        and to_char(new.due_date::date, 'YYYY-MM-DD') = new.due_date;
    exception when others then
      ok := false;
    end;
    if not ok then
      raise exception 'A due date must be a real date, written YYYY-MM-DD.'
        using errcode = 'SN008', hint = 'since_item_due_date_invalid';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists items_due_date_before_write on public.items;
create trigger items_due_date_before_write
  before insert or update on public.items
  for each row execute function public.items_due_date_before_write();

commit;
