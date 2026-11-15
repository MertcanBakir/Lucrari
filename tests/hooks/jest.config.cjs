module.exports = {
  ...require('../ui/jest.config.cjs'),
  testMatch: ['<rootDir>/tests/hooks/**/*.test.tsx'],
  collectCoverageFrom: ['hooks/**/*.{ts,tsx}'],
  coverageDirectory: '<rootDir>/coverage/hooks',
};
