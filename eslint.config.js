import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * String-HTML sinks are banned project-wide, not just in content scripts.
 * Google and other sites enforce Trusted Types; any one of these throws there
 * and takes the whole injected UI down with it. `createElement` +
 * `textContent` + `append` is the only sanctioned path.
 */
const TRUSTED_TYPES_BANNED_SINKS = [
  {
    selector:
      'MemberExpression[property.name=/^(innerHTML|outerHTML)$/]:not([computed=true])',
    message:
      'Trusted-Types violation: innerHTML/outerHTML are banned. Use createElement + textContent + append.',
  },
  {
    selector:
      'CallExpression[callee.property.name=/^(insertAdjacentHTML|write|writeln)$/]',
    message:
      'Trusted-Types violation: string-HTML sinks are banned. Use createElement + textContent + append.',
  },
  {
    selector: "NewExpression[callee.name='Function']",
    message: 'Dynamic code evaluation is banned (CSP + review risk).',
  },
];

export default tseslint.config(
  {
    ignores: [
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'dist/**',
      'playwright-report/**',
      'test-results/**',
      'playground/vendor/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-restricted-syntax': ['error', ...TRUSTED_TYPES_BANNED_SINKS],
      'no-eval': 'error',
      'no-implied-eval': 'error',

      // Unused vars are errors, but `_`-prefixed ones are intentional.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Explicit is better than implicit for a security-sensitive codebase.
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  // Principle 2: API keys are background-worker-only. A content script runs in
  // a page the user did not write, so a key must never enter its heap. This is
  // the mechanical enforcement of that rule — reviews forget, CI does not.
  {
    files: [
      'entrypoints/content*.ts',
      'entrypoints/content*/**/*.ts',
      'lib/ui/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/storage/credentials', '**/providers/**'],
              message:
                'Content scripts must never import credentials or provider adapters. Go through the background worker via lib/messaging/protocol.',
            },
          ],
        },
      ],
    },
  },

  // Plain-JS config files sit outside the TS project, so type-aware rules
  // have nothing to work with.
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Config files and tests run in Node and aren't part of the shipped bundle.
  {
    files: ['*.config.ts', 'tests/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },

  prettier,
);
