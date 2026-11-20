// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    files: ['**/*.{ts,tsx,js,cjs}'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['utils/logger.ts', 'tests/**/*.{ts,tsx,cjs}'],
    rules: { 'no-console': 'off' },
  },
  {
    ignores: ['dist/*'],
  },
]);
