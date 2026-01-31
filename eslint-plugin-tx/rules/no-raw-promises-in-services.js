/**
 * @fileoverview ESLint rule that prevents raw Promise usage in service layer
 *
 * This rule ensures Effect-TS patterns are used consistently:
 * - Files in src/services/ MUST NOT use raw Promise (use Effect instead)
 * - Async/await is only allowed in CLI layer, not service layer
 *
 * Detection patterns:
 * - async function declarations
 * - async arrow functions
 * - async method definitions
 * - new Promise() constructor
 * - Promise.resolve/reject/all/race/allSettled/any
 * - .then()/.catch()/.finally() chains (Promise methods)
 *
 * Allowed:
 * - Effect.runPromise and similar (Effect's own Promise interop)
 * - Code in CLI, tests, and non-service files
 *
 * Reference: DD-002 Effect-TS patterns, CLAUDE.md RULE 5
 */

import path from 'path';

const DEFAULT_SERVICE_PATHS = ['src/services/'];

/**
 * Check if a file path matches any of the service path patterns
 * @param {string} filePath - Relative file path
 * @param {string[]} servicePaths - Array of service path prefixes
 * @returns {boolean}
 */
function isServiceFile(filePath, servicePaths) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return servicePaths.some(p => normalizedPath.includes(p));
}

/**
 * Effect methods that are allowed to contain async/Promise code
 * - runPromise/runSync: Effect's promise interop for running effects
 * - tryPromise/promise: Effect's wrappers for async code
 * - async: Effect's async interop
 */
const ALLOWED_EFFECT_METHODS = [
  'runPromise', 'runPromiseExit', 'runSync', 'runSyncExit', 'runFork',
  'tryPromise', 'promise', 'async', 'tryCatchPromise'
];

/**
 * Check if a node is inside an Effect method that wraps async code
 * This is allowed since it's Effect's interop with Promise
 * @param {import('eslint').Rule.Node} node
 * @returns {boolean}
 */
function isInsideEffectPromiseWrapper(node) {
  let current = node.parent;
  while (current) {
    if (current.type === 'CallExpression') {
      const callee = current.callee;
      if (callee.type === 'MemberExpression') {
        const { object, property } = callee;
        if (object.type === 'Identifier' && object.name === 'Effect') {
          if (property.type === 'Identifier') {
            if (ALLOWED_EFFECT_METHODS.includes(property.name)) {
              return true;
            }
          }
        }
      }
    }
    current = current.parent;
  }
  return false;
}

/**
 * Check if a .then/.catch/.finally call is on an Effect method result
 * @param {import('estree').CallExpression} node
 * @returns {boolean}
 */
function isPromiseMethodOnEffect(node) {
  if (node.callee.type !== 'MemberExpression') return false;

  const object = node.callee.object;

  // Check if the object is a call to Effect.runPromise or similar
  if (object.type === 'CallExpression') {
    if (object.callee.type === 'MemberExpression') {
      const { object: obj, property } = object.callee;
      if (obj.type === 'Identifier' && obj.name === 'Effect') {
        if (property.type === 'Identifier') {
          if (['runPromise', 'runPromiseExit'].includes(property.name)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw Promise usage in service layer (use Effect instead)',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noAsyncFunction: 'Async functions are not allowed in service layer. Use Effect.gen() instead.',
      noAsyncArrowFunction: 'Async arrow functions are not allowed in service layer. Use Effect.gen() or Effect.promise() instead.',
      noAsyncMethod: 'Async methods are not allowed in service layer. Use Effect.gen() instead.',
      noNewPromise: 'new Promise() is not allowed in service layer. Use Effect.async() or Effect.promise() instead.',
      noPromiseStatic: 'Promise.{{method}}() is not allowed in service layer. Use Effect.{{suggestion}} instead.',
      noPromiseChain: '.{{method}}() Promise chains are not allowed in service layer. Use Effect.flatMap/catchAll/ensuring instead.'
    },
    schema: [
      {
        type: 'object',
        properties: {
          servicePaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'File path patterns where raw Promises are disallowed'
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = context.options[0] || {};
    const servicePaths = options.servicePaths || DEFAULT_SERVICE_PATHS;

    const filename = context.filename || context.getFilename();
    const cwd = context.cwd || context.getCwd?.() || process.cwd();
    const relPath = path.relative(cwd, filename);

    // Skip files not in service paths
    if (!isServiceFile(relPath, servicePaths)) {
      return {};
    }

    // Skip non-TypeScript files
    const ext = path.extname(filename).toLowerCase();
    if (!['.ts', '.tsx', '.mts', '.cts'].includes(ext)) {
      return {};
    }

    return {
      // Check for async function declarations
      FunctionDeclaration(node) {
        if (node.async) {
          context.report({
            node,
            messageId: 'noAsyncFunction'
          });
        }
      },

      // Check for async arrow functions
      ArrowFunctionExpression(node) {
        if (node.async) {
          // Skip if inside Effect.runPromise (allowed for interop)
          if (isInsideEffectPromiseWrapper(node)) {
            return;
          }
          context.report({
            node,
            messageId: 'noAsyncArrowFunction'
          });
        }
      },

      // Check for async method definitions
      MethodDefinition(node) {
        if (node.value.async) {
          context.report({
            node,
            messageId: 'noAsyncMethod'
          });
        }
      },

      // Check for async function expressions (in object properties, etc.)
      FunctionExpression(node) {
        if (node.async) {
          context.report({
            node,
            messageId: 'noAsyncFunction'
          });
        }
      },

      // Check for new Promise()
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Promise') {
          context.report({
            node,
            messageId: 'noNewPromise'
          });
        }
      },

      // Check for Promise.resolve/reject/all/race/etc.
      CallExpression(node) {
        const { callee } = node;

        // Check for Promise.method() calls
        if (callee.type === 'MemberExpression') {
          const { object, property } = callee;

          // Promise.resolve(), Promise.reject(), Promise.all(), etc.
          if (object.type === 'Identifier' && object.name === 'Promise') {
            if (property.type === 'Identifier') {
              const method = property.name;
              const suggestions = {
                resolve: 'succeed',
                reject: 'fail',
                all: 'all',
                race: 'race',
                allSettled: 'allSuccesses/allSettled',
                any: 'raceFirst'
              };

              if (suggestions[method]) {
                context.report({
                  node,
                  messageId: 'noPromiseStatic',
                  data: {
                    method,
                    suggestion: suggestions[method]
                  }
                });
              }
            }
          }

          // Check for .then()/.catch()/.finally() chains
          if (property.type === 'Identifier') {
            const chainMethods = ['then', 'catch', 'finally'];
            if (chainMethods.includes(property.name)) {
              // Skip if this is on Effect.runPromise result (allowed)
              if (isPromiseMethodOnEffect(node)) {
                return;
              }

              // Skip if inside Effect.runPromise
              if (isInsideEffectPromiseWrapper(node)) {
                return;
              }

              context.report({
                node,
                messageId: 'noPromiseChain',
                data: {
                  method: property.name
                }
              });
            }
          }
        }
      }
    };
  }
};
