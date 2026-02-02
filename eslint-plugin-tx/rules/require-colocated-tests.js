/**
 * @fileoverview ESLint rule that enforces test co-location alongside source files
 *
 * This rule ensures that unit tests are placed in the same directory as their
 * corresponding source files (e.g., service.ts and service.test.ts together).
 */

import fs from 'fs';
import path from 'path';

/**
 * Check if a file is a test file
 * @param {string} filename - The filename to check
 * @returns {boolean}
 */
function isTestFile(filename) {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filename);
}

/**
 * Check if a file is a source file that should have tests
 * @param {string} filename - The filename to check
 * @returns {boolean}
 */
function isSourceFile(filename) {
  // Skip test files, type definitions, configs, etc.
  if (isTestFile(filename)) return false;
  if (filename.endsWith('.d.ts')) return false;
  if (filename.includes('.config.')) return false;
  if (filename === 'index.ts' || filename === 'index.js') return false;

  return /\.(ts|tsx|js|jsx)$/.test(filename);
}

/**
 * Get the expected test file path for a source file
 * @param {string} sourcePath - The source file path
 * @returns {string} - The expected test file path
 */
function getExpectedTestPath(sourcePath) {
  const ext = path.extname(sourcePath);
  const base = sourcePath.slice(0, -ext.length);
  return `${base}.test${ext}`;
}

const defaultOptions = {
  // Directories where co-location is enforced
  enforcePaths: [
    'packages/*/src',
    'apps/*/src',
    'src/services',
    'src/repo'
  ],
  // Directories where co-location is NOT enforced (e.g., legacy code)
  ignorePaths: [
    'node_modules',
    'dist',
    'build',
    '.turbo',
    'test/integration',  // Integration tests can be separate
    'test/e2e'  // E2E tests can be separate
  ],
  // File patterns to ignore
  ignorePatterns: [
    'index.ts',
    'index.js',
    '*.d.ts',
    '*.config.*',
    'types.ts',
    'constants.ts',
    'schema.ts'
  ],
  // Minimum lines of code to require tests (skip tiny files)
  minLinesForTest: 20,
  // Allow __tests__ directory as alternative
  allowTestsDirectory: true
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce test co-location alongside source files',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      missingColocatedTest: 'Missing co-located test file for "{{source}}". Expected: "{{expected}}" or "{{testsDir}}"',
      testNotColocated: 'Test file "{{test}}" should be co-located with its source. Move to: "{{expectedDir}}"'
    },
    schema: [
      {
        type: 'object',
        properties: {
          enforcePaths: {
            type: 'array',
            items: { type: 'string' }
          },
          ignorePaths: {
            type: 'array',
            items: { type: 'string' }
          },
          ignorePatterns: {
            type: 'array',
            items: { type: 'string' }
          },
          minLinesForTest: {
            type: 'number',
            minimum: 0
          },
          allowTestsDirectory: {
            type: 'boolean'
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
    const dirname = path.dirname(filename);
    const basename = path.basename(filename);

    // Skip ignored paths
    if (options.ignorePaths.some(ip => relPath.includes(ip))) {
      return {};
    }

    // Skip ignored patterns
    if (options.ignorePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(basename);
      }
      return basename === pattern;
    })) {
      return {};
    }

    // Check if we're in an enforced path
    const inEnforcedPath = options.enforcePaths.some(ep => {
      const epRegex = new RegExp('^' + ep.replace(/\*/g, '[^/]+'));
      return epRegex.test(relPath);
    });

    if (!inEnforcedPath) {
      return {};
    }

    // Skip test files (they don't need tests)
    if (isTestFile(basename)) {
      return {};
    }

    // Skip non-source files
    if (!isSourceFile(basename)) {
      return {};
    }

    return {
      Program(node) {
        const sourceCode = context.sourceCode || context.getSourceCode();
        const lines = sourceCode.getText().split('\n').length;

        // Skip small files
        if (lines < options.minLinesForTest) {
          return;
        }

        // Check for co-located test file
        const expectedTestPath = getExpectedTestPath(filename);
        const testsDir = path.join(dirname, '__tests__', basename.replace(/\.[^.]+$/, '.test.ts'));

        const hasColocatedTest = fs.existsSync(expectedTestPath);
        const hasTestsDir = options.allowTestsDirectory && fs.existsSync(testsDir);

        if (!hasColocatedTest && !hasTestsDir) {
          context.report({
            node,
            messageId: 'missingColocatedTest',
            data: {
              source: basename,
              expected: path.basename(expectedTestPath),
              testsDir: `__tests__/${path.basename(testsDir)}`
            }
          });
        }
      }
    };
  }
};
