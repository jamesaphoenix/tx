/**
 * @fileoverview ESLint rule that enforces integration test coverage for major components
 *
 * This rule checks that services, repositories, CLI commands, API endpoints, and MCP tools
 * have corresponding integration tests with adequate coverage.
 */

import fs from 'fs';
import path from 'path';

/**
 * Parse a source file to extract exported identifiers (classes, functions, constants)
 * @param {string} content - The file content
 * @returns {string[]} - Array of exported identifier names
 */
function extractExports(content) {
  const exports = [];

  // Match: export class ClassName
  const classExports = content.matchAll(/export\s+class\s+(\w+)/g);
  for (const match of classExports) {
    exports.push(match[1]);
  }

  // Match: export const ConstName
  const constExports = content.matchAll(/export\s+const\s+(\w+)/g);
  for (const match of constExports) {
    exports.push(match[1]);
  }

  // Match: export function FuncName
  const funcExports = content.matchAll(/export\s+function\s+(\w+)/g);
  for (const match of funcExports) {
    exports.push(match[1]);
  }

  // Match: export { Named1, Named2 }
  const namedExports = content.matchAll(/export\s*\{([^}]+)\}/g);
  for (const match of namedExports) {
    const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    exports.push(...names.filter(n => n && !n.includes('*')));
  }

  return [...new Set(exports)]; // Remove duplicates
}

/**
 * Parse a test file to extract describe() block names and tested identifiers
 * @param {string} content - The test file content
 * @returns {{ describes: string[], testedIdentifiers: string[] }}
 */
function extractTestCoverage(content) {
  const describes = [];
  const testedIdentifiers = new Set();

  // Match describe("Name", ...) or describe('Name', ...)
  const describeMatches = content.matchAll(/describe\s*\(\s*["'`]([^"'`]+)["'`]/g);
  for (const match of describeMatches) {
    describes.push(match[1]);
  }

  // Look for Service/Repository/etc usage patterns to identify what's being tested
  // Match: yield* ServiceName or yield* RepoName
  const yieldMatches = content.matchAll(/yield\*\s+(\w+)/g);
  for (const match of yieldMatches) {
    testedIdentifiers.add(match[1]);
  }

  // Match direct service imports: import { ServiceName } from
  const importMatches = content.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']/g);
  for (const match of importMatches) {
    const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    for (const name of names) {
      if (name.endsWith('Service') || name.endsWith('Repository') || name.endsWith('Live')) {
        testedIdentifiers.add(name);
      }
    }
  }

  return {
    describes,
    testedIdentifiers: [...testedIdentifiers]
  };
}

/**
 * Calculate coverage percentage
 * @param {string[]} sourceExports - Exports from source file
 * @param {string[]} testedIdentifiers - Identifiers found in tests
 * @returns {number} - Coverage percentage (0-100)
 */
function calculateCoverage(sourceExports, testedIdentifiers) {
  if (sourceExports.length === 0) return 100;

  const testedSet = new Set(testedIdentifiers.map(s => s.toLowerCase()));
  let covered = 0;

  for (const exp of sourceExports) {
    // Check if the export or its "Live" variant is tested
    const expLower = exp.toLowerCase();
    if (testedSet.has(expLower) ||
        testedSet.has(expLower + 'live') ||
        testedSet.has(expLower.replace(/live$/, ''))) {
      covered++;
    }
  }

  return Math.round((covered / sourceExports.length) * 100);
}

/**
 * Determine the expected test file path based on source file path and config
 * (Currently used for documentation purposes and potential future enhancements)
 * @param {string} sourcePath - Absolute path to source file
 * @param {object} mappings - Source-to-test mappings from config
 * @param {string} cwd - Current working directory
 * @returns {string|null} - Expected test file path or null if no mapping found
 */
// eslint-disable-next-line no-unused-vars
function _getExpectedTestPath(sourcePath, mappings, cwd) {
  const relPath = path.relative(cwd, sourcePath);

  for (const [, config] of Object.entries(mappings)) {
    const srcPattern = config.src;

    // Check if source path matches the pattern
    if (relPath.startsWith(srcPattern) || relPath.includes(srcPattern)) {
      const testDir = config.test;

      // For glob patterns in test path, we need to find existing test files
      if (testDir.includes('*')) {
        return path.join(cwd, testDir);
      }

      // For simple mappings, derive test file name from source
      const baseName = path.basename(sourcePath, path.extname(sourcePath));
      const testFileName = baseName.replace(/-service$|-repo$/, '') + '.test.ts';
      return path.join(cwd, testDir, testFileName);
    }
  }

  return null;
}

/**
 * Find test files that match a pattern
 * @param {string} pattern - Glob-like pattern (simplified)
 * @param {string} cwd - Current working directory
 * @returns {string[]} - Array of matching file paths
 */
function findTestFiles(pattern, cwd) {
  // Remove glob part and trailing slash to get the directory
  let baseDir = pattern.replace(/\*.*$/, '').replace(/\/$/, '');
  // If pattern was just '*.test.ts', baseDir becomes empty, use '.'
  if (!baseDir) baseDir = '.';

  const fullBaseDir = path.isAbsolute(baseDir) ? baseDir : path.join(cwd, baseDir);

  if (!fs.existsSync(fullBaseDir)) {
    return [];
  }

  const files = [];
  const entries = fs.readdirSync(fullBaseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(path.join(fullBaseDir, entry.name));
    }
  }

  return files;
}

const defaultMappings = {
  services: { src: 'src/services', test: 'test/integration', threshold: 90 },
  repos: { src: 'src/repo', test: 'test/integration', threshold: 85 },
  cli: { src: 'src/cli.ts', test: 'test/integration/cli-*.test.ts', threshold: 70 },
  mcp: { src: 'src/mcp/server.ts', test: 'test/integration/mcp.test.ts', threshold: 80 },
  api: { src: 'apps/dashboard/server', test: 'test/integration/dashboard-api.test.ts', threshold: 80 }
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce integration test coverage for major components',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      missingTestFile: 'Missing integration tests for {{component}}. Expected test file: {{expected}}',
      insufficientCoverage: 'Insufficient integration test coverage for {{component}}. Coverage: {{actual}}% < {{threshold}}% threshold. Missing tests for: {{missing}}',
      noExportsFound: 'No exports found in {{component}}. If this is intentional, consider adding a skip comment.'
    },
    schema: [
      {
        type: 'object',
        properties: {
          services: {
            type: 'object',
            properties: {
              src: { type: 'string' },
              test: { type: 'string' },
              threshold: { type: 'number', minimum: 0, maximum: 100 }
            }
          },
          repos: {
            type: 'object',
            properties: {
              src: { type: 'string' },
              test: { type: 'string' },
              threshold: { type: 'number', minimum: 0, maximum: 100 }
            }
          },
          cli: {
            type: 'object',
            properties: {
              src: { type: 'string' },
              test: { type: 'string' },
              threshold: { type: 'number', minimum: 0, maximum: 100 }
            }
          },
          mcp: {
            type: 'object',
            properties: {
              src: { type: 'string' },
              test: { type: 'string' },
              threshold: { type: 'number', minimum: 0, maximum: 100 }
            }
          },
          api: {
            type: 'object',
            properties: {
              src: { type: 'string' },
              test: { type: 'string' },
              threshold: { type: 'number', minimum: 0, maximum: 100 }
            }
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = context.options[0] || {};
    const mappings = { ...defaultMappings, ...options };
    const filename = context.filename || context.getFilename();
    const cwd = context.cwd || context.getCwd?.() || process.cwd();
    const relPath = path.relative(cwd, filename);

    // Determine which mapping applies to this file
    let applicableMapping = null;

    for (const [, config] of Object.entries(mappings)) {
      const srcPattern = config.src;
      if (relPath === srcPattern || relPath.startsWith(srcPattern.replace(/\/\*.*$/, ''))) {
        applicableMapping = config;
        break;
      }
    }

    // Skip files that don't match any mapping
    if (!applicableMapping) {
      return {};
    }

    return {
      Program(node) {
        const sourceCode = context.sourceCode || context.getSourceCode();
        const sourceContent = sourceCode.getText();

        // Extract exports from source file
        const sourceExports = extractExports(sourceContent);

        // Skip files with no exports
        if (sourceExports.length === 0) {
          return; // Not an error - might be types-only or internal file
        }

        // Get the component name for error messages
        const component = path.basename(filename);

        // Determine expected test file(s)
        const testPattern = applicableMapping.test;
        let testFiles = [];

        if (testPattern.includes('*')) {
          // Glob pattern - find matching files
          testFiles = findTestFiles(testPattern, cwd);
        } else {
          // Check if it's a directory or file
          const testPath = path.join(cwd, testPattern);
          if (fs.existsSync(testPath)) {
            const stat = fs.statSync(testPath);
            if (stat.isDirectory()) {
              // It's a directory - find all test files in it
              testFiles = findTestFiles(path.join(testPattern, '*.test.ts'), cwd);
            } else {
              // It's a direct file path
              testFiles = [testPath];
            }
          }
        }

        // If no test files found, also check for component-specific test
        if (testFiles.length === 0) {
          const baseName = path.basename(filename, '.ts');
          const altTestPath = path.join(cwd, 'test/integration', baseName.replace(/-service$|-repo$/, '') + '.test.ts');
          if (fs.existsSync(altTestPath)) {
            testFiles = [altTestPath];
          }
        }

        // Report if no test files found
        if (testFiles.length === 0) {
          context.report({
            node,
            messageId: 'missingTestFile',
            data: {
              component,
              expected: testPattern
            }
          });
          return;
        }

        // Aggregate test coverage from all test files
        const allTestedIdentifiers = new Set();

        for (const testFile of testFiles) {
          try {
            const testContent = fs.readFileSync(testFile, 'utf-8');
            const { testedIdentifiers } = extractTestCoverage(testContent);
            for (const id of testedIdentifiers) {
              allTestedIdentifiers.add(id);
            }
          } catch {
            // Skip unreadable files
          }
        }

        // Calculate coverage
        const coverage = calculateCoverage(sourceExports, [...allTestedIdentifiers]);
        const threshold = applicableMapping.threshold;

        if (coverage < threshold) {
          // Find which exports are missing tests
          const testedSet = new Set([...allTestedIdentifiers].map(s => s.toLowerCase()));
          const missing = sourceExports.filter(exp => {
            const expLower = exp.toLowerCase();
            return !testedSet.has(expLower) &&
                   !testedSet.has(expLower + 'live') &&
                   !testedSet.has(expLower.replace(/live$/, ''));
          });

          context.report({
            node,
            messageId: 'insufficientCoverage',
            data: {
              component,
              actual: coverage.toString(),
              threshold: threshold.toString(),
              missing: missing.join(', ') || '(none identified)'
            }
          });
        }
      }
    };
  }
};
