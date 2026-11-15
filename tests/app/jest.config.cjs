module.exports = {
  ...require('../ui/jest.config.cjs'),
  testMatch: ['<rootDir>/tests/app/**/*.test.tsx'],
  collectCoverageFrom: ['app/**/*.{ts,tsx}'],
  coverageDirectory: '<rootDir>/coverage/app',
};
