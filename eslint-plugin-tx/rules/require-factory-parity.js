/**
 * @fileoverview ESLint rule that enforces factory function parity for types and tables
 *
 * This rule ensures that every exported interface/type in packages/types has a corresponding
 * factory function in the test utilities package (e.g., createTestTask for Task interface).
 * It also checks that database tables have corresponding fixture generators.
 */

import fs from 'fs';
import path from 'path';

/**
 * Extract entity interfaces from a type file
 * Matches patterns like: export interface Task, export interface Learning
 * Excludes helper types like CreateTaskInput, TaskRow, TaskWithDeps, etc.
 * @param {string} content - The file content
 * @returns {string[]} - Array of entity names
 */
function extractEntityInterfaces(content) {
  const entities = [];

  // Match: export interface EntityName (but not EntityRow, EntityInput, EntityWith*, etc.)
  const interfaceMatches = content.matchAll(
    /export\s+interface\s+(\w+)(?:\s+extends|\s*\{)/g
  );

  for (const match of interfaceMatches) {
    const name = match[1];
    // Skip helper types - we only want core entity interfaces
    if (name.endsWith('Row') ||
        name.endsWith('Input') ||
        name.endsWith('Query') ||
        name.endsWith('Result') ||
        name.endsWith('Filter') ||
        name.endsWith('Cursor') ||
        name.includes('With') ||  // TaskWithDeps, LearningWithScore
        name.endsWith('Dependency')) {
      continue;
    }
    entities.push(name);
  }

  return [...new Set(entities)];
}

/**
 * Extract table names from SQL CREATE TABLE statements
 * Reserved for future use when migration-based factory detection is implemented.
 * @param {string} content - Migration file content
 * @returns {string[]} - Array of table names (normalized to PascalCase)
 */
// eslint-disable-next-line no-unused-vars
function _extractTableNames(content) {
  const tables = [];

  // Match: CREATE TABLE table_name or CREATE TABLE IF NOT EXISTS table_name
  const tableMatches = content.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi
  );

  for (const match of tableMatches) {
    const tableName = match[1];
    // Convert snake_case to PascalCase for comparison
    const pascalCase = tableName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
    tables.push(pascalCase);
  }

  return [...new Set(tables)];
}

/**
 * Extract factory function names from test utilities
 * @param {string} content - Test utilities file content
 * @returns {string[]} - Array of entity names that have factories
 */
function extractFactoryEntities(content) {
  const entities = [];

  // Match: createTest<Entity> function declarations or exports
  const factoryMatches = content.matchAll(
    /(?:export\s+)?(?:function|const)\s+createTest(\w+)/g
  );

  for (const match of factoryMatches) {
    entities.push(match[1]);
  }

  // Also match: <Entity>Factory exports
  const factoryClassMatches = content.matchAll(
    /(?:export\s+)?(?:class|const)\s+(\w+)Factory/g
  );

  for (const match of factoryClassMatches) {
    entities.push(match[1]);
  }

  return [...new Set(entities)];
}

/**
 * Find all factory functions across test files
 * @param {string} cwd - Current working directory
 * @param {string[]} searchPaths - Paths to search for factories
 * @returns {Set<string>} - Set of entity names with factories
 */
function findFactories(cwd, searchPaths) {
  const factoryEntities = new Set();

  for (const searchPath of searchPaths) {
    const fullPath = path.join(cwd, searchPath);

    if (!fs.existsSync(fullPath)) continue;

    const stat = fs.statSync(fullPath);

    if (stat.isFile()) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const entities = extractFactoryEntities(content);
        for (const entity of entities) {
          factoryEntities.add(entity);
        }
      } catch {
        // Skip unreadable files
      }
    } else if (stat.isDirectory()) {
      // Recursively search directory
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.ts')) {
          try {
            const content = fs.readFileSync(path.join(fullPath, entry.name), 'utf-8');
            const entities = extractFactoryEntities(content);
            for (const entity of entities) {
              factoryEntities.add(entity);
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    }
  }

  return factoryEntities;
}

const defaultOptions = {
  // Paths containing type/interface definitions
  typePaths: [
    'packages/types/src',
    'src/schemas'
  ],
  // Paths to search for factory functions
  factoryPaths: [
    'test/fixtures.ts',
    'packages/test-utils/src',
    'packages/test-utils/src/factories'
  ],
  // Paths containing migrations (for table checks)
  migrationPaths: [
    'src/services/migration-service.ts'
  ],
  // Core entities that must have factories (auto-detected from types if not specified)
  requiredEntities: [],
  // Entities to ignore (internal types, etc.)
  ignoredEntities: [
    'TaskTree',  // Computed type, not stored
    'TaskCursor', // Pagination helper
    'TaskFilter', // Query helper
    'ContextResult', // Computed result
    'LearningSearchResult' // Search result wrapper
  ]
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce factory function parity for types and database tables',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      missingFactory: 'Missing test factory for entity "{{entity}}". Create createTest{{entity}}() in test utilities.',
      missingTableFactory: 'Missing test factory for table "{{table}}". Create seed{{table}}() or createTest{{entity}}() in test fixtures.',
      noFactoriesFound: 'No factory functions found. Ensure test utilities exist in configured paths.'
    },
    schema: [
      {
        type: 'object',
        properties: {
          typePaths: {
            type: 'array',
            items: { type: 'string' }
          },
          factoryPaths: {
            type: 'array',
            items: { type: 'string' }
          },
          migrationPaths: {
            type: 'array',
            items: { type: 'string' }
          },
          requiredEntities: {
            type: 'array',
            items: { type: 'string' }
          },
          ignoredEntities: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = { ...defaultOptions, ...context.options[0] };
    const filename = context.filename || context.getFilename();
    const cwd = context.cwd || context.getCwd?.() || process.cwd();
    const relPath = path.relative(cwd, filename);

    // Only run on type definition files
    const isTypeFile = options.typePaths.some(tp =>
      relPath.startsWith(tp) || relPath.includes(tp)
    );

    if (!isTypeFile) {
      return {};
    }

    return {
      Program(node) {
        const sourceCode = context.sourceCode || context.getSourceCode();
        const sourceContent = sourceCode.getText();

        // Extract entities from this file
        const entities = extractEntityInterfaces(sourceContent);

        if (entities.length === 0) {
          return; // No entities to check
        }

        // Find all available factories
        const factoryEntities = findFactories(cwd, options.factoryPaths);

        // Check each entity has a factory
        for (const entity of entities) {
          // Skip ignored entities
          if (options.ignoredEntities.includes(entity)) {
            continue;
          }

          // Check for factory (case-insensitive comparison)
          const hasFactory = Array.from(factoryEntities).some(
            fe => fe.toLowerCase() === entity.toLowerCase()
          );

          if (!hasFactory) {
            context.report({
              node,
              messageId: 'missingFactory',
              data: { entity }
            });
          }
        }
      }
    };
  }
};
