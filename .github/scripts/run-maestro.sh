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

# Text snapshot of the current screen, readable straight from the job log:
# keyboard state, app window size, and where each element with a testID sits.
describe_screen() {
  echo "::group::Screen state: $1"
  adb shell dumpsys input_method | grep -E "mInputShown|mIsInputViewShown" | head -2 || true
  echo "Keyboard window:"
  adb shell dumpsys window InputMethod | grep -E "mFrame=|touchable region" | head -3 || true
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 || true
  adb shell cat /sdcard/ui.xml 2>/dev/null | python3 -c '
import re, sys
xml = sys.stdin.read()
for node in re.findall(r"<node [^>]*>", xml):
    rid = re.search(r"resource-id=\"([^\"]*)\"", node).group(1)
    cls = re.search(r"class=\"([^\"]*)\"", node).group(1)
    b = re.search(r"bounds=\"([^\"]*)\"", node).group(1)
    if rid or cls.endswith("ScrollView"):
        print(f"{rid or cls:40} {b}")
' || true
  echo "::endgroup::"
}

# The keyboard/Save flow first and on its own, so a failure can be described
# while its screen is still showing
if [ -f ../.maestro/07-add-keyboard-save.yaml ] && \
   ! maestro test ../.maestro/07-add-keyboard-save.yaml --debug-output debug-07; then
  status=1
  describe_screen "07 failed (keyboard open on Add)"
fi

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
