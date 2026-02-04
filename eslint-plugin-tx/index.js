/**
 * @fileoverview ESLint plugin for tx project - enforces testing and Effect-TS best practices
 */

import requireIntegrationTests from './rules/require-integration-tests.js';
import noInlineSql from './rules/no-inline-sql.js';
import requireComponentTests from './rules/require-component-tests.js';
import requireEffectErrorHandling from './rules/require-effect-error-handling.js';
import noRawPromisesInServices from './rules/no-raw-promises-in-services.js';
import requireTaskwithdepsReturn from './rules/require-taskwithdeps-return.js';
import testCoverageThresholds from './rules/test-coverage-thresholds.js';
import requireFactoryParity from './rules/require-factory-parity.js';
import requireColocatedTests from './rules/require-colocated-tests.js';
import interfaceParity from './rules/interface-parity.js';
import requireDdTestSections from './rules/require-dd-test-sections.js';
import prdFailureModes from './rules/prd-failure-modes.js';

const plugin = {
  meta: {
    name: 'eslint-plugin-tx',
    version: '1.0.0'
  },
  rules: {
    'require-integration-tests': requireIntegrationTests,
    'no-inline-sql': noInlineSql,
    'require-component-tests': requireComponentTests,
    'require-effect-error-handling': requireEffectErrorHandling,
    'no-raw-promises-in-services': noRawPromisesInServices,
    'require-taskwithdeps-return': requireTaskwithdepsReturn,
    'test-coverage-thresholds': testCoverageThresholds,
    'require-factory-parity': requireFactoryParity,
    'require-colocated-tests': requireColocatedTests,
    'interface-parity': interfaceParity,
    'require-dd-test-sections': requireDdTestSections,
    'prd-failure-modes': prdFailureModes
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
        }],
        'tx/require-component-tests': ['error', {
          components: { pattern: 'src/components/**/*.tsx', testDir: '__tests__', testSuffix: '.test.tsx' },
          hooks: { pattern: 'src/hooks/**/*.ts', testDir: '__tests__', testSuffix: '.test.ts' },
          services: { pattern: 'src/services/**/*.ts', testDir: 'test/integration', testSuffix: '.test.ts' }
        }],
        'tx/require-effect-error-handling': ['error', {
          allowedPaths: ['test/', 'tests/', '__tests__/', '.test.', '.spec.'],
          checkTypeAnnotations: true
        }],
        'tx/no-raw-promises-in-services': ['error', {
          servicePaths: ['src/services/']
        }],
        'tx/require-taskwithdeps-return': ['error', {
          externalPaths: ['src/mcp/', 'apps/api-server/', 'apps/agent-sdk/', 'packages/core/src/'],
          internalPaths: ['src/repo/', 'test/', 'tests/', '__tests__/', '.test.', '.spec.'],
          checkObjectLiterals: true
        }],
        'tx/require-factory-parity': ['error', {
          typePaths: ['packages/types/src', 'src/schemas'],
          factoryPaths: ['test/fixtures.ts', 'packages/test-utils/src', 'packages/test-utils/src/factories'],
          migrationPaths: ['src/services/migration-service.ts'],
          ignoredEntities: ['TaskTree', 'TaskCursor', 'TaskFilter', 'ContextResult', 'LearningSearchResult']
        }],
        'tx/require-colocated-tests': ['warn', {
          enforcePaths: ['packages/*/src', 'apps/*/src', 'src/services', 'src/repo'],
          ignorePaths: ['node_modules', 'dist', 'build', '.turbo', 'test/integration', 'test/e2e'],
          ignorePatterns: ['index.ts', 'index.js', '*.d.ts', '*.config.*', 'types.ts', 'constants.ts', 'schema.ts'],
          minLinesForTest: 20,
          allowTestsDirectory: true
        }],
        'tx/interface-parity': ['error', {
          checkSerializerDuplication: true,
          checkResponseShapes: true,
          strictFieldTypes: true,
          ignorePaths: ['test/', 'tests/', '__tests__/', '.test.', '.spec.']
        }],
        'tx/require-dd-test-sections': ['error', {
          ddPattern: '^DD-\\d{3}-.+\\.md$',
          ddDirectory: 'docs/design',
          requireTestingStrategy: true,
          requireIntegrationTests: true,
          requireUnitTests: true
        }],
        'tx/prd-failure-modes': ['error', {
          prdPattern: '^PRD-\\d{3}-.+\\.md$',
          prdDirectory: 'docs/prd',
          requireFailureModes: true,
          requireRecoveryStrategy: false
        }]
      }
    }
  }
};

export default plugin;
