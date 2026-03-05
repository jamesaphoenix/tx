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

const GENERIC_UTILITY_FILE_NAME_RULE = ['error', {
  bannedFileNames: ['utils.ts', 'helpers.ts'],
  bannedPathPatterns: [
    '^packages/core/src/(services|repo)/[^/]+\\.helpers\\.ts$',
    '^packages/core/src/(services|repo)/[^/]+-internals\\.ts$'
  ],
  allow: [
    'apps/agent-sdk/src/utils.ts',
    'apps/cli/src/commands/utils.ts'
  ]
}]

const SERVICE_FOLDER_MODULE_RULE = ['warn', {
  paths: ['packages/core/src/services/'],
  sidecarSuffixes: [
    'from-files',
    'shared',
    'helpers',
    'internals',
    'live',
    'runtime',
    'patterns',
    'process',
    'templates',
    'validation',
    'ops',
    'state',
    'deps',
    'factory',
    'read',
    'write'
  ]
}]

const DEEP_CORE_RESTRICTED_PATTERNS = [
  '@jamesaphoenix/tx-core/src',
  '@jamesaphoenix/tx-core/src/**',
  '**/packages/core/src',
  '**/packages/core/src/**'
]

const RESTRICTED_IMPORTS_RULE = ['error', {
  paths: [
    { name: 'fs', message: 'Use node:fs instead of fs.' },
    { name: 'fs/promises', message: 'Use node:fs/promises instead of fs/promises.' },
    { name: 'node:module', message: 'Do not import node:module/createRequire; use static imports instead.' },
    { name: 'module', message: 'Do not import module/createRequire; use static imports instead.' }
  ],
  patterns: [
    {
      group: DEEP_CORE_RESTRICTED_PATTERNS,
      message: 'Import from @jamesaphoenix/tx-core public exports instead of deep core/src paths.'
    }
  ]
}]

const RESTRICTED_MODULES_RULE = ['error',
  { name: 'fs', message: 'Use node:fs instead of fs.' },
  { name: 'fs/promises', message: 'Use node:fs/promises instead of fs/promises.' },
  { name: 'node:module', message: 'Do not import node:module/createRequire; use static imports instead.' },
  { name: 'module', message: 'Do not import module/createRequire; use static imports instead.' }
]

const RESTRICTED_DYNAMIC_IMPORTS_RULE = ['error',
  {
    selector: "ImportExpression[source.type='Literal'][source.value='fs']",
    message: 'Use dynamic import("node:fs") instead of import("fs").'
  },
  {
    selector: "ImportExpression[source.type='Literal'][source.value='fs/promises']",
    message: 'Use dynamic import("node:fs/promises") instead of import("fs/promises").'
  },
  {
    selector: "ImportExpression[source.type='TemplateLiteral'][source.expressions.length=0][source.quasis.length=1][source.quasis.0.value.cooked='fs']",
    message: 'Use dynamic import("node:fs") instead of import(`fs`).'
  },
  {
    selector: "ImportExpression[source.type='TemplateLiteral'][source.expressions.length=0][source.quasis.length=1][source.quasis.0.value.cooked='fs/promises']",
    message: 'Use dynamic import("node:fs/promises") instead of import(`fs/promises`).'
  },
  {
    selector: "ImportExpression[source.type='Literal'][source.value='node:module']",
    message: 'Do not dynamic import("node:module"); use static imports instead.'
  },
  {
    selector: "ImportExpression[source.type='Literal'][source.value='module']",
    message: 'Do not dynamic import("module"); use static imports instead.'
  },
  {
    selector: "ImportExpression[source.type='TemplateLiteral'][source.expressions.length=0][source.quasis.length=1][source.quasis.0.value.cooked='node:module']",
    message: 'Do not dynamic import(`node:module`); use static imports instead.'
  },
  {
    selector: "ImportExpression[source.type='TemplateLiteral'][source.expressions.length=0][source.quasis.length=1][source.quasis.0.value.cooked='module']",
    message: 'Do not dynamic import(`module`); use static imports instead.'
  },
  {
    selector: "ImportExpression[source.type='TemplateLiteral'][source.expressions.length>0]",
    message: 'Do not use computed dynamic import() specifiers; use a static module specifier.'
  },
  {
    selector: "ImportExpression[source.type!='Literal'][source.type!='TemplateLiteral']",
    message: 'Do not use computed dynamic import() specifiers; use a static module specifier.'
  },
  {
    selector: "ImportExpression[source.type='Literal'][source.value=/^@jamesaphoenix\\/tx-core\\/src(?:\\/|$)/]",
    message: 'Use @jamesaphoenix/tx-core public exports instead of deep core/src dynamic imports.'
  },
  {
    selector: "ImportExpression[source.type='TemplateLiteral'][source.expressions.length=0][source.quasis.length=1][source.quasis.0.value.cooked=/^@jamesaphoenix\\/tx-core\\/src(?:\\/|$)/]",
    message: 'Use @jamesaphoenix/tx-core public exports instead of deep core/src dynamic imports.'
  },
  {
    selector: "CallExpression[callee.name='require'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value=/^@jamesaphoenix\\/tx-core\\/src(?:\\/|$)/]",
    message: 'Use @jamesaphoenix/tx-core public exports instead of deep core/src require() paths.'
  },
  {
    selector: "CallExpression[callee.name='require'][arguments.length=1][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.length=1][arguments.0.quasis.0.value.cooked=/^@jamesaphoenix\\/tx-core\\/src(?:\\/|$)/]",
    message: 'Use @jamesaphoenix/tx-core public exports instead of deep core/src require() paths.'
  },
  {
    selector: "CallExpression[callee.name='require'][arguments.length=1][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length>0]",
    message: 'Do not use computed require() specifiers; use a static module specifier.'
  },
  {
    selector: "CallExpression[callee.name='require'][arguments.length=1][arguments.0.type!='Literal'][arguments.0.type!='TemplateLiteral']",
    message: 'Do not use computed require() specifiers; use a static module specifier.'
  },
  {
    selector: "CallExpression[callee.type='SequenceExpression'][callee.expressions.length=2][callee.expressions.1.type='Identifier'][callee.expressions.1.name='require'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value='fs']",
    message: 'Use require("node:fs") instead of wrapped require("fs").'
  },
  {
    selector: "CallExpression[callee.type='SequenceExpression'][callee.expressions.length=2][callee.expressions.1.type='Identifier'][callee.expressions.1.name='require'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value='fs/promises']",
    message: 'Use require("node:fs/promises") instead of wrapped require("fs/promises").'
  },
  {
    selector: "CallExpression[callee.type='SequenceExpression'][callee.expressions.length=2][callee.expressions.1.type='Identifier'][callee.expressions.1.name='require'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value=/^@jamesaphoenix\\/tx-core\\/src(?:\\/|$)/]",
    message: 'Use @jamesaphoenix/tx-core public exports instead of wrapped require() deep core/src paths.'
  },
  {
    selector: "CallExpression[callee.type='SequenceExpression'][callee.expressions.length=2][callee.expressions.1.type='Identifier'][callee.expressions.1.name='require'][arguments.length=1][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length>0]",
    message: 'Do not use computed wrapped require() specifiers; use a static module specifier.'
  },
  {
    selector: "CallExpression[callee.type='SequenceExpression'][callee.expressions.length=2][callee.expressions.1.type='Identifier'][callee.expressions.1.name='require'][arguments.length=1][arguments.0.type!='Literal'][arguments.0.type!='TemplateLiteral']",
    message: 'Do not use computed wrapped require() specifiers; use a static module specifier.'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.property.type='Identifier'][callee.property.name='require'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value='fs']",
    message: 'Use module.require("node:fs") instead of module.require("fs").'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.property.type='Identifier'][callee.property.name='require'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value='fs/promises']",
    message: 'Use module.require("node:fs/promises") instead of module.require("fs/promises").'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.property.type='Identifier'][callee.property.name='require'][arguments.length=1][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.length=1][arguments.0.quasis.0.value.cooked='fs']",
    message: 'Use module.require("node:fs") instead of module.require(`fs`).'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.property.type='Identifier'][callee.property.name='require'][arguments.length=1][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.length=1][arguments.0.quasis.0.value.cooked='fs/promises']",
    message: 'Use module.require("node:fs/promises") instead of module.require(`fs/promises`).'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.property.type='Identifier'][callee.property.name='require'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value=/^@jamesaphoenix\\/tx-core\\/src(?:\\/|$)/]",
    message: 'Use @jamesaphoenix/tx-core public exports instead of deep core/src module.require() paths.'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.property.type='Identifier'][callee.property.name='require'][arguments.length=1][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.length=1][arguments.0.quasis.0.value.cooked=/^@jamesaphoenix\\/tx-core\\/src(?:\\/|$)/]",
    message: 'Use @jamesaphoenix/tx-core public exports instead of deep core/src module.require() paths.'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.computed=true][callee.property.type='Literal'][callee.property.value='require'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value='fs']",
    message: 'Use module.require("node:fs") instead of module["require"]("fs").'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.computed=true][callee.property.type='Literal'][callee.property.value='require'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value='fs/promises']",
    message: 'Use module.require("node:fs/promises") instead of module["require"]("fs/promises").'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.computed=true][callee.property.type='Literal'][callee.property.value='require'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value=/^@jamesaphoenix\\/tx-core\\/src(?:\\/|$)/]",
    message: 'Use @jamesaphoenix/tx-core public exports instead of module["require"]() deep core/src paths.'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.computed=true][callee.property.type='Literal'][callee.property.value='require'][arguments.length=1][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length>0]",
    message: 'Do not use computed module["require"]() specifiers; use a static module specifier.'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.computed=true][callee.property.type='Literal'][callee.property.value='require'][arguments.length=1][arguments.0.type!='Literal'][arguments.0.type!='TemplateLiteral']",
    message: 'Do not use computed module["require"]() specifiers; use a static module specifier.'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.property.type='Identifier'][callee.property.name='require'][arguments.length=1][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length>0]",
    message: 'Do not use computed module.require() specifiers; use a static module specifier.'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.property.type='Identifier'][callee.property.name='require'][arguments.length=1][arguments.0.type!='Literal'][arguments.0.type!='TemplateLiteral']",
    message: 'Do not use computed module.require() specifiers; use a static module specifier.'
  },
  {
    selector: "VariableDeclarator[init.type='Identifier'][init.name='require']",
    message: 'Do not alias require(); use direct require() so import restrictions remain enforceable.'
  },
  {
    selector: "VariableDeclarator[init.type='Identifier'][init.name='module']",
    message: 'Do not alias module; this can bypass module.require() import restrictions.'
  },
  {
    selector: "AssignmentExpression[right.type='Identifier'][right.name='require']",
    message: 'Do not reassign require(); use direct require() so import restrictions remain enforceable.'
  },
  {
    selector: "AssignmentExpression[right.type='Identifier'][right.name='module']",
    message: 'Do not reassign module; this can bypass module.require() import restrictions.'
  },
  {
    selector: "VariableDeclarator[init.type='MemberExpression'][init.object.type='Identifier'][init.object.name='module'][init.property.type='Identifier'][init.property.name='require']",
    message: 'Do not alias module.require(); use direct imports so import restrictions remain enforceable.'
  },
  {
    selector: "VariableDeclarator[init.type='MemberExpression'][init.object.type='Identifier'][init.object.name='module'][init.computed=true][init.property.type='Literal'][init.property.value='require']",
    message: 'Do not alias module["require"](); use direct imports so import restrictions remain enforceable.'
  },
  {
    selector: "AssignmentExpression[right.type='MemberExpression'][right.object.type='Identifier'][right.object.name='module'][right.computed=true][right.property.type='Literal'][right.property.value='require']",
    message: 'Do not reassign module["require"](); use direct imports so import restrictions remain enforceable.'
  },
  {
    selector: "AssignmentExpression[right.type='MemberExpression'][right.object.type='Identifier'][right.object.name='module'][right.property.type='Identifier'][right.property.name='require']",
    message: 'Do not reassign module.require(); use direct imports so import restrictions remain enforceable.'
  },
  {
    selector: "VariableDeclarator[id.type='ObjectPattern'][init.type='Identifier'][init.name='module']",
    message: 'Do not destructure from module; avoid aliasing module.require().'
  },
  {
    selector: "ImportSpecifier[imported.type='Identifier'][imported.name='createRequire']",
    message: 'Do not import createRequire(); use static node: module imports so restrictions remain enforceable.'
  },
  {
    selector: "ImportDeclaration[source.value='node:module'] > ImportNamespaceSpecifier",
    message: 'Do not namespace-import node:module; this can bypass createRequire restrictions.'
  },
  {
    selector: "ImportDeclaration[source.value='module'] > ImportNamespaceSpecifier",
    message: 'Do not namespace-import module; this can bypass createRequire restrictions.'
  },
  {
    selector: "CallExpression[callee.type='Identifier'][callee.name='createRequire']",
    message: 'Do not call createRequire(); use static node: module imports so restrictions remain enforceable.'
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.property.type='Identifier'][callee.property.name='createRequire']",
    message: 'Do not call *.createRequire(); use static node: module imports so restrictions remain enforceable.'
  }
]

export default [
  eslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'eslint-plugin-tx/**', '**/*.js', '**/*.mjs', '!eslint.config.js']
  },
  // Root JS lint infrastructure (linted via `lint:root` with `--no-ignore`)
  {
    files: ['eslint-plugin-tx/index.js', 'eslint-plugin-tx/rules/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off'
    }
  },
  {
    files: ['eslint-plugin-tx/tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off'
    }
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
      'no-restricted-imports': RESTRICTED_IMPORTS_RULE,
      'no-restricted-modules': RESTRICTED_MODULES_RULE,
      'no-restricted-syntax': RESTRICTED_DYNAMIC_IMPORTS_RULE,

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
      'no-restricted-imports': RESTRICTED_IMPORTS_RULE,
      'no-restricted-modules': RESTRICTED_MODULES_RULE,
      'no-restricted-syntax': RESTRICTED_DYNAMIC_IMPORTS_RULE,

      // tx plugin rules - enforce SQL schema definitions in migrations/
      'tx/no-inline-sql': ['error', {
        allowedPaths: ['migrations/', 'test/fixtures/'],
        ddlKeywords: ['CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE']
      }],

      // tx plugin rules - ban throw statements (CLAUDE.md DOCTRINE RULE 5)
      // Allow typed errors since packages/core uses Effect-TS Data.TaggedError pattern
      'tx/no-throw-in-services': ['error', {
        excludedPatterns: ['.test.', '.spec.', '__tests__/', '/scripts/', '/test/', '/tests/'],
        allowHttpException: false,
        allowTypedErrors: true
      }],

      // tx plugin rules - ban Hono framework imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-hono': 'error',

      // tx plugin rules - ban Zod imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-zod': 'error',

      // tx plugin rules - ban plain interfaces for domain types (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-plain-interfaces': ['error', {
        excludedNames: ['ListResponse', 'PaginatedResponse', 'ActionResponse'],
        excludedSuffixes: ['Row']
      }],

      // tx plugin rules - disallow generic utility filenames (prefer domain-specific modules)
      'tx/no-generic-utility-file-names': GENERIC_UTILITY_FILE_NAME_RULE,

      // tx plugin rules - keep service internals grouped under owner folders
      'tx/prefer-service-folder-modules': SERVICE_FOLDER_MODULE_RULE,

      // tx plugin rules - ban unsafe 'as' casts in repo/mapper code (DB boundary)
      'tx/no-as-cast-in-repos': ['error', {
        enforcePaths: ['repo/', 'mappers/'],
        allowedTypes: ['unknown']
      }],

      'tx/max-service-lines': ['warn', {
        warnAt: 500,
        errorAt: 1000
      }]
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
      'no-restricted-imports': RESTRICTED_IMPORTS_RULE,
      'no-restricted-modules': RESTRICTED_MODULES_RULE,
      'no-restricted-syntax': RESTRICTED_DYNAMIC_IMPORTS_RULE,

      // tx plugin rules - enforce SQL schema definitions in migrations/
      'tx/no-inline-sql': ['error', {
        allowedPaths: ['migrations/', 'test/fixtures/'],
        ddlKeywords: ['CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE']
      }],

      // tx plugin rules - require TaskWithDeps for external APIs (CLAUDE.md RULE 1)
      'tx/require-taskwithdeps-return': ['error', {
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
      'tx/no-throw-in-services': ['error', {
        excludedPatterns: ['.test.', '.spec.', '__tests__/', '/scripts/', '/test/', '/tests/'],
        allowHttpException: true,
        allowTypedErrors: true
      }],

      // tx plugin rules - ban Hono framework imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-hono': 'error',

      // tx plugin rules - ban Zod imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-zod': 'error',

      // tx plugin rules - disallow generic utility filenames (prefer domain-specific modules)
      'tx/no-generic-utility-file-names': GENERIC_UTILITY_FILE_NAME_RULE,

      // tx plugin rules - enforce primitive implementation coverage (reads primitives-registry.json)
      'tx/require-primitive-implementations': ['error', {
        registryPath: 'primitives-registry.json',
        docsDir: 'apps/docs/content/docs/primitives'
      }],

      // tx plugin rules - enforce primitive docs quality (all 4 tabs, no placeholders, correct SDK patterns)
      'tx/require-primitive-docs': ['error', {
        docsDir: 'apps/docs/content/docs/primitives',
        requiredTabs: ['CLI', 'TypeScript SDK', 'MCP', 'REST API'],
        bannedPatterns: [
          'planned for future release',
          'planned for a future release',
          'not yet implemented',
          'not yet available',
          'coming soon',
          'not yet exposed',
          'currently CLI-only',
          'currently available via CLI only',
          'localhost:3001'
        ],
        bannedImports: ['@jamesaphoenix/tx-core'],
        bannedFunctions: ['createTx']
      }],

      // tx plugin rules - ensure scaffold templates include all documented primitives
      'tx/require-primitive-template-coverage': ['error', {
        metaPath: 'apps/docs/content/docs/primitives/meta.json',
        registryPath: 'primitives-registry.json',
        templates: [
          'apps/cli/src/templates/claude/CLAUDE.md',
          'apps/cli/src/templates/codex/AGENTS.md'
        ]
      }],

      // tx plugin rules - ensure llms.txt links every documented primitive page
      'tx/require-llms-primitive-coverage': ['error', {
        metaPath: 'apps/docs/content/docs/primitives/meta.json',
        llmsPath: 'apps/docs/public/llms.txt',
        urlBase: 'https://tx-docs.vercel.app/docs/primitives'
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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-restricted-imports': RESTRICTED_IMPORTS_RULE,
      'no-restricted-modules': RESTRICTED_MODULES_RULE,
      'no-restricted-syntax': RESTRICTED_DYNAMIC_IMPORTS_RULE,

      // Dashboard API integration test coverage
      'tx/require-integration-tests': ['error', {
        api: { src: 'apps/dashboard/server', test: 'test/integration/dashboard-api.test.ts', threshold: 80 }
      }],

      // tx plugin rules - enforce SQL schema definitions in migrations/
      'tx/no-inline-sql': ['error', {
        allowedPaths: ['migrations/', 'test/fixtures/'],
        ddlKeywords: ['CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE']
      }],

      // tx plugin rules - ban Hono framework imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-hono': 'error',

      // tx plugin rules - ban Zod imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-zod': 'error',

      // tx plugin rules - disallow generic utility filenames (prefer domain-specific modules)
      'tx/no-generic-utility-file-names': GENERIC_UTILITY_FILE_NAME_RULE
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
      'no-restricted-imports': RESTRICTED_IMPORTS_RULE,
      'no-restricted-modules': RESTRICTED_MODULES_RULE,
      'no-restricted-syntax': RESTRICTED_DYNAMIC_IMPORTS_RULE,

      // Enforce component and hook tests - principal engineer principle: if it's not tested, it doesn't exist
      'tx/require-component-tests': ['error', {
        components: { pattern: 'apps/dashboard/src/components/**/*.tsx', testDir: '__tests__', testSuffix: '.test.tsx' },
        hooks: { pattern: 'apps/dashboard/src/hooks/**/*.ts', testDir: '__tests__', testSuffix: '.test.ts' }
      }],

      // tx plugin rules - ban Hono framework imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-hono': 'error',

      // tx plugin rules - ban Zod imports (CLAUDE.md DOCTRINE RULE 10)
      'tx/no-zod': 'error'
    }
  },
  // Test utility package uses lightweight TS helper types/errors by design.
  // Keep doctrine strict in production paths while avoiding false positives here.
  {
    files: ['packages/test-utils/**/*.ts'],
    rules: {
      'tx/no-plain-interfaces': 'off',
      'tx/no-throw-in-services': 'off'
    }
  }
];
