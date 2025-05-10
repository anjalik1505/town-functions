// eslint.config.js  (flat config for ESLint v9+)
// Using ESM syntax.

import tsParser from '@typescript-eslint/parser';
import tsEslintPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  // ignore build output and deps
  {ignores: ['lib/**', 'node_modules/**']},

  // TypeScript & Prettier for .ts/.js files
  {
    files: ['**/*.{ts,js}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsEslintPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      // ts plugin recommended rules
      ...tsEslintPlugin.configs.recommended.rules,
      // run Prettier as an ESLint rule
      'prettier/prettier': ['error'],
      'linebreak-style': ['error', 'unix'],
    },
  },
];
