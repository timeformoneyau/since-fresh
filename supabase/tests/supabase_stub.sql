-- The parts of a Supabase project the schema relies on, for testing on plain
-- Postgres: the anon/authenticated roles, auth.users and auth.uid(). Test
-- use only; a real project already has all of this.
--
-- auth.uid() reads the signed-in user from request.jwt.claim.sub (or the sub
-- in request.jwt.claims), as Supabase's does. Tests "sign in" with:
--   set role authenticated; set request.jwt.claim.sub = '<uuid>';

-- Roles belong to the whole server, so another test database may have made them.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Supabase grants table access to these roles by default; access rules (RLS)
-- then decide which rows each user sees.
alter default privileges in schema public grant all on tables to anon, authenticated;
