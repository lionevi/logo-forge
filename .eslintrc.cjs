/* eslint-env node */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  settings: {
    react: { version: '18.3' },
  },
  // src/jsx et src/js sont en ES5 pur pour CEP et ExtendScript : leur
  // conformité est vérifiée par tests/exportEngine.test.ts, pas par ESLint.
  ignorePatterns: ['dist', 'coverage', 'node_modules', '*.cjs', 'src/jsx', 'src/js'],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'error',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'always'],
    'prefer-const': 'error',
  },
  overrides: [
    {
      files: ['tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
}
