/**
 * @fileoverview ESLint rule that prevents domain event and review SQL references outside core repositories
 *
 * This rule enforces the ownership boundary from DD-039: adapter layers (dashboard server,
 * CLI, scripts) must not embed direct SQL references to domain_events or doc_review_runs.
 * All domain event and review persistence must go through packages/core/src/repo/.
 *
 * Verifies INV-SUP-010.
 */

import path from 'path';

const DEFAULT_TABLE_PATTERNS = ['domain_events', 'doc_review_runs'];
const DEFAULT_ALLOWED_PATHS = ['packages/core/src/repo/', 'migrations/', 'test/', 'tests/', '__tests__/'];

/**
 * Check if a file path matches any of the allowed path patterns
 * @param {string} filePath - Relative file path
 * @param {string[]} allowedPaths - Array of allowed path prefixes/segments
 * @returns {boolean}
 */
function isAllowedPath(filePath, allowedPaths) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  for (const allowed of allowedPaths) {
    if (normalizedPath.startsWith(allowed) || normalizedPath.includes(`/${allowed}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a string contains any of the supervised table references (case-insensitive)
 * @param {string} str - String to check
 * @param {string[]} tablePatterns - Array of table names to detect
 * @returns {string|null} - The detected table name or null
 */
function containsTableReference(str, tablePatterns) {
  const upperStr = str.toUpperCase();
  for (const table of tablePatterns) {
    if (upperStr.includes(table.toUpperCase())) {
      return table;
    }
  }
  return null;
}

/**
 * Get the string value from a literal or template literal node
 * @param {import('eslint').Rule.Node} node
 * @returns {string|null}
 */
function getStringValue(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral') {
    return node.quasis.map(q => q.value.raw).join('');
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow domain event and review SQL (domain_events, doc_review_runs) references outside core repositories',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noDomainEventsSql: 'Domain event/review SQL must be in packages/core/src/repo/, not adapter layers. Use core DomainEventService or DocReviewService instead. Detected table: {{table}}'
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedPaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'File path prefixes where domain event SQL is allowed'
          },
          tablePatterns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Table names to detect'
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = context.options[0] || {};
    const allowedPaths = options.allowedPaths || DEFAULT_ALLOWED_PATHS;
    const tablePatterns = options.tablePatterns || DEFAULT_TABLE_PATTERNS;

    const filename = context.filename || context.getFilename();
    const cwd = context.cwd || context.getCwd?.() || process.cwd();
    const relPath = path.relative(cwd, filename);

    if (isAllowedPath(relPath, allowedPaths)) {
      return {};
    }

    const ext = path.extname(filename).toLowerCase();
    if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      return {};
    }

    function checkNode(node) {
      const value = getStringValue(node);
      if (value) {
        const detected = containsTableReference(value, tablePatterns);
        if (detected) {
          context.report({
            node,
            messageId: 'noDomainEventsSql',
            data: { table: detected }
          });
        }
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          checkNode(node);
        }
      },
      TemplateLiteral(node) {
        checkNode(node);
      }
    };
  }
};
