/**
 * @fileoverview ESLint rule that bans Hono framework imports
 *
 * Enforces DOCTRINE RULE 10: Use @effect/platform HttpApi instead of Hono.
 *
 * Detection patterns:
 * - import ... from 'hono'
 * - import ... from 'hono/*'
 * - import ... from '@hono/*'
 * - require('hono') / require('@hono/...')
 */

const BANNED_PATTERNS = [
  /^hono$/,
  /^hono\//,
  /^@hono\//
];

/**
 * Check if a module specifier matches a banned Hono pattern
 * @param {string} source - The import source string
 * @returns {boolean}
 */
function isHonoImport(source) {
  return BANNED_PATTERNS.some(pattern => pattern.test(source));
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Hono framework imports (use @effect/platform HttpApi instead)',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noHono: 'Use @effect/platform HttpApi instead of Hono. See DOCTRINE RULE 10.'
    },
    schema: []
  },

  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source && typeof node.source.value === 'string') {
          if (isHonoImport(node.source.value)) {
            context.report({
              node,
              messageId: 'noHono'
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
          isHonoImport(node.arguments[0].value)
        ) {
          context.report({
            node,
            messageId: 'noHono'
          });
        }
      }
    };
  }
};
