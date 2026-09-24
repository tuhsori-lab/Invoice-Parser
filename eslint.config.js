import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  // public/ holds library files copied out of node_modules by `npm run assets`.
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'public/**',
      'tests/fixtures/pdf/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '18.3' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Without these, anything used only inside JSX looks unused.
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  {
    // The core engine must stay framework-free so it can be unit tested on its own.
    files: ['src/core/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['react', 'react-dom', 'react/*', 'react-dom/*', '../ui/*', '../components/*'],
        },
      ],
    },
  },
];
