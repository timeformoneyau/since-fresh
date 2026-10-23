/**
 * Guards for the Play packaging settings (readiness audit, Q2 and Q5): the
 * store profile builds an app bundle, the everyday APK profiles stay as they
 * are, and permissions nothing uses stay blocked. CI also checks the built
 * APK's permissions (ci.yml, "Permissions in the release build").
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
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ]);
    assert.deepEqual(app.android.permissions, [
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.POST_NOTIFICATIONS',
    ]);
  });
});
