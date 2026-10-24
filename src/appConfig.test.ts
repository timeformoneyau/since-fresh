/**
 * Guards for the Play packaging settings (readiness audit, Q2, Q5, Q7, Q13):
 * the store profile builds an app bundle, the everyday APK profiles stay as
 * they are, permissions nothing uses stay blocked, there are no exact alarms
 * and no Android auto backup. CI also checks the built APK (ci.yml,
 * "Permissions in the release build").
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const app = read('app.json').expo;
const eas = read('eas.json').build;

describe('Play packaging', () => {
  test('the play profile builds an app bundle for the store, on the production channel', () => {
    assert.equal(eas.play.android.buildType, 'app-bundle');
    assert.equal(eas.play.distribution, 'store');
    assert.equal(eas.play.channel, 'production');
    assert.equal(eas.play.environment, 'production');
    assert.equal(eas.play.autoIncrement, true);
  });

  test('the production and preview profiles still build APKs to install directly', () => {
    assert.deepEqual(eas.production, {
      autoIncrement: true,
      environment: 'production',
      channel: 'production',
      distribution: 'internal',
      android: { buildType: 'apk' },
    });
    assert.equal(eas.preview.android.buildType, 'apk');
  });

  test('permissions nothing uses are blocked, and the reminder ones are kept', () => {
    assert.deepEqual([...app.android.blockedPermissions].sort(), [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.USE_EXACT_ALARM',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ]);
    assert.deepEqual(app.android.permissions, [
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.POST_NOTIFICATIONS',
    ]);
  });

  test("Android auto backup is off, so the sign-in session isn't copied to a Google backup", () => {
    assert.equal(app.android.allowBackup, false);
  });
});

describe('Reminders without exact alarms', () => {
  const lib = (file: string) =>
    readFileSync(new URL(`../node_modules/expo-notifications/android/src/main/${file}`, import.meta.url), 'utf8');

  test("expo-notifications doesn't ask for exact alarms itself", () => {
    assert.doesNotMatch(lib('AndroidManifest.xml'), /SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM/);
  });

  test('without the permission, expo-notifications still schedules, as an inexact alarm', () => {
    // Its scheduler (ExpoSchedulingDelegate.setupAlarm) uses an exact alarm only
    // when the phone allows one, and otherwise falls back to an inexact one
    // that still fires in Doze. Fails if an upgrade drops that fallback.
    const delegate = lib('java/expo/modules/notifications/service/delegates/ExpoSchedulingDelegate.kt');
    assert.match(
      delegate,
      /canScheduleExactAlarms\(\)\)\s*\{\s*AlarmManagerCompat\.setExactAndAllowWhileIdle[\s\S]*?\}\s*else\s*\{\s*AlarmManagerCompat\.setAndAllowWhileIdle/,
    );
  });
});
