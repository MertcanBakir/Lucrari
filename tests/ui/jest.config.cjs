module.exports = {
  rootDir: '../..',
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/ui/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/ui/setup.ts'],
  collectCoverageFrom: ['components/**/*.{ts,tsx}'],
  coverageDirectory: '<rootDir>/coverage/ui',
  coverageThreshold: { global: { lines: 85 } },
  coverageReporters: ['text', 'lcov'],
};
