/**
 * Dynamic Expo config.
 *
 * Static values live in app.json; secrets are injected here from the
 * environment so they are never committed. `since-fresh` is a public
 * repository, so anything written into app.json is world-readable.
 *
 * Local development: put EXPIRY_API_SECRET in a .env file (gitignored).
 * Expo loads .env automatically — see .env.example.
 *
 * EAS builds: store it as an EAS secret, which is exposed to the build as an
 * environment variable:
 *   eas secret:create --scope project --name EXPIRY_API_SECRET --value <value>
 *
 * When the variable is absent the key is simply empty, and
 * isExpiryScanningConfigured() reports photo scanning as unavailable rather
 * than the app failing to start.
 */

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    expiryApiSecret: process.env.EXPIRY_API_SECRET ?? '',
  },
});
