module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  settings: {
    'import/resolver': {
      typescript: { alwaysTryTypes: true, project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'] },
      node: { extensions: ['.ts', '.tsx', '.js', '.jsx'] },
    },
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'import/no-cycle': 'error',
    'import/order': ['warn', { groups: ['builtin', 'external', 'internal', 'parent', 'sibling'], 'newlines-between': 'always' }],
    // Enforce package dependency rules (see ARCHITECTURE.md §2)
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['@pazzera/core/*/../../apps/*'], message: 'core cannot import from apps' },
        { group: ['@pazzera/db/*/../../packages/agents/*'], message: 'db cannot depend on agents' },
        { group: ['@pazzera/storage/*/../../packages/agents/*'], message: 'storage cannot depend on agents' },
      ],
    }],
  },
  ignorePatterns: ['node_modules', 'dist', '.next', 'coverage', 'playwright-report'],
};