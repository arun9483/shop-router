import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // openid-client marks allowInsecureRequests deprecated only so it stands out: servers need it to
      // reach the IdP over plain HTTP inside Docker (MVP-2).
      '@typescript-eslint/no-deprecated': [
        'error',
        { allow: [{ from: 'package', package: 'openid-client', name: 'allowInsecureRequests' }] },
      ],
      // Express error handlers need all four parameters; unused ones start with `_`.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // MVP-2, ADR 0004: only the IdP adapter knows Keycloak. Its endpoints and claim names are refused
  // everywhere else; tests may use them to build tokens.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/auth/idp/keycloak.ts', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/resource_access|realm_access|\\/admin\\/realms|kc-admin-api/]',
          message:
            'Keycloak-specific: only server-common/src/auth/idp/keycloak.ts may use it (ADR 0004).',
        },
        {
          selector:
            'TemplateElement[value.raw=/resource_access|realm_access|\\/admin\\/realms|kc-admin-api/]',
          message:
            'Keycloak-specific: only server-common/src/auth/idp/keycloak.ts may use it (ADR 0004).',
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
