/**
 * @fileoverview ESLint plugin for tx project - enforces testing best practices
 */

import requireIntegrationTests from './rules/require-integration-tests.js';
import noInlineSql from './rules/no-inline-sql.js';

const plugin = {
  meta: {
    name: 'eslint-plugin-tx',
    version: '1.0.0'
  },
  rules: {
    'require-integration-tests': requireIntegrationTests,
    'no-inline-sql': noInlineSql
  },
  // Flat config recommended configuration
  configs: {
    recommended: {
      plugins: {
        // Will be populated when used
      },
      rules: {
        'tx/require-integration-tests': ['error', {
          services: { src: 'src/services', test: 'test/integration', threshold: 90 },
          repos: { src: 'src/repo', test: 'test/integration', threshold: 85 },
          cli: { src: 'src/cli.ts', test: 'test/integration/cli-*.test.ts', threshold: 70 },
          mcp: { src: 'src/mcp/server.ts', test: 'test/integration/mcp.test.ts', threshold: 80 },
          api: { src: 'apps/dashboard/server', test: 'test/integration/dashboard-api.test.ts', threshold: 80 }
        }],
        'tx/no-inline-sql': ['error', {
          allowedPaths: ['migrations/', 'test/fixtures/'],
          ddlKeywords: ['CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE']
        }]
      }
    }
  }
};

export default plugin;
