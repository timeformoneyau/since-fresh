#!/usr/bin/env bash
# Installs the test APK on the running emulator and runs every Maestro flow.
# Results (report, screenshots, failure details) go to maestro-results/.
set -euo pipefail

OUT=maestro-results
APP=com.since.app
mkdir -p "$OUT"

adb install -r android/app/build/outputs/apk/release/app-release.apk

# Warm-up: the first cold start of a release build on a CI emulator can take
# longer than a flow's launch wait, so open the app once before the flows.
adb shell monkey -p "$APP" -c android.intent.category.LAUNCHER 1 > /dev/null
for _ in $(seq 1 60); do
  adb shell dumpsys window | grep -q "mCurrentFocus.*$APP" && break
  sleep 2
done
sleep 5
adb shell am force-stop "$APP"

# Screenshots from takeScreenshot land in the working directory, so run from $OUT
cd "$OUT"
status=0
maestro test ../.maestro \
  --format junit --output report.xml \
  --debug-output debug || status=$?

# Keep a picture of the final screen for a quick visual check
adb exec-out screencap -p > final-screen.png || true

if [ "$status" -ne 0 ]; then
  # Plain-text clues in the job log, so a failure can be read without
  # downloading the screenshots
  echo "::group::What was on screen at the end"
  adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp" || true
  echo "::endgroup::"
  echo "::group::App errors from the device log"
  adb logcat -d -t 400 | grep -E "AndroidRuntime|ReactNativeJS|FATAL|ANR in" | tail -60 || true
  echo "::endgroup::"
fi

exit $status
