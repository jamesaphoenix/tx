/**
 * @fileoverview ESLint rule that bans Zod imports
 *
 * Enforces DOCTRINE RULE 10: Use Effect Schema instead of Zod.
 *
 * Detection patterns:
 * - import ... from 'zod'
 * - import ... from 'zod/*'
 * - import ... from '@hono/zod-openapi'
 * - import ... from '@hono/zod-validator'
 * - require('zod') / require('@hono/zod-...')
 */

const BANNED_PATTERNS = [
  /^zod$/,
  /^zod\//,
  /^@hono\/zod-/
];

/**
 * Check if a module specifier matches a banned Zod pattern
 * @param {string} source - The import source string
 * @returns {boolean}
 */
function isZodImport(source) {
  return BANNED_PATTERNS.some(pattern => pattern.test(source));
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Zod imports (use Effect Schema instead)',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noZod: 'Use Effect Schema (import { Schema } from "effect") instead of Zod. See DOCTRINE RULE 10.'
    },
    schema: []
  },

  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source && typeof node.source.value === 'string') {
          if (isZodImport(node.source.value)) {
            context.report({
              node,
              messageId: 'noZod'
            });
          }
        }
      },

      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal' &&
          typeof node.arguments[0].value === 'string' &&
          isZodImport(node.arguments[0].value)
        ) {
          context.report({
            node,
            messageId: 'noZod'
          });
        }
      }
    };
  }
};
