#!/usr/bin/env bash
# One-step rollback for a channel: re-publish the previous update for the
# current runtime, or, if there isn't one, go back to the code that came with
# the installed build.
set -euo pipefail

CHANNEL="${1:?usage: rollback.sh preview|production}"
case "$CHANNEL" in
  preview) export APP_VARIANT=preview ;;
  production) unset APP_VARIANT ;;
  *) echo "unknown channel: $CHANNEL" >&2; exit 2 ;;
esac

EAS="npx -y eas-cli@25.2.0"
SUMMARY=release-summary.md
RUNTIME=$(npx expo-updates runtimeversion:resolve --platform android | tail -1 | jq -r .runtimeVersion)

LIST=$($EAS update:list --branch "$CHANNEL" --runtime-version "$RUNTIME" --limit 10 --json --non-interactive)
# Newest first: [0] is what's live now, [1] the one before it
PREVIOUS=$(echo "$LIST" | jq -r '.currentPage[1] // empty | select(.isRollBackToEmbedded | not) | .group')

if [ -n "$PREVIOUS" ]; then
  $EAS update:republish --group "$PREVIOUS" --platform android \
    --message "Rollback on $CHANNEL" --non-interactive
  echo "### ↩️ $CHANNEL rolled back to the previous update (\`$PREVIOUS\`)" > "$SUMMARY"
else
  $EAS update:roll-back-to-embedded --channel "$CHANNEL" --runtime-version "$RUNTIME" \
    --message "Rollback on $CHANNEL to the installed build" --non-interactive
  echo "### ↩️ $CHANNEL rolled back to the version that came with the installed build" > "$SUMMARY"
fi
echo "Open the app, close it, and open it again to get it." >> "$SUMMARY"
cat "$SUMMARY"
