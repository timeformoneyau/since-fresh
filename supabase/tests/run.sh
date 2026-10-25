#!/usr/bin/env bash
# Database tests. Builds the schema two ways, checks they end the same, and
# runs the access-rule tests against each:
#   - fresh:   a new project (supabase/schema.sql)
#   - upgrade: an existing project (the schema before 003, then 003 to 007)
# Each migration is applied twice, to prove re-running it changes nothing.
#
# Needs a Postgres superuser, given by the usual PG* environment variables.
# CI runs it against a Postgres service (.github/workflows/ci.yml).
set -euo pipefail
cd "$(dirname "$0")"

PSQL=(psql -X -q -v ON_ERROR_STOP=1)
# Only the checks and real problems are printed
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

newdb() {
  "${PSQL[@]}" -d postgres -c "drop database if exists $1" -c "create database $1"
}

apply() {
  local db=$1; shift
  for f in "$@"; do "${PSQL[@]}" -d "$db" -f "$f" > /dev/null; done
}

# Tables, columns, constraints, indexes, triggers, access rules, functions and grants, as text
describe() {
  "${PSQL[@]}" -d "$1" -At <<'SQL'
select 'column ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
  from information_schema.columns where table_schema = 'public'
union all
select 'constraint ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
  from pg_constraint where connamespace = 'public'::regnamespace
union all
select 'index ' || indexdef from pg_indexes where schemaname = 'public'
union all
select 'trigger ' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
union all
select 'policy ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
  from pg_policies where schemaname = 'public'
union all
select 'rls ' || relname || ' ' || relrowsecurity from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r'
union all
-- Functions: body, settings and who may call them
select 'function ' || p.oid::regprocedure || ' ' || md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '')
  from pg_proc p where p.pronamespace = 'public'::regnamespace
union all
select 'grant ' || table_name || ' ' || grantee || ' ' || privilege_type
  from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')
order by 1;
SQL
}

newdb since_test_fresh
apply since_test_fresh supabase_stub.sql ../schema.sql
fresh=$(describe since_test_fresh)

newdb since_test_upgrade
apply since_test_upgrade supabase_stub.sql fixtures/schema_before_003.sql \
  ../migrations/003_history_table.sql ../migrations/003_history_table.sql \
  ../migrations/004_households.sql ../migrations/004_households.sql \
  ../migrations/005_looked_after_by.sql ../migrations/005_looked_after_by.sql \
  ../migrations/006_play_hardening.sql ../migrations/006_play_hardening.sql \
  ../migrations/007_due_date.sql ../migrations/007_due_date.sql

if ! diff <(echo "$fresh") <(describe since_test_upgrade); then
  echo "FAILED: a fresh project and an upgraded one end with different schemas (diff above)"
  exit 1
fi
echo "ok   a fresh project and an upgraded one end with the same schema"

# Running the newest migrations again on a project that already has them (or
# was set up fresh) is harmless. Migrations run in order: an older one run
# after a newer one would put back the older versions of its functions.
apply since_test_fresh ../migrations/005_looked_after_by.sql ../migrations/006_play_hardening.sql \
  ../migrations/007_due_date.sql
if ! diff <(echo "$fresh") <(describe since_test_fresh); then
  echo "FAILED: re-running migrations 005 to 007 changed the schema (diff above)"
  exit 1
fi
echo "ok   re-running migrations 005 to 007 changes nothing"

# Each test file runs on a fresh copy of both schemas, so tests can't
# depend on each other's rows
for test in *.test.sql; do
  for route in fresh upgrade; do
    db="since_test_${route}_run"
    "${PSQL[@]}" -d postgres -c "drop database if exists $db" -c "create database $db template since_test_$route"
    echo "── $test ($route)"
    "${PSQL[@]}" -d "$db" -f "$test" 2>&1 | sed -n 's/^.*WARNING:  //p; /FAILED/p; /ERROR/p'
    # psql exits non-zero on the first failure; pipefail carries it here
    "${PSQL[@]}" -d postgres -c "drop database $db"
  done
done

"${PSQL[@]}" -d postgres -c "drop database since_test_fresh" -c "drop database since_test_upgrade"
echo "All database tests passed."
