#!/usr/bin/env bash
# Tests for data-safety.sh: builds throwaway git repos with the given changed
# files and checks the result. Run by the "Data safety" CI job.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/data-safety.sh"
fails=0

# expect <exit code> <changed files...>
expect() {
  local want=$1; shift
  local dir; dir=$(mktemp -d)
  (
    cd "$dir"
    git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
    base=$(git rev-parse HEAD)
    for f in "$@"; do mkdir -p "$(dirname "$f")"; echo x >> "$f"; done
    git add -A && git -c user.email=t@t -c user.name=t commit -q -m change
    bash "$SCRIPT" "$base" HEAD > /dev/null
  )
  local got=$?
  rm -rf "$dir"
  if [ "$got" = "$want" ]; then echo "ok   ($got) $*"; else echo "FAIL (got $got, want $want) $*"; fails=1; fi
}

# Not sensitive, or information only
expect 0 src/screens/AddItemScreen.tsx
expect 0 src/notifications/engine.ts
expect 0 src/domain/sync/runSync.test.ts
# Sensitive code without a test fails
expect 1 src/domain/sync/engine.ts
expect 1 supabase/schema.sql
expect 1 src/domain/auth/service.ts
expect 1 src/domain/items/service.ts
expect 1 src/types/index.ts
expect 1 src/domain/items/migrations.ts src/domain/items/undo.test.ts
# ...and passes with a test beside it
expect 0 src/domain/sync/engine.ts src/domain/sync/runSync.test.ts
expect 0 supabase/schema.sql src/domain/items/migrations.test.ts
expect 0 src/lib/supabase.ts src/domain/auth/errors.test.ts
expect 0 src/domain/items/migrations.ts src/domain/items/migrations.test.ts
expect 0 src/domain/items/service.ts src/domain/items/undo.test.ts
# The schema: a migration needs a SQL test (or a sync/migrations test) beside it
expect 1 supabase/migrations/003_history_table.sql
expect 0 supabase/migrations/003_history_table.sql supabase/tests/access_rules.test.sql
# ...but a SQL test doesn't stand in for app sync code
expect 1 src/domain/sync/engine.ts supabase/tests/access_rules.test.sql
# Test tooling on its own is not sensitive
expect 0 supabase/tests/run.sh

exit $fails
