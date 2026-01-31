/**
 * @fileoverview ESLint rule that enforces TaskWithDeps return types for task data
 *
 * This rule ensures CLAUDE.md RULE 1 compliance:
 * "Every API response MUST include full dependency information"
 *
 * Detection:
 * 1. Functions with return type 'Task' (not 'TaskWithDeps') in external-facing code
 * 2. Object literals missing blockedBy, blocks, children, isReady properties
 * 3. MCP tool handlers returning bare Task
 *
 * Reference: CLAUDE.md RULE 1, DD-005
 */

import path from 'path';

/**
 * Required properties for TaskWithDeps
 */
const REQUIRED_DEPS_PROPERTIES = ['blockedBy', 'blocks', 'children', 'isReady'];

/**
 * Paths that are considered external-facing (API/MCP/SDK boundaries)
 */
const EXTERNAL_PATHS = ['src/mcp/', 'apps/api-server/', 'apps/agent-sdk/', 'packages/core/src/'];

/**
 * Paths that are internal and allowed to return bare Task
 */
const INTERNAL_PATHS = ['src/repo/', 'src/services/', 'test/', 'tests/', '__tests__/', '.test.', '.spec.'];

/**
 * Check if a type reference is 'Task' but not 'TaskWithDeps'
 * @param {import('estree').Node} node - The type reference node
 * @returns {boolean}
 */
function isBareTaskType(node) {
  if (!node) return false;

  // Direct Task type
  if (node.type === 'TSTypeReference') {
    if (node.typeName.type === 'Identifier' && node.typeName.name === 'Task') {
      return true;
    }
  }

  // Task[] array type
  if (node.type === 'TSArrayType') {
    return isBareTaskType(node.elementType);
  }

  // Array<Task> generic
  if (node.type === 'TSTypeReference') {
    if (node.typeName.type === 'Identifier' && node.typeName.name === 'Array') {
      const params = node.typeParameters?.params;
      if (params && params.length > 0) {
        return isBareTaskType(params[0]);
      }
    }
  }

  // Promise<Task> or Effect<Task, ...>
  if (node.type === 'TSTypeReference') {
    const typeName = node.typeName;
    if (typeName.type === 'Identifier') {
      const genericNames = ['Promise', 'Effect'];
      if (genericNames.includes(typeName.name)) {
        const params = node.typeParameters?.params;
        if (params && params.length > 0) {
          return isBareTaskType(params[0]);
        }
      }
    }
    // Effect.Effect<Task, ...>
    if (typeName.type === 'TSQualifiedName') {
      if (typeName.left.type === 'Identifier' && typeName.left.name === 'Effect') {
        const params = node.typeParameters?.params;
        if (params && params.length > 0) {
          return isBareTaskType(params[0]);
        }
      }
    }
  }

  return false;
}

/**
 * Check if a value looks like a Zod schema call (z.string(), z.number(), etc.)
 * @param {import('estree').Node} node
 * @returns {boolean}
 */
function isZodSchemaCall(node) {
  if (!node) return false;

  // z.string(), z.number(), etc.
  if (node.type === 'CallExpression') {
    if (node.callee.type === 'MemberExpression') {
      const obj = node.callee.object;
      if (obj.type === 'Identifier' && obj.name === 'z') {
        return true;
      }
      // z.string().optional().describe()
      if (obj.type === 'CallExpression') {
        return isZodSchemaCall(obj);
      }
    }
  }
  return false;
}

/**
 * Check if an object expression is missing TaskWithDeps required properties
 * @param {import('estree').ObjectExpression} node
 * @returns {string[]} Array of missing property names
 */
function getMissingDepsProperties(node) {
  if (node.type !== 'ObjectExpression') return [];

  const presentProps = new Set();
  let hasZodSchema = false;

  for (const prop of node.properties) {
    if (prop.type === 'Property' && prop.key.type === 'Identifier') {
      presentProps.add(prop.key.name);

      // Check if any property value is a Zod schema (indicates this is a schema definition, not a Task)
      if (isZodSchemaCall(prop.value)) {
        hasZodSchema = true;
      }
    }
    if (prop.type === 'SpreadElement') {
      // If there's a spread, we can't know what properties it includes
      // Skip checking this object
      return [];
    }
  }

  // If this object contains Zod schema calls, it's a schema definition, not a Task
  if (hasZodSchema) return [];

  // Check if it looks like a Task object (must have 'id', 'title', AND 'status')
  // This is more strict to avoid false positives with partial objects
  const looksLikeTask = presentProps.has('id') && presentProps.has('title') && presentProps.has('status');
  if (!looksLikeTask) return [];

  // Find which required deps properties are missing
  return REQUIRED_DEPS_PROPERTIES.filter(prop => !presentProps.has(prop));
}

/**
 * Check if node is inside an MCP tool handler
 * @param {import('eslint').Rule.Node} node
 * @returns {boolean}
 */
function isInMcpToolHandler(node) {
  let current = node.parent;
  while (current) {
    // Check for server.tool() or similar patterns
    if (current.type === 'CallExpression') {
      if (current.callee.type === 'MemberExpression') {
        const prop = current.callee.property;
        if (prop.type === 'Identifier' && prop.name === 'tool') {
          return true;
        }
      }
    }
    // Check for function named like '*Tool' or 'handle*'
    if (current.type === 'FunctionDeclaration' || current.type === 'FunctionExpression') {
      const name = current.id?.name || '';
      if (name.includes('Tool') || name.startsWith('handle')) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce TaskWithDeps return types for external API responses (CLAUDE.md RULE 1)',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      bareTaskReturn: 'DOCTRINE VIOLATION: Every API response MUST include full dependency information. Return TaskWithDeps instead of Task.',
      bareTaskArray: 'DOCTRINE VIOLATION: Every API response MUST include full dependency information. Return TaskWithDeps[] instead of Task[].',
      missingDepsProperties: 'DOCTRINE VIOLATION: Task object is missing required dependency properties: {{missing}}. Add blockedBy, blocks, children, and isReady.',
      mcpToolBareTask: 'DOCTRINE VIOLATION: MCP tool handlers MUST return TaskWithDeps, not bare Task.'
    },
    schema: [
      {
        type: 'object',
        properties: {
          externalPaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'File paths considered external-facing (MCP, API, SDK)'
          },
          internalPaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'File paths considered internal (repos, services, tests)'
          },
          checkObjectLiterals: {
            type: 'boolean',
            description: 'Whether to check object literals for missing deps properties'
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = context.options[0] || {};
    const externalPaths = options.externalPaths || EXTERNAL_PATHS;
    const internalPaths = options.internalPaths || INTERNAL_PATHS;
    const checkObjectLiterals = options.checkObjectLiterals !== false;

    const filename = context.filename || context.getFilename();
    const cwd = context.cwd || context.getCwd?.() || process.cwd();
    const relPath = path.relative(cwd, filename).replace(/\\/g, '/');

    // Skip non-TypeScript files
    const ext = path.extname(filename).toLowerCase();
    if (!['.ts', '.tsx', '.mts', '.cts'].includes(ext)) {
      return {};
    }

    /**
     * Check if file is in external-facing paths
     */
    function isExternalPath() {
      return externalPaths.some(p => relPath.includes(p));
    }

    /**
     * Check if file is in internal paths (allowed to use bare Task)
     */
    function isInternalPath() {
      return internalPaths.some(p => relPath.includes(p));
    }

    /**
     * Determine if we should check this file
     */
    function shouldCheck() {
      // Always check external paths
      if (isExternalPath()) return true;
      // Skip internal paths
      if (isInternalPath()) return false;
      // Default: check src/ files that aren't explicitly internal
      return relPath.startsWith('src/') || relPath.startsWith('apps/');
    }

    if (!shouldCheck()) {
      return {};
    }

    return {
      // Check function return type annotations
      FunctionDeclaration(node) {
        const returnType = node.returnType?.typeAnnotation;
        if (returnType && isBareTaskType(returnType)) {
          const isArray = returnType.type === 'TSArrayType' ||
            (returnType.type === 'TSTypeReference' && returnType.typeName?.name === 'Array');

          context.report({
            node: node.returnType,
            messageId: isArray ? 'bareTaskArray' : 'bareTaskReturn'
          });
        }
      },

      // Check arrow functions and function expressions
      ArrowFunctionExpression(node) {
        const returnType = node.returnType?.typeAnnotation;
        if (returnType && isBareTaskType(returnType)) {
          const isArray = returnType.type === 'TSArrayType' ||
            (returnType.type === 'TSTypeReference' && returnType.typeName?.name === 'Array');

          context.report({
            node: node.returnType,
            messageId: isArray ? 'bareTaskArray' : 'bareTaskReturn'
          });
        }
      },

      FunctionExpression(node) {
        const returnType = node.returnType?.typeAnnotation;
        if (returnType && isBareTaskType(returnType)) {
          const isArray = returnType.type === 'TSArrayType' ||
            (returnType.type === 'TSTypeReference' && returnType.typeName?.name === 'Array');

          context.report({
            node: node.returnType,
            messageId: isArray ? 'bareTaskArray' : 'bareTaskReturn'
          });
        }
      },

      // Check method definitions
      MethodDefinition(node) {
        const returnType = node.value?.returnType?.typeAnnotation;
        if (returnType && isBareTaskType(returnType)) {
          const isArray = returnType.type === 'TSArrayType' ||
            (returnType.type === 'TSTypeReference' && returnType.typeName?.name === 'Array');

          context.report({
            node: node.value.returnType,
            messageId: isArray ? 'bareTaskArray' : 'bareTaskReturn'
          });
        }
      },

      // Check object literals in MCP tool handlers or external paths
      ObjectExpression(node) {
        if (!checkObjectLiterals) return;

        // Only check in MCP handlers or if explicitly in external path
        const inMcp = isInMcpToolHandler(node);
        if (!inMcp && !isExternalPath()) return;

        const missingProps = getMissingDepsProperties(node);
        if (missingProps.length > 0) {
          context.report({
            node,
            messageId: inMcp ? 'mcpToolBareTask' : 'missingDepsProperties',
            data: { missing: missingProps.join(', ') }
          });
        }
      },

      // Check type aliases and interface declarations
      TSTypeAliasDeclaration(node) {
        // Check if type alias assigns Task to a variable used in returns
        // This is for patterns like: type Result = Task (when it should be TaskWithDeps)
        if (node.typeAnnotation && isBareTaskType(node.typeAnnotation)) {
          // Only report if the type name suggests it's for external use
          const name = node.id?.name || '';
          const externalNames = ['Response', 'Result', 'Output', 'Return'];
          if (externalNames.some(n => name.includes(n))) {
            context.report({
              node: node.typeAnnotation,
              messageId: 'bareTaskReturn'
            });
          }
        }
      }
    };
  }
};
