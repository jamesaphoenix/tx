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
import noThrowInServices from './rules/no-throw-in-services.js';
import noHono from './rules/no-hono.js';
import noZod from './rules/no-zod.js';
import noGenericUtilityFileNames from './rules/no-generic-utility-file-names.js';
import noPlainInterfaces from './rules/no-plain-interfaces.js';
import noAsCastInRepos from './rules/no-as-cast-in-repos.js';
import requireInterfaceCoverage from './rules/require-interface-coverage.js';
import requirePrimitiveImplementations from './rules/require-primitive-implementations.js';
import requirePrimitiveDocs from './rules/require-primitive-docs.js';
import requirePrimitiveTemplateCoverage from './rules/require-primitive-template-coverage.js';
import requireLlmsPrimitiveCoverage from './rules/require-llms-primitive-coverage.js';
import maxServiceLines from './rules/max-service-lines.js';
import preferServiceFolderModules from './rules/prefer-service-folder-modules.js';
import requireCliUserErrors from './rules/require-cli-user-errors.js';
import requireCliHelpCoverage from './rules/require-cli-help-coverage.js';
import noSupervisionSqlOutsideCore from './rules/no-supervision-sql-outside-core.js';
import noDomainEventsSqlOutsideCore from './rules/no-domain-events-sql-outside-core.js';

const CLI_USER_ERROR_IGNORE_PATHS = [
  'apps/cli/src/commands/bulk.ts',
  'apps/cli/src/commands/claim.ts',
  'apps/cli/src/commands/compact.ts',
  'apps/cli/src/commands/coordinator.ts',
  'apps/cli/src/commands/cycle.ts',
  'apps/cli/src/commands/daemon.ts',
  'apps/cli/src/commands/dashboard.ts',
  'apps/cli/src/commands/decision.ts',
  'apps/cli/src/commands/decompose.ts',
  'apps/cli/src/commands/dep.ts',
  'apps/cli/src/commands/doc.ts',
  'apps/cli/src/commands/doctor.ts',
  'apps/cli/src/commands/gate.ts',
  'apps/cli/src/commands/graph.ts',
  'apps/cli/src/commands/group-context.ts',
  'apps/cli/src/commands/guard.ts',
  'apps/cli/src/commands/hierarchy.ts',
  'apps/cli/src/commands/hooks.ts',
  'apps/cli/src/commands/invariant.ts',
  'apps/cli/src/commands/label.ts',
  'apps/cli/src/commands/md-export.ts',
  'apps/cli/src/commands/memory.ts',
  'apps/cli/src/commands/outbox.ts',
  'apps/cli/src/commands/pin.ts',
  'apps/cli/src/commands/spec.ts',
  'apps/cli/src/commands/task.ts',
  'apps/cli/src/commands/test.ts',
  'apps/cli/src/commands/trace.ts',
  'apps/cli/src/commands/utils.ts',
  'apps/cli/src/commands/validate.ts',
  'apps/cli/src/commands/verify.ts',
  'apps/cli/src/commands/worker.ts'
];

const CLI_USER_ERROR_RULE = ['error', {
  enforceRoots: ['apps/cli/src/commands/'],
  extraPaths: ['apps/cli/src/utils/parse.ts'],
  ignorePaths: CLI_USER_ERROR_IGNORE_PATHS
}];

const CLI_HELP_COVERAGE_RULE = ['error', {
  enforcePaths: ['apps/cli/src/cli.ts'],
  helpFile: 'apps/cli/src/help.ts',
  ignoreCommands: ['help']
}];

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
    'prd-failure-modes': prdFailureModes,
    'no-throw-in-services': noThrowInServices,
    'no-hono': noHono,
    'no-zod': noZod,
    'no-generic-utility-file-names': noGenericUtilityFileNames,
    'no-plain-interfaces': noPlainInterfaces,
    'no-as-cast-in-repos': noAsCastInRepos,
    'require-interface-coverage': requireInterfaceCoverage,
    'require-primitive-implementations': requirePrimitiveImplementations,
    'require-primitive-docs': requirePrimitiveDocs,
    'require-primitive-template-coverage': requirePrimitiveTemplateCoverage,
    'require-llms-primitive-coverage': requireLlmsPrimitiveCoverage,
    'max-service-lines': maxServiceLines,
    'prefer-service-folder-modules': preferServiceFolderModules,
    'require-cli-user-errors': requireCliUserErrors,
    'require-cli-help-coverage': requireCliHelpCoverage,
    'no-supervision-sql-outside-core': noSupervisionSqlOutsideCore,
    'no-domain-events-sql-outside-core': noDomainEventsSqlOutsideCore
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
          ddDirectory: 'specs/design',
          requireTestingStrategy: true,
          requireIntegrationTests: true,
          requireUnitTests: true
        }],
        'tx/prd-failure-modes': ['error', {
          prdPattern: '^PRD-\\d{3}-.+\\.md$',
          prdDirectory: 'specs/prd',
          requireFailureModes: true,
          requireRecoveryStrategy: false
        }],
        'tx/no-throw-in-services': ['error', {
          excludedPatterns: ['.test.', '.spec.', '__tests__/', '/scripts/', '/test/', '/tests/'],
          allowHttpException: false,
          allowTypedErrors: false
        }],
        'tx/no-hono': 'error',
        'tx/no-zod': 'error',
        'tx/no-plain-interfaces': ['error', {
          excludedNames: ['ListResponse', 'PaginatedResponse', 'ActionResponse'],
          excludedSuffixes: ['Row']
        }],
        'tx/no-as-cast-in-repos': ['error', {
          enforcePaths: ['repo/', 'mappers/'],
          allowedTypes: ['unknown']
        }],
        'tx/require-cli-user-errors': CLI_USER_ERROR_RULE,
        'tx/require-cli-help-coverage': CLI_HELP_COVERAGE_RULE,
        'tx/require-llms-primitive-coverage': ['error', {
          metaPath: 'apps/docs/content/docs/primitives/meta.json',
          llmsPath: 'apps/docs/public/llms.txt',
          urlBase: 'https://tx-docs.vercel.app/docs/primitives'
        }],
        'tx/max-service-lines': ['warn', {
          warnAt: 500,
          errorAt: 1000
        }],
        'tx/no-supervision-sql-outside-core': ['error', {
          allowedPaths: ['packages/core/src/repo/', 'migrations/', 'test/', 'tests/', '__tests__/'],
          tablePatterns: ['worker_sessions']
        }],
        'tx/no-domain-events-sql-outside-core': ['error', {
          allowedPaths: ['packages/core/src/repo/', 'migrations/', 'test/', 'tests/', '__tests__/'],
          tablePatterns: ['domain_events', 'doc_review_runs']
        }]
      }
    }
  }
};

export default plugin;
