#!/usr/bin/env bash
# Publish the current commit to one EAS channel (preview or production).
#
#   JavaScript-only change -> EAS Update (installed apps get it on next launch)
#   Native change          -> a new EAS build (needs installing once)
#
# The two are told apart by the runtime version, a fingerprint of everything
# native (app.json native config, permissions, native packages). An update is
# only published if a build with the same fingerprint exists, so an update can
# never land on an app it doesn't fit.
#
# Writes a plain-language summary to release-summary.md.
set -euo pipefail

CHANNEL="${1:?usage: release.sh preview|production}"
case "$CHANNEL" in
  preview) export APP_VARIANT=preview ;;   # the separate "Since (preview)" app
  production) unset APP_VARIANT ;;
  *) echo "unknown channel: $CHANNEL" >&2; exit 2 ;;
esac

EAS="npx -y eas-cli@25.2.0"
MSG="$(git log -1 --format='%s (%h)')"
SUMMARY=release-summary.md

RUNTIME=$(npx expo-updates runtimeversion:resolve --platform android | tail -1 | jq -r .runtimeVersion)
echo "Runtime version (fingerprint) for $CHANNEL: $RUNTIME"

# Any build for this fingerprint that is finished or still on its way counts:
# an update published now reaches it as soon as it is installed.
BUILDS=$($EAS build:list --platform android --build-profile "$CHANNEL" \
  --runtime-version "$RUNTIME" --limit 20 --json --non-interactive)
MATCHING=$(echo "$BUILDS" | jq '[.[] | select(.status == "FINISHED" or .status == "IN_PROGRESS" or .status == "IN_QUEUE" or .status == "NEW")] | length')

if [ "$MATCHING" -gt 0 ]; then
  OUT=$($EAS update --channel "$CHANNEL" --environment "$CHANNEL" --platform android \
    --message "$MSG" --non-interactive --json)
  GROUP=$(echo "$OUT" | jq -r '.[0].group')
  cat > "$SUMMARY" <<MD
### ✅ $CHANNEL: update published

**$MSG** was sent to the **$CHANNEL** app as an over-the-air update (update group \`$GROUP\`).
Nothing to install: open the app, close it, and open it again to get it.
MD
else
  OUT=$($EAS build --platform android --profile "$CHANNEL" --non-interactive --no-wait \
    --message "$MSG" --json)
  URL=$(echo "$OUT" | jq -r '.[0] | "https://expo.dev/accounts/\(.app.ownerAccount.name)/projects/\(.app.slug)/builds/\(.id)"')
  cat > "$SUMMARY" <<MD
### 📦 $CHANNEL: new build needed (native change)

**$MSG** changes native parts of the app (for example app.json settings, permissions or
native packages), which an over-the-air update can't deliver. A new **$CHANNEL** build has
been started.

**Install it from:** $URL
(It takes about 10–20 minutes. Open that link on your phone when the build shows *Finished*
and tap **Install**.)
MD
fi

cat "$SUMMARY"
