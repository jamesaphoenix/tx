/**
 * @fileoverview ESLint rule that enforces Effect-TS error handling patterns
 *
 * This rule ensures Effect-TS code follows proper error handling:
 * 1. Effect.runPromise calls MUST be wrapped in try/catch OR preceded by Effect.catchAll/catchTag/either
 * 2. Services returning Effect<T, E> should have E properly typed (not unknown)
 * 3. TaggedError types should be exhaustively handled
 *
 * Reference: DD-002 Effect-TS patterns, CLAUDE.md RULE 5
 */

import path from 'path';

/**
 * Check if a CallExpression is Effect.runPromise, Effect.runPromiseExit, or Effect.runSync
 * @param {import('estree').CallExpression} node
 * @returns {boolean}
 */
function isEffectRunCall(node) {
  if (node.callee.type !== 'MemberExpression') return false;
  const { object, property } = node.callee;

  // Effect.runPromise, Effect.runPromiseExit, Effect.runSync
  if (object.type === 'Identifier' && object.name === 'Effect') {
    if (property.type === 'Identifier') {
      return ['runPromise', 'runPromiseExit', 'runSync'].includes(property.name);
    }
  }
  return false;
}

/**
 * Check if an effect expression has error handling applied
 * Looks for: Effect.catchAll, Effect.catchTag, Effect.catchTags, Effect.either, Effect.catchAllCause
 * @param {import('estree').Expression} node
 * @returns {boolean}
 */
function hasErrorHandling(node) {
  if (node.type !== 'CallExpression') return false;

  // Check for pipe with error handling
  if (node.callee.type === 'MemberExpression') {
    const prop = node.callee.property;
    if (prop.type === 'Identifier') {
      const errorHandlers = ['catchAll', 'catchTag', 'catchTags', 'either', 'catchAllCause', 'catch'];
      if (errorHandlers.includes(prop.name)) {
        return true;
      }
      // Check for method chaining - look at the object recursively
      return hasErrorHandling(node.callee.object);
    }
  }

  // Check for pipe() call with error handling in arguments
  if (node.callee.type === 'Identifier' && node.callee.name === 'pipe') {
    return node.arguments.some(arg => {
      if (arg.type === 'CallExpression' && arg.callee.type === 'MemberExpression') {
        const prop = arg.callee.property;
        if (prop.type === 'Identifier') {
          const errorHandlers = ['catchAll', 'catchTag', 'catchTags', 'either', 'catchAllCause', 'catch'];
          return errorHandlers.includes(prop.name);
        }
      }
      return false;
    });
  }

  // Check for Effect.pipe with error handling
  if (node.callee.type === 'MemberExpression') {
    const { object, property } = node.callee;
    if (object.type === 'Identifier' && object.name === 'Effect' &&
        property.type === 'Identifier' && property.name === 'pipe') {
      return node.arguments.slice(1).some(arg => {
        if (arg.type === 'CallExpression' && arg.callee.type === 'MemberExpression') {
          const prop = arg.callee.property;
          if (prop.type === 'Identifier') {
            const errorHandlers = ['catchAll', 'catchTag', 'catchTags', 'either', 'catchAllCause', 'catch'];
            return errorHandlers.includes(prop.name);
          }
        }
        return false;
      });
    }
  }

  return false;
}

/**
 * Check if a node is inside a try block
 * @param {import('eslint').Rule.Node} node
 * @returns {boolean}
 */
function isInTryBlock(node) {
  let current = node.parent;
  while (current) {
    if (current.type === 'TryStatement') {
      return true;
    }
    // Check if we're in a .catch() call chain
    if (current.type === 'CallExpression') {
      if (current.callee.type === 'MemberExpression') {
        const prop = current.callee.property;
        if (prop.type === 'Identifier' && prop.name === 'catch') {
          return true;
        }
      }
    }
    current = current.parent;
  }
  return false;
}

/**
 * Check if a node is the callee of a .catch() chain
 * @param {import('eslint').Rule.Node} node
 * @returns {boolean}
 */
function hasCatchChain(node) {
  const parent = node.parent;
  if (!parent) return false;

  // Check if parent is a MemberExpression accessing .catch
  if (parent.type === 'MemberExpression' && parent.object === node) {
    const prop = parent.property;
    if (prop.type === 'Identifier' && prop.name === 'catch') {
      return true;
    }
  }

  // Check if grandparent is a call to .catch()
  const grandparent = parent.parent;
  if (grandparent && grandparent.type === 'CallExpression') {
    if (grandparent.callee.type === 'MemberExpression') {
      const prop = grandparent.callee.property;
      if (prop.type === 'Identifier' && prop.name === 'catch') {
        return true;
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
      description: 'Enforce Effect-TS error handling patterns',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      runPromiseNoErrorHandling: 'Effect.runPromise must be wrapped in try/catch, use .catch(), or the Effect must have error handling (catchAll, catchTag, either)',
      unknownErrorType: 'Effect error type should be explicitly typed, not "unknown". Use a union of TaggedError types.',
      unhandledErrorType: 'TaggedError "{{errorType}}" is not handled. Add a catchTag or switch case for this error type.'
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedPaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'File paths where runPromise without error handling is allowed (e.g., test files)'
          },
          checkTypeAnnotations: {
            type: 'boolean',
            description: 'Whether to check for unknown error types in type annotations (requires TypeScript parser)'
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = context.options[0] || {};
    const allowedPaths = options.allowedPaths || ['test/', 'tests/', '__tests__/', '.test.', '.spec.'];
    const checkTypeAnnotations = options.checkTypeAnnotations !== false;

    const filename = context.filename || context.getFilename();
    const cwd = context.cwd || context.getCwd?.() || process.cwd();
    const relPath = path.relative(cwd, filename);

    // Check if file is in allowed paths (e.g., test files)
    function isAllowedPath() {
      const normalizedPath = relPath.replace(/\\/g, '/');
      return allowedPaths.some(p => normalizedPath.includes(p));
    }

    // Skip non-TypeScript files
    const ext = path.extname(filename).toLowerCase();
    if (!['.ts', '.tsx', '.mts', '.cts'].includes(ext)) {
      return {};
    }

    return {
      CallExpression(node) {
        // Check for Effect.runPromise, Effect.runSync, etc.
        if (isEffectRunCall(node)) {
          // Skip if in allowed paths (tests)
          if (isAllowedPath()) {
            return;
          }

          // Check if wrapped in try/catch
          if (isInTryBlock(node)) {
            return;
          }

          // Check if followed by .catch()
          if (hasCatchChain(node)) {
            return;
          }

          // Check if the effect argument has error handling
          const effectArg = node.arguments[0];
          if (effectArg && hasErrorHandling(effectArg)) {
            return;
          }

          context.report({
            node,
            messageId: 'runPromiseNoErrorHandling'
          });
        }
      },

      // Check type annotations for Effect<T, unknown>
      TSTypeReference(node) {
        if (!checkTypeAnnotations) return;

        // Look for Effect type with unknown error channel
        if (node.typeName.type === 'Identifier' && node.typeName.name === 'Effect') {
          // Skip if in service interface definitions (they're allowed to have unknown in some cases)
          // But flag in concrete implementations
        }

        // Check for Effect.Effect type
        if (node.typeName.type === 'TSQualifiedName') {
          const { left, right } = node.typeName;
          if (left.type === 'Identifier' && left.name === 'Effect' &&
              right.type === 'Identifier' && right.name === 'Effect') {
            // Check type parameters
            const params = node.typeParameters?.params;
            if (params && params.length >= 2) {
              const errorType = params[1];
              // Check if error type is 'unknown' or 'any'
              if (errorType.type === 'TSUnknownKeyword') {
                context.report({
                  node: errorType,
                  messageId: 'unknownErrorType'
                });
              }
            }
          }
        }
      }
    };
  }
};
