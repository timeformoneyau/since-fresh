-- Migration 005 — who looks after a shared item (Phase 3, "Shared load")
--
-- RUN ORDER: after 004, and before installing the build that lets people
-- choose who looks after an item. Earlier builds ignore everything here: they
-- never send items.looked_after_by, so their writes leave it as it is, and
-- the access rules are unchanged.
--
-- Needs Postgres 15 or later (on delete set null with a column list).
--
-- Additive only. What it adds:
--   - items.looked_after_by: null means "Anyone" (every member is reminded,
--     as before). Otherwise the member who looks after the item.
--   - It is tied to the item's household by a foreign key to
--     household_members, so:
--       - it can only name a member of that item's household;
--       - it clears by itself when that person's membership ends: leaving,
--         being removed, deleting their account, or the household going.
--   - A personal item (no household) can't have one.
--   - Changing an item to "Just me" clears it, including from builds that
--     don't know the column (they never send it).
--   - Who may change it: any member, under the existing items_update rule.
--     It's coordination, not permission, so there's no new rule.
--
-- One transaction, safe to re-run: each step checks the current state first.

begin;

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

commit;
