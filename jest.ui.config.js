// Component tests (npm run test:ui). Domain tests run on Node's own test
// runner (npm test) and are not touched by this config.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.ui.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.ui.setup.js'],
};
