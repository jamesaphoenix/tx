/**
 * @fileoverview ESLint rule that enforces Design Documents (DD-*.md) have
 * Integration Tests and Unit Tests sections documented.
 *
 * Per DD-007 (Testing Strategy), every Design Doc should document how the
 * feature will be tested with both unit and integration tests.
 */

import fs from 'fs';
import path from 'path';

/**
 * Check if content contains references to Integration Tests
 * @param {string} content - The markdown content
 * @returns {boolean}
 */
function hasIntegrationTestsSection(content) {
  // Check for common patterns indicating integration test documentation
  const patterns = [
    /##\s+.*Integration\s+Tests?/i,              // ## Integration Tests or ## X Integration Tests
    /###\s+.*Integration\s+Tests?/i,             // ### Integration Tests
    /##\s+.*\(Integration\)/i,                   // ## Something (Integration)
    /###\s+.*\(Integration\)/i,                  // ### Something (Integration)
    /####\s+.*\(Integration\)/i,                 // #### Something (Integration)
    /Integration\s+Test\s+Architecture/i,        // Integration Test Architecture section
    /Integration\s+Test\s+Examples?/i,           // Integration Test Examples
    /test\/integration/i,                        // References to test/integration directory
  ];

  return patterns.some(pattern => pattern.test(content));
}

/**
 * Check if content contains references to Unit Tests
 * @param {string} content - The markdown content
 * @returns {boolean}
 */
function hasUnitTestsSection(content) {
  // Check for common patterns indicating unit test documentation
  const patterns = [
    /##\s+.*Unit\s+Tests?/i,                     // ## Unit Tests or ## X Unit Tests
    /###\s+.*Unit\s+Tests?/i,                    // ### Unit Tests
    /##\s+.*\(Unit\)/i,                          // ## Something (Unit)
    /###\s+.*\(Unit\)/i,                         // ### Something (Unit)
    /####\s+.*\(Unit\)/i,                        // #### Something (Unit)
    /test\/unit/i,                               // References to test/unit directory
  ];

  return patterns.some(pattern => pattern.test(content));
}

/**
 * Check if content has a Testing Strategy section
 * @param {string} content - The markdown content
 * @returns {boolean}
 */
function hasTestingStrategySection(content) {
  const patterns = [
    /^##\s+Testing\s+Strategy/im,
    /^###\s+Testing\s+Strategy/im,
  ];

  return patterns.some(pattern => pattern.test(content));
}

/**
 * Get missing test section types
 * @param {string} content - The markdown content
 * @returns {string[]} - Array of missing section types
 */
function getMissingSections(content) {
  const missing = [];

  if (!hasTestingStrategySection(content)) {
    missing.push('Testing Strategy');
  }

  if (!hasIntegrationTestsSection(content)) {
    missing.push('Integration Tests');
  }

  if (!hasUnitTestsSection(content)) {
    missing.push('Unit Tests');
  }

  return missing;
}

const defaultOptions = {
  ddPattern: /^DD-\d{3}-.+\.md$/,
  ddDirectory: 'docs/design',
  requireTestingStrategy: true,
  requireIntegrationTests: true,
  requireUnitTests: true,
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce Design Documents have Integration Tests and Unit Tests sections',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      missingTestSections: 'Design Document {{filename}} is missing required test sections: {{missing}}. Per DD-007, all DDs must document testing strategy with both unit and integration tests.',
      noTestingStrategy: 'Design Document {{filename}} is missing a "## Testing Strategy" section.',
      noIntegrationTests: 'Design Document {{filename}} is missing Integration Tests documentation (e.g., "### X Tests (Integration)").',
      noUnitTests: 'Design Document {{filename}} is missing Unit Tests documentation (e.g., "### X Tests (Unit)").'
    },
    schema: [
      {
        type: 'object',
        properties: {
          ddPattern: {
            type: 'string',
            description: 'Regex pattern for DD filename matching'
          },
          ddDirectory: {
            type: 'string',
            description: 'Directory containing Design Documents'
          },
          requireTestingStrategy: {
            type: 'boolean',
            description: 'Whether to require a Testing Strategy section'
          },
          requireIntegrationTests: {
            type: 'boolean',
            description: 'Whether to require Integration Tests section'
          },
          requireUnitTests: {
            type: 'boolean',
            description: 'Whether to require Unit Tests section'
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
    const basename = path.basename(filename);

    // Create pattern from string if provided
    const ddPattern = typeof options.ddPattern === 'string'
      ? new RegExp(options.ddPattern)
      : options.ddPattern;

    // Skip files that don't match DD pattern
    if (!ddPattern.test(basename)) {
      return {};
    }

    // Skip files not in the expected directory
    if (options.ddDirectory && !relPath.startsWith(options.ddDirectory)) {
      return {};
    }

    return {
      Program(node) {
        // Read the markdown file content
        let content;
        try {
          content = fs.readFileSync(filename, 'utf-8');
        } catch {
          // Can't read file, skip
          return;
        }

        const missing = [];

        // Check for Testing Strategy section
        if (options.requireTestingStrategy && !hasTestingStrategySection(content)) {
          missing.push('Testing Strategy');
        }

        // Check for Integration Tests
        if (options.requireIntegrationTests && !hasIntegrationTestsSection(content)) {
          missing.push('Integration Tests');
        }

        // Check for Unit Tests
        if (options.requireUnitTests && !hasUnitTestsSection(content)) {
          missing.push('Unit Tests');
        }

        // Report if missing sections
        if (missing.length > 0) {
          context.report({
            node,
            messageId: 'missingTestSections',
            data: {
              filename: basename,
              missing: missing.join(', ')
            }
          });
        }
      }
    };
  }
};

// Export helper functions for testing
export { hasIntegrationTestsSection, hasUnitTestsSection, hasTestingStrategySection, getMissingSections };
