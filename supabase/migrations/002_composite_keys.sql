-- Migration 002 — composite item keys (accounts plan, Phase 2, fixes F4)
--
-- RUN ORDER: run this migration BEFORE installing the new app build.
-- The new app's items upsert names (user_id, id) as its conflict target.
-- Postgres rejects that upsert unless a unique constraint on exactly those
-- columns exists, so every sync from the new build fails until this has run.
--
-- What it does:
--   1. public.items: the primary key changes from (id) to (user_id, id), so two
--      accounts can hold the same item id without colliding.
--   2. public.items: drops expiry_date, source and items_source_check, which
--      are left over from food tracking (removed in Phase 1).
--
-- Left as is: public.deleted_items (already keyed on (id, user_id)), row-level
-- security and its policies, items_user_updated_idx, and delete_user().
--
-- One transaction, safe to re-run: each step checks the current state first.

begin;

-- ─── 1. items primary key → (user_id, id) ──────────────────────────────────
do $$
declare
  pk_name text;
  pk_cols text[];
begin
  select c.conname,
         array(
           select a.attname::text
           from unnest(c.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a
             on a.attrelid = c.conrelid and a.attnum = k.attnum
           order by k.ord
         )
    into pk_name, pk_cols
  from pg_constraint c
  where c.conrelid = 'public.items'::regclass
    and c.contype = 'p';

  if pk_cols is distinct from array['user_id', 'id'] then
    if pk_name is not null then
      execute format('alter table public.items drop constraint %I', pk_name);
    end if;
    alter table public.items
      add constraint items_pkey primary key (user_id, id);
  end if;
end $$;

-- ─── 2. Remove food-tracking leftovers ──────────────────────────────────────
alter table public.items drop constraint if exists items_source_check;
alter table public.items drop column if exists source;
alter table public.items drop column if exists expiry_date;

commit;
