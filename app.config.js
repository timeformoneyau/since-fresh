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
  // phone with no cloud config. Never set for EAS builds.
  if (process.env.SINCE_LOCAL_ONLY === '1') {
    return {
      ...config,
      extra: { ...config.extra, supabaseUrl: '', supabaseAnonKey: '' },
    };
  }
  return { ...config };
};
