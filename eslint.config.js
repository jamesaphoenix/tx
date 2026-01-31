// @ts-check
/**
 * @fileoverview ESLint flat config for tx project
 *
 * This configuration uses the modern ESLint flat config format (eslint.config.js)
 * and includes the custom tx plugin for enforcing code quality rules.
 *
 * Rule: tx/require-integration-tests
 * Enforces that major components have corresponding integration tests with adequate coverage.
 *
 * Rule: tx/no-inline-sql
 * Prevents SQL DDL statements (CREATE TABLE, etc.) from being defined inline in TypeScript code.
 * SQL schema definitions should be in migrations/*.sql files.
 *
 * Rule: tx/require-component-tests
 * Enforces that components, hooks, and services have corresponding test files.
 * - Every .tsx file in src/components/ MUST have a corresponding .test.tsx in __tests__/
 * - Every .ts file in src/hooks/ MUST have a corresponding .test.ts in __tests__/
 * - Every file in src/services/ MUST have integration test coverage
 *
 * Rule: tx/require-effect-error-handling
 * Enforces Effect-TS error handling patterns:
 * - Effect.runPromise calls MUST be wrapped in try/catch or use Effect.either
 * - Services returning Effect<T, E> MUST have E properly typed (no unknown)
 *
 * Rule: tx/no-raw-promises-in-services
 * Prevents raw Promise usage in service layer:
 * - Files in src/services/ MUST NOT use raw Promise (use Effect instead)
 * - Async/await only allowed in CLI layer, not service layer
 *
 * Rule: tx/require-taskwithdeps-return
 * Enforces CLAUDE.md RULE 1:
 * - Functions returning task data MUST return TaskWithDeps, not bare Task
 * - MCP tool handlers MUST include blockedBy, blocks, children, isReady
 * - API endpoints returning tasks MUST use TaskWithDeps[]
 *
 * Detection logic for require-integration-tests:
 * - Parses source files for exported functions/classes
 * - Checks for corresponding describe() blocks in test files
 * - Reports error if coverage < threshold (default 80%)
 *
 * Detection logic for no-inline-sql:
 * - Detects SQL DDL keywords in string/template literals
 * - Allows in: migrations/*.sql, test/fixtures/*
 * - Error message: 'SQL schema definitions must be in migrations/*.sql files'
 *
 * Reference: Agent swarm audit findings - services 93-98% covered, CLI 71% covered, dashboard API 0% covered
 * Reference: DD-002 Effect-TS patterns, CLAUDE.md RULE 5
 */

import eslint from '@eslint/js';
import tseslintPlugin from '@typescript-eslint/eslint-plugin';
import tseslintParser from '@typescript-eslint/parser';
import txPlugin from './eslint-plugin-tx/index.js';

export default [
  eslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint-plugin-tx/**']
  },
  // Main source and test files
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tseslintPlugin,
      tx: txPlugin
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off', // Handled by @typescript-eslint
      'no-undef': 'off', // TypeScript handles this

      // tx plugin rules - enforce integration test coverage
      'tx/require-integration-tests': ['warn', {
        services: { src: 'src/services', test: 'test/integration', threshold: 90 },
        repos: { src: 'src/repo', test: 'test/integration', threshold: 85 },
        cli: { src: 'src/cli.ts', test: 'test/integration/cli-*.test.ts', threshold: 70 },
        mcp: { src: 'src/mcp/server.ts', test: 'test/integration/mcp.test.ts', threshold: 80 }
      }],

      // tx plugin rules - enforce SQL schema definitions in migrations/
      'tx/no-inline-sql': ['error', {
        allowedPaths: ['migrations/', 'test/fixtures/'],
        ddlKeywords: ['CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE']
      }],

      // tx plugin rules - enforce Effect-TS error handling patterns (CLAUDE.md RULE 5)
      'tx/require-effect-error-handling': ['warn', {
        allowedPaths: ['test/', 'tests/', '__tests__/', '.test.', '.spec.'],
        checkTypeAnnotations: true
      }],

      // tx plugin rules - no raw Promises in service layer (CLAUDE.md RULE 5)
      'tx/no-raw-promises-in-services': ['error', {
        servicePaths: ['src/services/']
      }],

      // tx plugin rules - require TaskWithDeps for external APIs (CLAUDE.md RULE 1)
      'tx/require-taskwithdeps-return': ['warn', {
        externalPaths: ['src/mcp/', 'apps/api-server/', 'apps/agent-sdk/', 'packages/core/src/'],
        internalPaths: ['src/repo/', 'src/services/', 'test/', 'tests/', '__tests__/', '.test.', '.spec.'],
        checkObjectLiterals: true
      }]
    }
  },
  // Packages (types, core, etc.)
  {
    files: ['packages/**/*.ts'],
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tseslintPlugin,
      tx: txPlugin
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',

      // tx plugin rules - enforce SQL schema definitions in migrations/
      'tx/no-inline-sql': ['error', {
        allowedPaths: ['migrations/', 'test/fixtures/'],
        ddlKeywords: ['CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE']
      }]
    }
  },
  // Dashboard app files (with separate API test requirements)
  {
    files: ['apps/dashboard/**/*.ts'],
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tseslintPlugin,
      tx: txPlugin
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',

      // Dashboard API integration test coverage
      'tx/require-integration-tests': ['warn', {
        api: { src: 'apps/dashboard/server', test: 'test/integration/dashboard-api.test.ts', threshold: 80 }
      }],

      // tx plugin rules - enforce SQL schema definitions in migrations/
      'tx/no-inline-sql': ['error', {
        allowedPaths: ['migrations/', 'test/fixtures/'],
        ddlKeywords: ['CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE']
      }]
    }
  },
  // Dashboard React components and hooks (require component tests)
  {
    files: ['apps/dashboard/**/*.tsx', 'apps/dashboard/src/hooks/**/*.ts'],
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    plugins: {
      '@typescript-eslint': tseslintPlugin,
      tx: txPlugin
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',

      // Enforce component and hook tests - principal engineer principle: if it's not tested, it doesn't exist
      'tx/require-component-tests': ['error', {
        components: { pattern: 'apps/dashboard/src/components/**/*.tsx', testDir: '__tests__', testSuffix: '.test.tsx' },
        hooks: { pattern: 'apps/dashboard/src/hooks/**/*.ts', testDir: '__tests__', testSuffix: '.test.ts' }
      }]
    }
  }
];
