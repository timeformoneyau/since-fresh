#!/usr/bin/env bash
# Data safety check for a change (base..head).
#
# Says which sensitive areas the change touches: stored data, sync, sign-in
# (auth), notifications. That part is information only.
#
# Fails if stored data, sync or sign-in code changed without a test change
# beside it, because there is no human approval step: the test is what proves
# that data saved by the current app still loads (see CLAUDE.md, "Data safety").
#
#   data-safety.sh <base-sha> <head-sha>
# Writes a short markdown summary to data-safety.md.
set -euo pipefail

BASE="${1:?usage: data-safety.sh <base> <head>}"
HEAD="${2:?usage: data-safety.sh <base> <head>}"
OUT=data-safety.md

CHANGED=$(git diff --name-only "$BASE...$HEAD")

touched() { echo "$CHANGED" | grep -Eq "$1"; }
join() { local out="$1"; shift; for x in "$@"; do out="$out; $x"; done; echo "$out"; }
code_touched() { echo "$CHANGED" | grep -E "$1" | grep -Evq '\.test\.tsx?$'; }

# For each area: its name, the code that counts, and the tests that cover it
NAMES=(
  "stored data (item shape, storage, migrations)"
  "stored data (item changes)"
  "sync"
  "the Supabase schema"
  "sign-in (auth)"
)
CODE=(
  '^src/domain/items/(storage|migrations|cloudStorage|types)\.ts$|^src/types/'
  '^src/domain/items/service\.ts$'
  '^src/domain/sync/'
  '^supabase/(schema\.sql|migrations/)'
  '^src/domain/auth/|^src/lib/supabase\.ts$'
)
# The schema's own tests run the SQL on Postgres (supabase/tests/run.sh).
# Service tests that need AsyncStorage run under Jest, beside the service
# (src/domain/items/__tests__/).
TESTS=(
  '^src/domain/items/migrations\.test\.ts$'
  '^src/domain/items/[^/]+\.test\.ts$|^src/domain/items/__tests__/[^/]+\.ui\.test\.tsx$'
  '^src/domain/(sync/[^/]+|items/migrations)\.test\.ts$'
  '^supabase/tests/[^/]+\.test\.sql$|^src/domain/(sync/[^/]+|items/migrations)\.test\.ts$'
  '^src/domain/(auth/[^/]+|items/migrations)\.test\.ts$'
)

flags=()
missing=()
for i in "${!NAMES[@]}"; do
  if code_touched "${CODE[$i]}"; then
    flags+=("${NAMES[$i]}")
    touched "${TESTS[$i]}" || missing+=("${NAMES[$i]}")
  fi
done
if touched '^src/notifications/'; then flags+=("notifications"); fi

{
  echo "### Data safety"
  if [ ${#flags[@]} -eq 0 ]; then
    echo "Touches stored data, sync, sign-in or notifications: **no**."
  else
    echo "Touches: **$(join "${flags[@]}")** (information only)."
  fi
  if [ ${#missing[@]} -gt 0 ]; then
    echo
    echo "❌ Missing a test for: **$(join "${missing[@]}")**."
    echo "Add or update a test showing data saved by the current app still loads (CLAUDE.md, rule 8)."
  fi
} > "$OUT"
cat "$OUT"

[ ${#missing[@]} -eq 0 ]
