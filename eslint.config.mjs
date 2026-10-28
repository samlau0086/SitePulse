import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/next-env.d.ts',
      '**/migrations/meta/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/test-deploy-ssh.mjs'],
    rules: { 'no-undef': 'error' },
  },
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  prettier,
);
