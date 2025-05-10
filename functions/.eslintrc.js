module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {ecmaVersion: 2023, sourceType: 'module'},
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  rules: {
    'linebreak-style': ['error', 'unix'],
  },
};
