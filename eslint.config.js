// @ts-check
/**
 * @fileoverview ESLint flat config for tx project
 *
 * This configuration uses the modern ESLint flat config format (eslint.config.js)
 * and includes the custom tx plugin for enforcing integration test coverage.
 *
 * Rule: tx/require-integration-tests
 * Enforces that major components have corresponding integration tests with adequate coverage.
 *
 * Detection logic:
 * - Parses source files for exported functions/classes
 * - Checks for corresponding describe() blocks in test files
 * - Reports error if coverage < threshold (default 80%)
 *
 * Config:
 * rules: {
 *   'tx/require-integration-tests': ['error', {
 *     services: { src: 'src/services', test: 'test/integration', threshold: 90 },
 *     repos: { src: 'src/repo', test: 'test/integration', threshold: 85 },
 *     cli: { src: 'src/cli.ts', test: 'test/integration/cli-*.test.ts', threshold: 70 },
 *     api: { src: 'apps/dashboard/server', test: 'test/integration/dashboard-api.test.ts', threshold: 80 }
 *   }]
 * }
 *
 * Error message:
 * 'Missing integration tests for {component}. Expected test file: {expected}. Coverage: {actual}% < {threshold}%'
 *
 * Reference: Agent swarm audit findings - services 93-98% covered, CLI 71% covered, dashboard API 0% covered
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
      '@typescript-eslint': tseslintPlugin
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off'
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
      }]
    }
  }
];
