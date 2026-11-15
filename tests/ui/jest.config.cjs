module.exports = {
  rootDir: '../..',
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/ui/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/ui/setup.ts'],
  collectCoverageFrom: ['components/**/*.{ts,tsx}'],
  coverageDirectory: '<rootDir>/coverage/ui',
  coverageReporters: ['text', 'lcov'],
};
