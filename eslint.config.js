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
 * - Every .tsx file in components/ MUST have a corresponding .test.tsx in __tests__/
 * - Every .ts file in hooks/ MUST have a corresponding .test.ts in __tests__/
 * - Every file in services/ MUST have integration test coverage
 *
 * Rule: tx/require-effect-error-handling
 * Enforces Effect-TS error handling patterns:
 * - Effect.runPromise calls MUST be wrapped in try/catch or use Effect.either
 * - Services returning Effect<T, E> MUST have E properly typed (no unknown)
 *
 * Rule: tx/no-raw-promises-in-services
 * Prevents raw Promise usage in service layer:
 * - Files in services/ MUST NOT use raw Promise (use Effect instead)
 * - Async/await only allowed in CLI layer, not service layer
 *
 * Rule: tx/require-taskwithdeps-return
 * Enforces CLAUDE.md RULE 1:
 * - Functions returning task data MUST return TaskWithDeps, not bare Task
 * - MCP tool handlers MUST include blockedBy, blocks, children, isReady
 * - API endpoints returning tasks MUST use TaskWithDeps[]
 *
 * Rule: tx/test-coverage-thresholds
 * Enforces DD-007 coverage targets programmatically:
 * - Core services (packages/core/src/services/): 90% line coverage required
 * - Repositories (packages/core/src/repo/): 85% line coverage
 * - CLI commands (apps/cli/): 80% line coverage
 * - Dashboard components/hooks: 75% line coverage
 * Run separately: npm run lint:coverage (after npm test -- --coverage)
 *
 * Rule: tx/interface-parity
 * Enforces that CLI, MCP, and API handlers return identical response shapes:
 * - done/complete operations MUST return { task: TaskWithDepsSerialized, nowReady: TaskWithDepsSerialized[] }
 * - ready operations MUST return { tasks: TaskWithDepsSerialized[], count?: number }
 * - Flags duplicate serializeTask() definitions (should import from @jamesaphoenix/tx-types)
 * - Flags ID arrays where task arrays expected (nowReady should be tasks, not IDs)
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
 * Rule: tx/no-hono
 * Enforces CLAUDE.md DOCTRINE RULE 10:
 * - Disallows imports from 'hono', 'hono/*', or '@hono/*'
 * - Use @effect/platform HttpApi instead
 *
 * Rule: tx/no-zod
 * Enforces CLAUDE.md DOCTRINE RULE 10:
 * - Disallows imports from 'zod', 'zod/*', or '@hono/zod-*'
 * - Use Effect Schema (import { Schema } from "effect") instead
 *
 * Rule: tx/no-throw-in-services
 * Enforces CLAUDE.md DOCTRINE RULE 5:
 * - Disallows throw statements in service code
 * - Use Effect.fail() with typed errors instead
 * - Excludes test files (.test., .spec., __tests__/)
 * - Excludes scripts directory
 * - Can optionally allow HTTPException (Hono pattern) and typed errors
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
    ignores: ['**/dist/**', '**/node_modules/**', 'eslint-plugin-tx/**', '**/*.js', '**/*.mjs', '!eslint.config.js']
  },
  // Root test files
  {
    files: ['test/**/*.ts'],
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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off', // Handled by @typescript-eslint
      'no-undef': 'off', // TypeScript handles this

      // tx plugin rules - enforce SQL schema definitions in migrations/
      'tx/no-inline-sql': ['error', {
        allowedPaths: ['migrations/', 'test/fixtures/'],
        ddlKeywords: ['CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE']
      }]
      // Note: tx/no-hono not applied to test files - legacy Hono imports remain during migration
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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',

      // tx plugin rules - enforce SQL schema definitions in migrations/
      'tx/no-inline-sql': ['error', {
        allowedPaths: ['migrations/', 'test/fixtures/'],
        ddlKeywords: ['CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE']
      }],

      // tx plugin rules - ban throw statements (CLAUDE.md DOCTRINE RULE 5)
      // Allow typed errors since packages/core uses Effect-TS Data.TaggedError pattern
      'tx/no-throw-in-services': ['warn', {
        excludedPatterns: ['.test.', '.spec.', '__tests__/', '/scripts/', '/test/', '/tests/'],
        allowHttpException: false,
        allowTypedErrors: true
      }],

      // tx plugin rules - ban Hono framework imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-hono': 'warn',

      // tx plugin rules - ban Zod imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-zod': 'warn'
    }
  },
  // Apps (api-server, agent-sdk, cli, mcp-server)
  {
    files: ['apps/api-server/**/*.ts', 'apps/agent-sdk/**/*.ts', 'apps/cli/**/*.ts', 'apps/mcp-server/**/*.ts'],
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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',

      // tx plugin rules - enforce SQL schema definitions in migrations/
      'tx/no-inline-sql': ['error', {
        allowedPaths: ['migrations/', 'test/fixtures/'],
        ddlKeywords: ['CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE']
      }],

      // tx plugin rules - require TaskWithDeps for external APIs (CLAUDE.md RULE 1)
      'tx/require-taskwithdeps-return': ['warn', {
        externalPaths: ['apps/mcp-server/', 'apps/api-server/', 'apps/agent-sdk/', 'packages/core/src/'],
        internalPaths: ['packages/core/src/repo/', 'packages/core/src/services/', 'test/', 'tests/', '__tests__/', '.test.', '.spec.'],
        checkObjectLiterals: true
      }],

      // tx plugin rules - enforce interface parity across CLI, MCP, and API
      'tx/interface-parity': ['error', {
        checkSerializerDuplication: true,
        checkResponseShapes: true,
        strictFieldTypes: true,
        ignorePaths: ['test/', 'tests/', '__tests__/', '.test.', '.spec.']
      }],

      // tx plugin rules - ban throw statements (CLAUDE.md DOCTRINE RULE 5)
      // Allow HTTPException for Hono framework pattern, allow typed errors for Effect-TS
      'tx/no-throw-in-services': ['warn', {
        excludedPatterns: ['.test.', '.spec.', '__tests__/', '/scripts/', '/test/', '/tests/'],
        allowHttpException: true,
        allowTypedErrors: true
      }],

      // tx plugin rules - ban Hono framework imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-hono': 'warn',

      // tx plugin rules - ban Zod imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-zod': 'warn'
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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
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
      }],

      // tx plugin rules - ban Hono framework imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-hono': 'warn',

      // tx plugin rules - ban Zod imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-zod': 'warn'
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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',

      // Enforce component and hook tests - principal engineer principle: if it's not tested, it doesn't exist
      'tx/require-component-tests': ['error', {
        components: { pattern: 'apps/dashboard/src/components/**/*.tsx', testDir: '__tests__', testSuffix: '.test.tsx' },
        hooks: { pattern: 'apps/dashboard/src/hooks/**/*.ts', testDir: '__tests__', testSuffix: '.test.ts' }
      }],

      // tx plugin rules - ban Hono framework imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-hono': 'warn',

      // tx plugin rules - ban Zod imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-zod': 'warn'
    }
  }
];
