import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

// The extension ids of next and the plan: none may be a literal in the app host program.
export const EXTENSION_IDS =
  '/^(account|catalog|cloud|dashboard|docs|fixture|logs|market|memory|platform|probe|root|users)$/';

// The host kind 'cloud' is also an extension id: allowed only as a kind value or a kind comparison.
const KIND_VALUE = "Property[key.name='kind'] > Literal[value='cloud']";
const KIND_COMPARE =
  "BinaryExpression[operator=/^[!=]==$/][left.property.name='kind'] > Literal.right[value='cloud']";

export default [
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'packages/extension/schemas/**',
      'packages/widget/src/ds/styles.generated.ts',
      'packages/shell-dashboard/dist-e2e/**',
      'packages/shell-dashboard/.vendor/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  {
    files: [
      'packages/*/src/**/*.{ts,tsx}',
      'packages/widget/e2e/**/*.ts',
      'packages/widget/*.config.ts',
      'packages/shell-dashboard/e2e/**/*.{ts,tsx}',
      'packages/shell-dashboard/*.config.ts',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        project: ['./packages/*/tsconfig.eslint.json'],
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      prettier: prettierPlugin,
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: { regex: '^[A-Z]', match: true },
        },
        {
          selector: 'typeAlias',
          format: ['PascalCase'],
        },
      ],
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'arrow-body-style': ['error', 'as-needed'],
      'no-var': 'error',
    },
  },
  {
    files: [
      'packages/widget/src/**/*.tsx',
      'packages/app/src/**/*.{ts,tsx}',
      'packages/shell-dashboard/src/**/*.{ts,tsx}',
      'packages/shell-dashboard/e2e/**/*.tsx',
    ],
    plugins: { 'jsx-a11y': jsxA11y, 'react-hooks': reactHooks },
    rules: { ...jsxA11y.flatConfigs.recommended.rules, ...reactHooks.configs.recommended.rules },
  },
  {
    files: [
      'packages/widget/src/**/*.{ts,tsx}',
      'packages/identity/src/**/*.ts',
      'packages/shell/src/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zod',
              message:
                "Use `import * as z from 'zod/mini'`: full zod puts about 400 KB into every bundle.",
            },
          ],
        },
      ],
    },
  },
  {
    // J.4.3 row 6: the app host program names no extension; ids come from its installation.
    files: ['packages/apphost/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // A type or a kind value names a host kind ('cloud'), not an extension the program runs.
          selector: `Literal[value=${EXTENSION_IDS}]:not(TSLiteralType > Literal):not(${KIND_VALUE}):not(${KIND_COMPARE})`,
          message: 'An extension id in the app host program: read it from the installation.',
        },
        {
          selector: `TemplateElement[value.raw=${EXTENSION_IDS}]`,
          message: 'An extension id in the app host program: read it from the installation.',
        },
      ],
    },
  },
];
