/**
 * Dynamic Expo config.
 *
 * Static values live in app.json. Secrets, when the app needs any, are
 * injected here from the environment so they are never committed:
 * `since-fresh` is a public repository, so anything written into app.json is
 * world-readable. Expo loads a local .env automatically (see .env.example);
 * EAS builds read EAS secrets as environment variables.
 */

module.exports = ({ config }) => ({
  ...config,
});
