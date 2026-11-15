const coverageThreshold = {
  branches: 85,
  functions: 85,
  lines: 85,
  statements: 85,
};

module.exports = {
  ...require('./ui/jest.config.cjs'),
  rootDir: '..',
  testMatch: ['<rootDir>/tests/**/*.test.{ts,tsx}'],
  collectCoverageFrom: ['{app,components,hooks,services,utils}/**/*.{ts,tsx}'],
  coverageDirectory: '<rootDir>/coverage/all',
  coverageThreshold: {
    './app/': coverageThreshold,
    './components/': coverageThreshold,
    './hooks/': coverageThreshold,
    './services/': coverageThreshold,
    './utils/': coverageThreshold,
  },
  coverageReporters: ['text', 'lcov', 'json'],
};
