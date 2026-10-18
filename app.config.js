/**
 * Dynamic Expo config.
 *
 * Static values live in app.json. Secrets, when the app needs any, are
 * injected here from the environment so they are never committed:
 * `since-fresh` is a public repository, so anything written into app.json is
 * world-readable. Expo loads a local .env automatically (see .env.example);
 * EAS builds read EAS secrets as environment variables.
 */

module.exports = ({ config }) => {
  // CI test builds for the Maestro flows only: drop the Supabase settings so
  // the app runs local-only (no sign-in, no network), exactly as it does on a
  // phone with no cloud config, and don't look for EAS updates. Never set for
  // EAS builds.
  if (process.env.SINCE_LOCAL_ONLY === '1') {
    return {
      ...config,
      extra: { ...config.extra, supabaseUrl: '', supabaseAnonKey: '' },
      updates: { ...config.updates, enabled: false },
    };
  }

  // The "preview" build (eas.json) is a separate app, "Since (preview)", so it
  // installs next to the real one: changes are tried there before production.
  if (process.env.APP_VARIANT === 'preview') {
    return {
      ...config,
      name: 'Since (preview)',
      android: { ...config.android, package: 'com.since.app.preview' },
      ios: { ...config.ios, bundleIdentifier: 'com.since.app.preview' },
    };
  }

  return { ...config };
};
