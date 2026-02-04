/**
 * @fileoverview ESLint rule that enforces CLI, MCP, and API handlers return identical response shapes
 *
 * This rule ensures interface parity across all three interfaces per the tx design principle:
 * "Consistent field naming across CLI, MCP, API, and SDK"
 *
 * Detection:
 * 1. Identifies handler functions by name pattern and file location
 * 2. Extracts response shapes from JSON output (console.log, c.json, JSON.stringify)
 * 3. Compares response fields across interfaces for the same operation
 * 4. Flags duplicate serialization functions (should use shared @jamesaphoenix/tx-types)
 *
 * Reference: packages/types/src/response.ts
 */

import path from 'path';

/**
 * Expected response shapes per operation type.
 * Derived from packages/types/src/response.ts
 */
const RESPONSE_SCHEMAS = {
  // TaskReadyResponse: ready/getReady operations
  ready: {
    name: 'TaskReadyResponse',
    requiredFields: ['tasks'],
    optionalFields: ['count'],
    fieldTypes: {
      tasks: 'TaskWithDepsSerialized[]',
      count: 'number'
    }
  },
  // TaskCompletionResponse: done/complete operations
  done: {
    name: 'TaskCompletionResponse',
    requiredFields: ['task', 'nowReady'],
    fieldTypes: {
      task: 'TaskWithDepsSerialized',
      nowReady: 'TaskWithDepsSerialized[]' // NOT TaskId[]!
    }
  },
  // TaskDetailResponse: show/get operations
  show: {
    name: 'TaskDetailResponse',
    requiredFields: ['task'],
    optionalFields: ['blockedByTasks', 'blocksTasks', 'childTasks', 'attempts'],
    fieldTypes: {
      task: 'TaskWithDepsSerialized',
      blockedByTasks: 'TaskWithDepsSerialized[]',
      blocksTasks: 'TaskWithDepsSerialized[]',
      childTasks: 'TaskWithDepsSerialized[]'
    }
  },
  // ListResponse: list operations
  list: {
    name: 'ListResponse',
    requiredFields: ['items'],
    optionalFields: ['count', 'total', 'nextCursor', 'hasMore'],
    fieldTypes: {
      items: 'TaskWithDepsSerialized[]',
      count: 'number'
    }
  },
  // ActionResponse: create/update/delete operations
  create: {
    name: 'ActionResponse',
    requiredFields: ['task'],
    optionalFields: ['success', 'message'],
    fieldTypes: {
      task: 'TaskWithDepsSerialized',
      success: 'boolean'
    }
  },
  update: {
    name: 'ActionResponse',
    requiredFields: ['task'],
    optionalFields: ['success', 'message'],
    fieldTypes: {
      task: 'TaskWithDepsSerialized',
      success: 'boolean'
    }
  },
  delete: {
    name: 'ActionResponse',
    requiredFields: ['success'],
    optionalFields: ['id', 'message'],
    fieldTypes: {
      success: 'boolean',
      id: 'string'
    }
  }
};

/**
 * Operation name patterns for detection
 */
const OPERATION_PATTERNS = {
  ready: /^(handle)?[Rr]eady$/,
  done: /^(handle)?[Dd]one$|^(handle)?[Cc]omplete$/,
  show: /^(handle)?[Ss]how$|^(handle)?[Gg]et$/,
  list: /^(handle)?[Ll]ist$/,
  create: /^(handle)?[Aa]dd$|^(handle)?[Cc]reate$/,
  update: /^(handle)?[Uu]pdate$/,
  delete: /^(handle)?[Dd]elete$|^deleteTask$/
};

/**
 * Interface types based on file paths
 */
const INTERFACE_PATHS = {
  cli: ['apps/cli/', 'src/commands/'],
  mcp: ['apps/mcp-server/', 'src/mcp/', 'src/tools/'],
  api: ['apps/api-server/', 'src/routes/']
};

/**
 * Detect which interface type this file belongs to
 * @param {string} relPath - Relative file path
 * @returns {'cli' | 'mcp' | 'api' | null}
 */
function detectInterface(relPath) {
  for (const [iface, paths] of Object.entries(INTERFACE_PATHS)) {
    if (paths.some(p => relPath.includes(p))) {
      return iface;
    }
  }
  return null;
}

/**
 * Detect which operation type a function represents
 * @param {string} name - Function/handler name
 * @returns {string | null} - Operation type or null
 */
function detectOperation(name) {
  for (const [op, pattern] of Object.entries(OPERATION_PATTERNS)) {
    if (pattern.test(name)) {
      return op;
    }
  }
  return null;
}

/**
 * Extract property names from an object expression
 * @param {import('estree').ObjectExpression} node
 * @returns {string[]}
 */
function extractObjectProperties(node) {
  if (node.type !== 'ObjectExpression') return [];

  const props = [];
  for (const prop of node.properties) {
    if (prop.type === 'Property' && prop.key.type === 'Identifier') {
      props.push(prop.key.name);
    }
    if (prop.type === 'SpreadElement') {
      // Can't statically determine spread properties
      props.push('__SPREAD__');
    }
  }
  return props;
}

/**
 * Check if a property value looks like a serialized task array (vs TaskId array)
 * @param {import('estree').Property} prop
 * @returns {boolean}
 */
function isIdArrayNotTaskArray(prop) {
  if (!prop || prop.type !== 'Property') return false;

  const value = prop.value;

  // nowReady.map(t => t.id) - returns TaskId[], not TaskWithDepsSerialized[]
  if (value.type === 'CallExpression') {
    const callee = value.callee;
    if (callee.type === 'MemberExpression' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'map') {
      // Check if the map callback returns just t.id or similar
      const args = value.arguments;
      if (args.length > 0) {
        const callback = args[0];
        if (callback.type === 'ArrowFunctionExpression') {
          const body = callback.body;
          // t => t.id pattern
          if (body.type === 'MemberExpression' &&
              body.property.type === 'Identifier' &&
              body.property.name === 'id') {
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
      description: 'Enforce CLI, MCP, and API handlers return identical response shapes from shared schemas',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      responseShapeMismatch: 'Interface parity violation: {{operation}} response missing required field "{{field}}". Expected shape: {{expected}}.',
      idArrayInsteadOfTask: 'Interface parity violation: {{field}} should contain serialized tasks (TaskWithDepsSerialized[]), not task IDs (TaskId[]). Use .map(serializeTask) instead of .map(t => t.id).',
      duplicateSerializer: 'Interface parity violation: Local serializeTask() duplicates shared function. Import from @jamesaphoenix/tx-types instead.',
      useSharedResponseType: 'Interface parity violation: Use shared response type {{expected}} from @jamesaphoenix/tx-types for consistent interface shapes.',
      inconsistentFieldType: 'Interface parity violation: Field "{{field}}" has inconsistent type across interfaces. Expected {{expected}}, found {{actual}}.'
    },
    schema: [
      {
        type: 'object',
        properties: {
          checkSerializerDuplication: {
            type: 'boolean',
            description: 'Flag local serializeTask definitions (default: true)',
            default: true
          },
          checkResponseShapes: {
            type: 'boolean',
            description: 'Check response object shapes match expected schemas (default: true)',
            default: true
          },
          strictFieldTypes: {
            type: 'boolean',
            description: 'Strictly check field types (e.g., TaskId[] vs TaskWithDepsSerialized[]) (default: true)',
            default: true
          },
          allowedPaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'File paths to check (default: CLI, MCP, API paths)'
          },
          ignorePaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'File paths to ignore (e.g., test files)'
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = context.options[0] || {};
    const checkSerializerDuplication = options.checkSerializerDuplication !== false;
    const checkResponseShapes = options.checkResponseShapes !== false;
    const strictFieldTypes = options.strictFieldTypes !== false;
    const ignorePaths = options.ignorePaths || ['test/', 'tests/', '__tests__/', '.test.', '.spec.'];

    const filename = context.filename || context.getFilename();
    const cwd = context.cwd || context.getCwd?.() || process.cwd();
    const relPath = path.relative(cwd, filename).replace(/\\/g, '/');

    // Skip non-TypeScript files
    const ext = path.extname(filename).toLowerCase();
    if (!['.ts', '.tsx', '.mts', '.cts'].includes(ext)) {
      return {};
    }

    // Skip ignored paths
    if (ignorePaths.some(p => relPath.includes(p))) {
      return {};
    }

    // Determine interface type
    const interfaceType = detectInterface(relPath);
    if (!interfaceType) {
      return {};
    }

    // Track current function context
    let currentOperation = null;

    return {

      // Check for duplicate serializeTask definitions
      VariableDeclaration(node) {
        if (!checkSerializerDuplication) return;

        for (const declarator of node.declarations) {
          if (declarator.id.type === 'Identifier' &&
              declarator.id.name === 'serializeTask') {
            // Allow if this IS the shared types package
            if (relPath.includes('packages/types/src/response')) {
              return;
            }

            context.report({
              node: declarator,
              messageId: 'duplicateSerializer'
            });
          }
        }
      },

      FunctionDeclaration(node) {
        if (!checkSerializerDuplication) return;

        if (node.id && node.id.name === 'serializeTask') {
          // Allow if this IS the shared types package
          if (relPath.includes('packages/types/src/response')) {
            return;
          }

          context.report({
            node,
            messageId: 'duplicateSerializer'
          });
        }
      },

      // Track function context for response shape checking
      ':function'(node) {
        // Get function name
        let funcName = null;
        if (node.type === 'FunctionDeclaration' && node.id) {
          funcName = node.id.name;
        } else if (node.parent) {
          // const handleReady = async () => ...
          if (node.parent.type === 'VariableDeclarator' &&
              node.parent.id.type === 'Identifier') {
            funcName = node.parent.id.name;
          }
        }

        if (funcName) {
          currentOperation = detectOperation(funcName);
        }
      },

      // Reset function context
      ':function:exit'() {
        currentOperation = null;
      },

      // Check response shapes in JSON output
      CallExpression(node) {
        if (!checkResponseShapes || !currentOperation) return;

        // Detect JSON.stringify({ ... }) patterns
        let objectArg = null;

        // JSON.stringify(obj)
        if (node.callee.type === 'MemberExpression' &&
            node.callee.object.type === 'Identifier' &&
            node.callee.object.name === 'JSON' &&
            node.callee.property.type === 'Identifier' &&
            node.callee.property.name === 'stringify') {
          objectArg = node.arguments[0];
        }

        // console.log(toJson(obj)) - need to find the inner toJson call
        if (node.callee.type === 'Identifier' && node.callee.name === 'toJson') {
          objectArg = node.arguments[0];
        }

        // c.json(obj, 200) for Hono API
        if (node.callee.type === 'MemberExpression' &&
            node.callee.property.type === 'Identifier' &&
            node.callee.property.name === 'json') {
          objectArg = node.arguments[0];
        }

        if (!objectArg || objectArg.type !== 'ObjectExpression') {
          return;
        }

        const schema = RESPONSE_SCHEMAS[currentOperation];
        if (!schema) return;

        const props = extractObjectProperties(objectArg);

        // Skip if we have a spread (can't statically analyze)
        if (props.includes('__SPREAD__')) {
          return;
        }

        // Check required fields
        for (const requiredField of schema.requiredFields) {
          if (!props.includes(requiredField)) {
            context.report({
              node: objectArg,
              messageId: 'responseShapeMismatch',
              data: {
                operation: currentOperation,
                field: requiredField,
                expected: schema.name
              }
            });
          }
        }

        // Check field types (strict mode)
        if (strictFieldTypes) {
          for (const prop of objectArg.properties) {
            if (prop.type !== 'Property' || prop.key.type !== 'Identifier') {
              continue;
            }

            const fieldName = prop.key.name;

            // Check for ID array instead of Task array
            if (fieldName === 'nowReady' && currentOperation === 'done') {
              if (isIdArrayNotTaskArray(prop)) {
                context.report({
                  node: prop,
                  messageId: 'idArrayInsteadOfTask',
                  data: {
                    field: fieldName
                  }
                });
              }
            }
          }
        }
      }
    };
  }
};
