/**
 * @fileoverview ESLint rule that bans throw statements in service code
 *
 * This rule enforces DOCTRINE RULE 5: All errors must be strongly typed with Effect-TS.
 * Raw `throw` statements are forbidden in service code. Use Effect.fail() with typed errors instead.
 *
 * Allowed patterns:
 * - Test files (.test., .spec., __tests__/)
 * - Scripts directory (/scripts/)
 * - CLI entry points (specified via options)
 *
 * Correct usage:
 * ```typescript
 * // WRONG
 * throw new Error('Something went wrong')
 *
 * // CORRECT
 * return Effect.fail(new MyTypedError({ reason: 'Something went wrong' }))
 * ```
 *
 * Reference: CLAUDE.md DOCTRINE RULE 5, DD-002 Effect-TS patterns
 */

import path from 'path';

const DEFAULT_EXCLUDED_PATTERNS = [
  '.test.',
  '.spec.',
  '__tests__/',
  '/scripts/',
  '/test/',
  '/tests/'
];

/**
 * Check if a file path matches any of the excluded patterns
 * @param {string} filePath - Relative or absolute file path
 * @param {string[]} excludedPatterns - Array of patterns to exclude
 * @returns {boolean}
 */
function isExcludedPath(filePath, excludedPatterns) {
  // Normalize path separators for cross-platform
  const normalizedPath = filePath.replace(/\\/g, '/');
  // Also prepend / to handle patterns that start with /
  const withLeadingSlash = '/' + normalizedPath;

  for (const pattern of excludedPatterns) {
    // Check both the normalized path and with leading slash
    if (normalizedPath.includes(pattern) || withLeadingSlash.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow throw statements in service code - use Effect.fail instead',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noThrow: 'Use Effect.fail() with a typed error instead of throw. See DOCTRINE RULE 5 in CLAUDE.md.'
    },
    schema: [
      {
        type: 'object',
        properties: {
          excludedPatterns: {
            type: 'array',
            items: { type: 'string' },
            description: 'File path patterns where throw statements are allowed'
          },
          allowHttpException: {
            type: 'boolean',
            description: 'Allow throwing HTTPException (Hono framework pattern)'
          },
          allowTypedErrors: {
            type: 'boolean',
            description: 'Allow throwing custom typed errors (extends Data.TaggedError)'
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = context.options[0] || {};
    const excludedPatterns = options.excludedPatterns || DEFAULT_EXCLUDED_PATTERNS;
    const allowHttpException = options.allowHttpException ?? false;
    const allowTypedErrors = options.allowTypedErrors ?? false;

    const filename = context.filename || context.getFilename();
    const cwd = context.cwd || context.getCwd?.() || process.cwd();
    const relPath = path.relative(cwd, filename);

    // Skip files in excluded paths
    if (isExcludedPath(relPath, excludedPatterns)) {
      return {};
    }

    // Skip non-TypeScript/JavaScript files
    const ext = path.extname(filename).toLowerCase();
    if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      return {};
    }

    return {
      ThrowStatement(node) {
        // Check if throwing HTTPException (Hono pattern) and if it's allowed
        if (allowHttpException && node.argument) {
          if (node.argument.type === 'NewExpression' &&
              node.argument.callee?.type === 'Identifier' &&
              node.argument.callee.name === 'HTTPException') {
            return;
          }
        }

        // Check if throwing typed errors and if they're allowed
        if (allowTypedErrors && node.argument) {
          if (node.argument.type === 'NewExpression' &&
              node.argument.callee?.type === 'Identifier') {
            const calleeName = node.argument.callee.name;
            // Allow custom typed errors (typically ending in 'Error' but not plain 'Error')
            if (calleeName !== 'Error' && calleeName.endsWith('Error')) {
              return;
            }
          }
        }

        context.report({
          node,
          messageId: 'noThrow'
        });
      }
    };
  }
};
