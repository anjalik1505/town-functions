// eslint.config.js  (flat config for ESLint v9+)
// Using CJS so we can require config objects dynamically. If you prefer ESM, rename to .mjs and switch to import/export.

module.exports = [
  // ignore build output and deps
  {ignores: ['lib/**', 'node_modules/**']},

  // TypeScript & Prettier for .ts/.js files
  {
    files: ['**/*.{ts,js}'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
      prettier: require('eslint-plugin-prettier'),
    },
    rules: {
      // ts plugin recommended rules
      ...require('@typescript-eslint/eslint-plugin').configs.recommended.rules,
      // run Prettier as an ESLint rule
      'prettier/prettier': ['error'],
      'linebreak-style': ['error', 'unix'],
    },
  },
];
