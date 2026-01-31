/**
 * @fileoverview ESLint rule that enforces test file existence for components, hooks, and services
 *
 * This rule checks that:
 * - Every .tsx file in src/components/ has a corresponding .test.tsx in __tests__/
 * - Every .ts file in src/hooks/ has a corresponding .test.ts in __tests__/
 * - Every file in src/services/ has integration test coverage
 *
 * Principle: If it's not tested, it doesn't exist.
 */

import fs from 'fs';
import path from 'path';

/**
 * Default configuration for component test requirements
 */
const DEFAULT_CONFIG = {
  components: {
    pattern: 'src/components/**/*.tsx',
    testDir: '__tests__',
    testSuffix: '.test.tsx'
  },
  hooks: {
    pattern: 'src/hooks/**/*.ts',
    testDir: '__tests__',
    testSuffix: '.test.ts'
  },
  services: {
    pattern: 'src/services/**/*.ts',
    testDir: 'test/integration',
    testSuffix: '.test.ts'
  }
};

/**
 * Check if a file path matches a glob-like pattern (simplified)
 * @param {string} filePath - Relative file path
 * @param {string} pattern - Glob-like pattern (e.g., 'src/components/**\/*.tsx')
 * @returns {boolean}
 */
function matchesPattern(filePath, pattern) {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Convert glob pattern to regex using placeholder approach to avoid escaping regex chars we introduce
  // Step 1: Replace glob patterns with placeholders
  let regexStr = normalizedPattern
    .replace(/\*\*\//g, '\x00GLOBSTAR\x00')  // **/ -> placeholder
    .replace(/\*/g, '\x00STAR\x00');          // * -> placeholder

  // Step 2: Escape special regex characters (except our placeholders)
  regexStr = regexStr.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  // Step 3: Replace placeholders with actual regex patterns
  regexStr = regexStr
    .replace(/\x00GLOBSTAR\x00/g, '(?:.*/)?')  // **/ matches any directory depth (including none)
    .replace(/\x00STAR\x00/g, '[^/]*');        // * matches any characters except /

  // Anchor the pattern
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalizedPath);
}

/**
 * Get the expected test file path based on source file and configuration
 * @param {string} sourceFile - Relative path to source file
 * @param {object} config - Configuration for this file type
 * @returns {object} - { testPath: string, testDir: string, baseName: string }
 */
function getExpectedTestPath(sourceFile, config) {
  const sourceDir = path.dirname(sourceFile);
  const ext = path.extname(sourceFile);
  const baseName = path.basename(sourceFile, ext);

  // Skip index files and type definition files
  if (baseName === 'index' || sourceFile.endsWith('.d.ts')) {
    return null;
  }

  let testDir;
  let testPath;

  if (config.testDir === '__tests__') {
    // Test file is in a sibling __tests__ directory
    testDir = path.join(sourceDir, '__tests__');
    testPath = path.join(testDir, baseName + config.testSuffix);
  } else {
    // Test file is in a separate test directory (e.g., test/integration)
    // Derive test file name from source file name
    testDir = config.testDir;

    // For services, we look for test files that match the service name
    // e.g., task-service.ts -> task.test.ts or task-service.test.ts
    const testBaseName = baseName.replace(/-service$|-repo$/, '');
    testPath = path.join(testDir, testBaseName + config.testSuffix);
  }

  return { testPath, testDir, baseName };
}

/**
 * Check if a test file exists or if any file in test directory references the source
 * @param {string} testPath - Expected test file path
 * @param {string} testDir - Test directory path
 * @param {string} baseName - Base name of source file
 * @param {string} cwd - Current working directory
 * @returns {object} - { exists: boolean, foundPath: string | null }
 */
function findTestFile(testPath, testDir, baseName, cwd) {
  const fullTestPath = path.join(cwd, testPath);

  // Check exact path first
  if (fs.existsSync(fullTestPath)) {
    return { exists: true, foundPath: testPath };
  }

  // For __tests__ directories, also check alternative naming conventions
  const fullTestDir = path.join(cwd, testDir);
  if (fs.existsSync(fullTestDir)) {
    const testDirStat = fs.statSync(fullTestDir);
    if (testDirStat.isDirectory()) {
      const entries = fs.readdirSync(fullTestDir);

      // Check for various test file naming patterns
      const patterns = [
        baseName + '.test.tsx',
        baseName + '.test.ts',
        baseName + '.spec.tsx',
        baseName + '.spec.ts',
        baseName + '-test.tsx',
        baseName + '-test.ts'
      ];

      for (const pattern of patterns) {
        if (entries.includes(pattern)) {
          return { exists: true, foundPath: path.join(testDir, pattern) };
        }
      }

      // For integration tests, check if any test file imports/tests this module
      // by looking for describe() blocks that mention the module name
      for (const entry of entries) {
        if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
          const testFilePath = path.join(fullTestDir, entry);
          try {
            const content = fs.readFileSync(testFilePath, 'utf-8');
            // Check if this test file references the source module
            const moduleNamePattern = baseName.replace(/-/g, '[-_]?');
            const importRegex = new RegExp(`from\\s+['"].*${moduleNamePattern}['"]`, 'i');
            const describeRegex = new RegExp(`describe\\s*\\(\\s*['"\`].*${moduleNamePattern}`, 'i');

            if (importRegex.test(content) || describeRegex.test(content)) {
              return { exists: true, foundPath: path.join(testDir, entry) };
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    }
  }

  return { exists: false, foundPath: null };
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce test file existence for components, hooks, and services',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      missingTestFile: 'Missing test file for {{sourceFile}}. Expected: {{expected}}',
      missingTestDir: 'Missing __tests__ directory for {{component}}. Create {{testDir}}/__tests__/{{baseName}}{{testSuffix}}'
    },
    schema: [
      {
        type: 'object',
        properties: {
          components: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              testDir: { type: 'string' },
              testSuffix: { type: 'string' }
            },
            additionalProperties: false
          },
          hooks: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              testDir: { type: 'string' },
              testSuffix: { type: 'string' }
            },
            additionalProperties: false
          },
          services: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              testDir: { type: 'string' },
              testSuffix: { type: 'string' }
            },
            additionalProperties: false
          }
        },
        additionalProperties: true  // Allow custom categories
      }
    ]
  },

  create(context) {
    const userOptions = context.options[0] || {};
    const config = {
      ...DEFAULT_CONFIG,
      ...userOptions
    };

    // Merge nested objects properly
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (userOptions[key]) {
        config[key] = { ...DEFAULT_CONFIG[key], ...userOptions[key] };
      }
    }

    const filename = context.filename || context.getFilename();
    const cwd = context.cwd || context.getCwd?.() || process.cwd();
    const relPath = path.relative(cwd, filename).replace(/\\/g, '/');

    // Skip test files themselves
    if (relPath.includes('__tests__') ||
        relPath.includes('.test.') ||
        relPath.includes('.spec.') ||
        relPath.startsWith('test/')) {
      return {};
    }

    // Skip index files and type definitions
    const baseName = path.basename(filename);
    if (baseName === 'index.ts' ||
        baseName === 'index.tsx' ||
        filename.endsWith('.d.ts')) {
      return {};
    }

    // Find which config category applies to this file
    let applicableConfig = null;

    for (const [, categoryConfig] of Object.entries(config)) {
      if (categoryConfig.pattern && matchesPattern(relPath, categoryConfig.pattern)) {
        applicableConfig = categoryConfig;
        break;
      }
    }

    // Skip files that don't match any pattern
    if (!applicableConfig) {
      return {};
    }

    return {
      Program(node) {
        const testInfo = getExpectedTestPath(relPath, applicableConfig);

        // Skip files that should be ignored (index files, etc.)
        if (!testInfo) {
          return;
        }

        const { testPath, testDir, baseName: sourceBaseName } = testInfo;

        // Check if test file exists
        const { exists } = findTestFile(testPath, testDir, sourceBaseName, cwd);

        if (!exists) {
          // Determine which message to use
          const fullTestDir = path.join(cwd, testDir);
          const testDirExists = fs.existsSync(fullTestDir);

          if (applicableConfig.testDir === '__tests__' && !testDirExists) {
            context.report({
              node,
              messageId: 'missingTestDir',
              data: {
                component: relPath,
                testDir: path.dirname(relPath),
                baseName: sourceBaseName,
                testSuffix: applicableConfig.testSuffix
              }
            });
          } else {
            context.report({
              node,
              messageId: 'missingTestFile',
              data: {
                sourceFile: relPath,
                expected: testPath
              }
            });
          }
        }
      }
    };
  }
};
