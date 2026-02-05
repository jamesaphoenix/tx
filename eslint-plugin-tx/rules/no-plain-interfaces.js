/**
 * @fileoverview ESLint rule that bans plain TypeScript interfaces for domain types
 *
 * Enforces DOCTRINE RULE 10: Use Effect Schema (Schema.Struct) instead of plain interfaces.
 *
 * Detection patterns:
 * - export interface Task { ... }
 * - export interface Learning { ... }
 * - interface TaskWithDeps { ... }
 *
 * Excluded:
 * - Database row types: *Row, *RowWith* (internal, allowed per RULE 10)
 * - Response envelope types: ListResponse, PaginatedResponse, ActionResponse (generic wrappers)
 * - Configurable via options.excludedNames and options.excludedSuffixes
 */

const DEFAULT_EXCLUDED_NAMES = [
  'ListResponse',
  'PaginatedResponse',
  'ActionResponse'
];

const DEFAULT_EXCLUDED_SUFFIXES = ['Row'];

/**
 * Check if an interface name should be excluded from the rule
 * @param {string} name - The interface name
 * @param {string[]} excludedNames - Exact names to exclude
 * @param {string[]} excludedSuffixes - Name suffixes to exclude
 * @returns {boolean}
 */
function isExcluded(name, excludedNames, excludedSuffixes) {
  // Check exact name matches
  if (excludedNames.includes(name)) {
    return true;
  }

  // Check suffix matches (e.g. TaskRow, LearningRowWithBM25)
  for (const suffix of excludedSuffixes) {
    if (name.endsWith(suffix) || name.includes(suffix + 'With')) {
      return true;
    }
  }

  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow plain TypeScript interfaces for domain types (use Effect Schema instead)',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noPlainInterface: 'Use Effect Schema (Schema.Struct) instead of plain interfaces for "{{name}}". See DOCTRINE RULE 10.'
    },
    schema: [
      {
        type: 'object',
        properties: {
          excludedNames: {
            type: 'array',
            items: { type: 'string' },
            description: 'Interface names to exclude (e.g. response envelope types)'
          },
          excludedSuffixes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Interface name suffixes to exclude (e.g. "Row" for database types)'
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = context.options[0] || {};
    const excludedNames = options.excludedNames || DEFAULT_EXCLUDED_NAMES;
    const excludedSuffixes = options.excludedSuffixes || DEFAULT_EXCLUDED_SUFFIXES;

    return {
      TSInterfaceDeclaration(node) {
        const name = node.id && node.id.name;
        if (!name) {
          return;
        }

        if (isExcluded(name, excludedNames, excludedSuffixes)) {
          return;
        }

        context.report({
          node,
          messageId: 'noPlainInterface',
          data: { name }
        });
      }
    };
  }
};
