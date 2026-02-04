/**
 * @fileoverview ESLint rule that enforces Product Requirement Documents (PRD-*.md)
 * have a Failure Modes section documented.
 *
 * Failure Modes sections help ensure PRDs consider how the system can fail and
 * what recovery strategies should be implemented.
 */

import fs from 'fs';
import path from 'path';

/**
 * Check if content contains a Failure Modes section
 * @param {string} content - The markdown content
 * @returns {boolean}
 */
function hasFailureModesSection(content) {
  // Check for common patterns indicating failure modes documentation
  const patterns = [
    /^##\s+Failure\s+Modes?/im,                  // ## Failure Modes or ## Failure Mode
    /^###\s+Failure\s+Modes?/im,                 // ### Failure Modes
    /^##\s+Error\s+Recovery/im,                  // ## Error Recovery (alternative name)
    /^###\s+Error\s+Recovery/im,                 // ### Error Recovery
    /^##\s+Error\s+Handling/im,                  // ## Error Handling
    /^###\s+Error\s+Handling/im,                 // ### Error Handling
    /^##\s+Failure\s+Scenarios?/im,              // ## Failure Scenarios
    /^###\s+Failure\s+Scenarios?/im,             // ### Failure Scenarios
    /^##\s+Edge\s+Cases?\s+and\s+Failures?/im,   // ## Edge Cases and Failures
    /^###\s+Edge\s+Cases?\s+and\s+Failures?/im,  // ### Edge Cases and Failures
  ];

  return patterns.some(pattern => pattern.test(content));
}

/**
 * Check if content has a Recovery Strategy subsection
 * @param {string} content - The markdown content
 * @returns {boolean}
 */
function hasRecoveryStrategy(content) {
  const patterns = [
    /Recovery\s+Strategy/i,
    /Recovery\s+Strategies/i,
    /How\s+to\s+Recover/i,
    /Graceful\s+Degradation/i,
    /Fallback/i,
  ];

  return patterns.some(pattern => pattern.test(content));
}

const defaultOptions = {
  prdPattern: /^PRD-\d{3}-.+\.md$/,
  prdDirectory: 'docs/prd',
  requireFailureModes: true,
  requireRecoveryStrategy: false,
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce Product Requirement Documents have a Failure Modes section',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      missingFailureModes: 'PRD {{filename}} is missing a "## Failure Modes" section. PRDs should document how the system can fail and recovery strategies.',
      missingRecoveryStrategy: 'PRD {{filename}} has a Failure Modes section but is missing recovery strategies. Consider documenting how to recover from each failure mode.'
    },
    schema: [
      {
        type: 'object',
        properties: {
          prdPattern: {
            type: 'string',
            description: 'Regex pattern for PRD filename matching'
          },
          prdDirectory: {
            type: 'string',
            description: 'Directory containing Product Requirement Documents'
          },
          requireFailureModes: {
            type: 'boolean',
            description: 'Whether to require a Failure Modes section'
          },
          requireRecoveryStrategy: {
            type: 'boolean',
            description: 'Whether to require recovery strategies within Failure Modes'
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
    const prdPattern = typeof options.prdPattern === 'string'
      ? new RegExp(options.prdPattern)
      : options.prdPattern;

    // Skip files that don't match PRD pattern
    if (!prdPattern.test(basename)) {
      return {};
    }

    // Skip files not in the expected directory
    if (options.prdDirectory && !relPath.startsWith(options.prdDirectory)) {
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

        // Check for Failure Modes section
        if (options.requireFailureModes && !hasFailureModesSection(content)) {
          context.report({
            node,
            messageId: 'missingFailureModes',
            data: {
              filename: basename
            }
          });
          return; // Don't check recovery if no failure modes section
        }

        // Check for Recovery Strategy (if Failure Modes exists)
        if (options.requireRecoveryStrategy && hasFailureModesSection(content) && !hasRecoveryStrategy(content)) {
          context.report({
            node,
            messageId: 'missingRecoveryStrategy',
            data: {
              filename: basename
            }
          });
        }
      }
    };
  }
};

// Export helper functions for testing
export { hasFailureModesSection, hasRecoveryStrategy };
