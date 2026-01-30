/**
 * @fileoverview ESLint rule that prevents inline SQL schema definitions outside migrations/
 *
 * This rule ensures that SQL DDL statements (CREATE TABLE, CREATE INDEX, ALTER TABLE, DROP TABLE)
 * are only defined in migrations/*.sql files, not inline in TypeScript code.
 *
 * Detection patterns:
 * - String literals containing DDL keywords
 * - Template literals containing DDL keywords
 *
 * Allowed:
 * - SELECT, INSERT, UPDATE, DELETE (queries are OK)
 * - migrations/*.sql files (schema definitions belong here)
 * - test/fixtures/* files (test setup may need in-memory DB schemas)
 */

import path from 'path';

const DEFAULT_DDL_KEYWORDS = ['CREATE TABLE', 'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE'];
const DEFAULT_ALLOWED_PATHS = ['migrations/', 'test/fixtures/'];

/**
 * Check if a file path matches any of the allowed path patterns
 * @param {string} filePath - Relative file path
 * @param {string[]} allowedPaths - Array of allowed path prefixes
 * @returns {boolean}
 */
function isAllowedPath(filePath, allowedPaths) {
  // Normalize path separators for cross-platform
  const normalizedPath = filePath.replace(/\\/g, '/');

  for (const allowed of allowedPaths) {
    if (normalizedPath.startsWith(allowed) || normalizedPath.includes(`/${allowed}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a string contains any DDL keywords (case-insensitive)
 * @param {string} str - String to check
 * @param {string[]} ddlKeywords - Array of DDL keywords to detect
 * @returns {string|null} - The detected keyword or null
 */
function containsDdlKeyword(str, ddlKeywords) {
  const upperStr = str.toUpperCase();
  for (const keyword of ddlKeywords) {
    if (upperStr.includes(keyword.toUpperCase())) {
      return keyword;
    }
  }
  return null;
}

/**
 * Get the string value from a literal node
 * @param {import('eslint').Rule.Node} node
 * @returns {string|null}
 */
function getStringValue(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral') {
    // Combine all quasi (static) parts of the template
    return node.quasis.map(q => q.value.raw).join('');
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow inline SQL schema definitions outside migrations/',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noInlineSql: 'SQL schema definitions must be in migrations/*.sql files, not inline code. Create a new migration file instead. Detected: {{keyword}}'
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedPaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'File path prefixes where inline SQL is allowed'
          },
          ddlKeywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'SQL DDL keywords to detect'
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = context.options[0] || {};
    const allowedPaths = options.allowedPaths || DEFAULT_ALLOWED_PATHS;
    const ddlKeywords = options.ddlKeywords || DEFAULT_DDL_KEYWORDS;

    const filename = context.filename || context.getFilename();
    const cwd = context.cwd || context.getCwd?.() || process.cwd();
    const relPath = path.relative(cwd, filename);

    // Skip files in allowed paths
    if (isAllowedPath(relPath, allowedPaths)) {
      return {};
    }

    // Skip non-TypeScript/JavaScript files (e.g., .sql files)
    const ext = path.extname(filename).toLowerCase();
    if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      return {};
    }

    /**
     * Check a node that might contain SQL DDL
     * @param {import('eslint').Rule.Node} node
     */
    function checkNode(node) {
      const value = getStringValue(node);
      if (value) {
        const detected = containsDdlKeyword(value, ddlKeywords);
        if (detected) {
          context.report({
            node,
            messageId: 'noInlineSql',
            data: {
              keyword: detected
            }
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
