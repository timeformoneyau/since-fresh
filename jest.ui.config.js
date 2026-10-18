// Component tests (npm run test:ui). Domain tests run on Node's own test
// runner (npm test) and are not touched by this config.
const androidPreset = require('jest-expo/android/jest-preset');

// jest-expo's Android preset doesn't point babel-jest at Expo's Babel config
// (this repo has no babel.config.js), so add it, as the default preset does.
const JS = '\\.[jt]sx?$';
const [jsTransformer, jsOptions] = androidPreset.transform[JS];

module.exports = {
  // Android-first app: Platform.OS is 'android' in component tests
  preset: 'jest-expo/android',
  transform: {
    ...androidPreset.transform,
    [JS]: [jsTransformer, { ...jsOptions, configFile: require.resolve('expo/internal/babel-preset.js') }],
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.ui.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.ui.setup.js'],
};
