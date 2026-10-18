#!/usr/bin/env bash
# Installs the test APK on the running emulator and runs every Maestro flow.
# Results (report, screenshots, failure details) go to maestro-results/.
set -euo pipefail

OUT=maestro-results
mkdir -p "$OUT"

adb install -r android/app/build/outputs/apk/release/app-release.apk

# Screenshots from takeScreenshot land in the working directory, so run from $OUT
cd "$OUT"
status=0
maestro test ../.maestro \
  --format junit --output report.xml \
  --debug-output debug || status=$?

# Keep a picture of the final screen for a quick visual check
adb exec-out screencap -p > final-screen.png || true

exit $status
