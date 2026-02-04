/**
 * @fileoverview Tests for the interface-parity ESLint rule
 *
 * Tests interface contract parity enforcement across CLI, MCP, and API surfaces.
 * Ensures all interfaces return identical response shapes from core services.
 *
 * Per CLAUDE.md RULE 1: "Every API response MUST include full dependency information"
 * Per DD-005 and PRD-007: Consistent field naming across all interfaces
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/interface-parity.js';

// Mock ESLint context
function createContext(filename, options = []) {
  const messages = [];
  return {
    filename,
    cwd: '/project',
    options,
    sourceCode: {
      getText: () => ''
    },
    report: (info) => messages.push(info),
    _messages: messages
  };
}

describe('interface-parity rule', () => {
  describe('meta', () => {
    it('has correct type', () => {
      expect(rule.meta.type).toBe('problem');
    });

    it('has messages defined', () => {
      expect(rule.meta.messages.responseShapeMismatch).toBeDefined();
      expect(rule.meta.messages.idArrayInsteadOfTask).toBeDefined();
      expect(rule.meta.messages.duplicateSerializer).toBeDefined();
      expect(rule.meta.messages.useSharedResponseType).toBeDefined();
      expect(rule.meta.messages.inconsistentFieldType).toBeDefined();
    });

    it('has schema for options', () => {
      expect(rule.meta.schema).toBeDefined();
      expect(rule.meta.schema[0].properties.checkSerializerDuplication).toBeDefined();
      expect(rule.meta.schema[0].properties.checkResponseShapes).toBeDefined();
      expect(rule.meta.schema[0].properties.strictFieldTypes).toBeDefined();
      expect(rule.meta.schema[0].properties.ignorePaths).toBeDefined();
    });
  });

  describe('file path filtering', () => {
    it('skips non-TypeScript files', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.js');
      const visitor = rule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips test files', () => {
      const context = createContext('/project/test/integration/cli.test.ts');
      const visitor = rule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips .test.ts files', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.test.ts');
      const visitor = rule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips non-interface files', () => {
      const context = createContext('/project/packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('checks CLI files', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.ts');
      const visitor = rule.create(context);
      expect(visitor.VariableDeclaration).toBeDefined();
      expect(visitor.FunctionDeclaration).toBeDefined();
    });

    it('checks MCP files', () => {
      const context = createContext('/project/apps/mcp-server/src/tools/task.ts');
      const visitor = rule.create(context);
      expect(visitor.VariableDeclaration).toBeDefined();
    });

    it('checks API files', () => {
      const context = createContext('/project/apps/api-server/src/routes/tasks.ts');
      const visitor = rule.create(context);
      expect(visitor.VariableDeclaration).toBeDefined();
    });
  });

  describe('duplicate serializeTask detection', () => {
    it('reports error for local serializeTask variable declaration', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'VariableDeclaration',
        declarations: [
          {
            id: { type: 'Identifier', name: 'serializeTask' },
            init: { type: 'ArrowFunctionExpression' }
          }
        ]
      };

      visitor.VariableDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('duplicateSerializer');
    });

    it('reports error for local serializeTask function declaration', () => {
      const context = createContext('/project/apps/mcp-server/src/tools/task.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'serializeTask' }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('duplicateSerializer');
    });

    it('allows serializeTask in packages/types/src/response.ts', () => {
      const context = createContext('/project/packages/types/src/response.ts');
      const visitor = rule.create(context);

      // packages/types is not an interface path, so the rule returns empty visitor
      // This is correct - the rule doesn't apply to the shared types package
      expect(Object.keys(visitor)).toHaveLength(0);
      expect(context._messages).toHaveLength(0);
    });

    it('does not report for other variable names', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'VariableDeclaration',
        declarations: [
          {
            id: { type: 'Identifier', name: 'formatTask' },
            init: { type: 'ArrowFunctionExpression' }
          }
        ]
      };

      visitor.VariableDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('respects checkSerializerDuplication: false option', () => {
      const options = [{ checkSerializerDuplication: false }];
      const context = createContext('/project/apps/cli/src/commands/ready.ts', options);
      const visitor = rule.create(context);

      const node = {
        type: 'VariableDeclaration',
        declarations: [
          {
            id: { type: 'Identifier', name: 'serializeTask' },
            init: { type: 'ArrowFunctionExpression' }
          }
        ]
      };

      visitor.VariableDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('response shape checking for ready operation', () => {
    it('reports missing tasks field in ready handler', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.ts');
      const visitor = rule.create(context);

      // Enter a function named "handleReady"
      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleReady' }
      };
      visitor[':function'](funcNode);

      // JSON.stringify({ count: 5 }) - missing 'tasks' field
      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'count' },
                value: { type: 'Literal', value: 5 }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('responseShapeMismatch');
      expect(context._messages[0].data.operation).toBe('ready');
      expect(context._messages[0].data.field).toBe('tasks');
    });

    it('does not report when tasks field is present', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleReady' }
      };
      visitor[':function'](funcNode);

      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'tasks' },
                value: { type: 'ArrayExpression', elements: [] }
              },
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'count' },
                value: { type: 'Literal', value: 0 }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('response shape checking for done operation', () => {
    it('reports missing task field in done handler', () => {
      const context = createContext('/project/apps/cli/src/commands/done.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleDone' }
      };
      visitor[':function'](funcNode);

      // { nowReady: [...] } - missing 'task' field
      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'nowReady' },
                value: { type: 'ArrayExpression', elements: [] }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('responseShapeMismatch');
      expect(context._messages[0].data.field).toBe('task');
    });

    it('reports missing nowReady field in done handler', () => {
      const context = createContext('/project/apps/cli/src/commands/done.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleComplete' }
      };
      visitor[':function'](funcNode);

      // { task: {...} } - missing 'nowReady' field
      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'task' },
                value: { type: 'ObjectExpression', properties: [] }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('responseShapeMismatch');
      expect(context._messages[0].data.field).toBe('nowReady');
    });

    it('does not report when both task and nowReady are present', () => {
      const context = createContext('/project/apps/cli/src/commands/done.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleDone' }
      };
      visitor[':function'](funcNode);

      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'task' },
                value: { type: 'ObjectExpression', properties: [] }
              },
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'nowReady' },
                value: { type: 'ArrayExpression', elements: [] }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('strict field type checking', () => {
    it('reports ID array instead of task array for nowReady field', () => {
      const context = createContext('/project/apps/cli/src/commands/done.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleDone' }
      };
      visitor[':function'](funcNode);

      // { task: {...}, nowReady: tasks.map(t => t.id) } - nowReady contains IDs not tasks
      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'task' },
                value: { type: 'ObjectExpression', properties: [] }
              },
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'nowReady' },
                value: {
                  type: 'CallExpression',
                  callee: {
                    type: 'MemberExpression',
                    object: { type: 'Identifier', name: 'tasks' },
                    property: { type: 'Identifier', name: 'map' }
                  },
                  arguments: [
                    {
                      type: 'ArrowFunctionExpression',
                      params: [{ type: 'Identifier', name: 't' }],
                      body: {
                        type: 'MemberExpression',
                        object: { type: 'Identifier', name: 't' },
                        property: { type: 'Identifier', name: 'id' }
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('idArrayInsteadOfTask');
      expect(context._messages[0].data.field).toBe('nowReady');
    });

    it('does not report when strictFieldTypes is false', () => {
      const options = [{ strictFieldTypes: false }];
      const context = createContext('/project/apps/cli/src/commands/done.ts', options);
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleDone' }
      };
      visitor[':function'](funcNode);

      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'task' },
                value: { type: 'ObjectExpression', properties: [] }
              },
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'nowReady' },
                value: {
                  type: 'CallExpression',
                  callee: {
                    type: 'MemberExpression',
                    object: { type: 'Identifier', name: 'tasks' },
                    property: { type: 'Identifier', name: 'map' }
                  },
                  arguments: [
                    {
                      type: 'ArrowFunctionExpression',
                      params: [{ type: 'Identifier', name: 't' }],
                      body: {
                        type: 'MemberExpression',
                        object: { type: 'Identifier', name: 't' },
                        property: { type: 'Identifier', name: 'id' }
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      // Should still report the missing field check, but not the ID array check
      // Actually, with strictFieldTypes: false, the ID array check is skipped
      const idArrayMessages = context._messages.filter(m => m.messageId === 'idArrayInsteadOfTask');
      expect(idArrayMessages).toHaveLength(0);
    });
  });

  describe('response shape checking for show operation', () => {
    it('reports missing task field in show handler', () => {
      const context = createContext('/project/apps/api-server/src/routes/tasks.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleShow' }
      };
      visitor[':function'](funcNode);

      // c.json({ blockedByTasks: [] }) - missing 'task' field
      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'c' },
          property: { type: 'Identifier', name: 'json' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'blockedByTasks' },
                value: { type: 'ArrayExpression', elements: [] }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('responseShapeMismatch');
      expect(context._messages[0].data.field).toBe('task');
    });
  });

  describe('response shape checking for list operation', () => {
    it('reports missing items field in list handler', () => {
      const context = createContext('/project/apps/api-server/src/routes/tasks.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleList' }
      };
      visitor[':function'](funcNode);

      // { count: 10 } - missing 'items' field
      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'c' },
          property: { type: 'Identifier', name: 'json' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'count' },
                value: { type: 'Literal', value: 10 }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('responseShapeMismatch');
      expect(context._messages[0].data.field).toBe('items');
    });
  });

  describe('response shape checking for create operation', () => {
    it('reports missing task field in create handler', () => {
      const context = createContext('/project/apps/api-server/src/routes/tasks.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleCreate' }
      };
      visitor[':function'](funcNode);

      // { success: true } - missing 'task' field
      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'c' },
          property: { type: 'Identifier', name: 'json' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'success' },
                value: { type: 'Literal', value: true }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('responseShapeMismatch');
      expect(context._messages[0].data.field).toBe('task');
    });
  });

  describe('function context detection', () => {
    it('resets operation context after function exits', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.ts');
      const visitor = rule.create(context);

      // Enter handleReady function
      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleReady' }
      };
      visitor[':function'](funcNode);

      // Exit function
      visitor[':function:exit']();

      // Now check a JSON.stringify call - should not be flagged since no operation context
      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'count' },
                value: { type: 'Literal', value: 5 }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(0);
    });

    it('detects arrow function handlers assigned to variables', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.ts');
      const visitor = rule.create(context);

      // const handleReady = async () => { ... }
      const funcNode = {
        type: 'ArrowFunctionExpression',
        parent: {
          type: 'VariableDeclarator',
          id: { type: 'Identifier', name: 'handleReady' }
        }
      };
      visitor[':function'](funcNode);

      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'count' },
                value: { type: 'Literal', value: 5 }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.operation).toBe('ready');
    });
  });

  describe('skips objects with spread', () => {
    it('does not report when object has spread element', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleReady' }
      };
      visitor[':function'](funcNode);

      // { ...response, count: 5 }
      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'SpreadElement',
                argument: { type: 'Identifier', name: 'response' }
              },
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'count' },
                value: { type: 'Literal', value: 5 }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      // Should not report because spread might include required fields
      expect(context._messages).toHaveLength(0);
    });
  });

  describe('checkResponseShapes option', () => {
    it('skips response shape checking when checkResponseShapes is false', () => {
      const options = [{ checkResponseShapes: false }];
      const context = createContext('/project/apps/cli/src/commands/ready.ts', options);
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleReady' }
      };
      visitor[':function'](funcNode);

      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'count' },
                value: { type: 'Literal', value: 5 }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('ignorePaths option', () => {
    it('respects custom ignorePaths', () => {
      const options = [{ ignorePaths: ['src/internal/'] }];
      const context = createContext('/project/apps/cli/src/internal/handler.ts', options);
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });
  });

  describe('toJson call detection', () => {
    it('detects response shapes in toJson calls', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleReady' }
      };
      visitor[':function'](funcNode);

      // toJson({ count: 5 })
      const callNode = {
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'toJson' },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'count' },
                value: { type: 'Literal', value: 5 }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('responseShapeMismatch');
    });
  });

  describe('Hono c.json call detection', () => {
    it('detects response shapes in c.json calls', () => {
      const context = createContext('/project/apps/api-server/src/routes/tasks.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleReady' }
      };
      visitor[':function'](funcNode);

      // c.json({ count: 5 })
      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'c' },
          property: { type: 'Identifier', name: 'json' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: [
              {
                type: 'Property',
                key: { type: 'Identifier', name: 'count' },
                value: { type: 'Literal', value: 5 }
              }
            ]
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('responseShapeMismatch');
    });
  });

  describe('operation pattern matching', () => {
    it('matches Ready operation name', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'Ready' }
      };
      visitor[':function'](funcNode);

      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: []
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages[0].data.operation).toBe('ready');
    });

    it('matches Complete operation name for done schema', () => {
      const context = createContext('/project/apps/cli/src/commands/done.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'Complete' }
      };
      visitor[':function'](funcNode);

      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: []
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages[0].data.operation).toBe('done');
    });

    it('matches Get operation name for show schema', () => {
      const context = createContext('/project/apps/api-server/src/routes/tasks.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'Get' }
      };
      visitor[':function'](funcNode);

      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'c' },
          property: { type: 'Identifier', name: 'json' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: []
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages[0].data.operation).toBe('show');
    });

    it('matches Add operation name for create schema', () => {
      const context = createContext('/project/apps/api-server/src/routes/tasks.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'Add' }
      };
      visitor[':function'](funcNode);

      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'c' },
          property: { type: 'Identifier', name: 'json' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: []
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages[0].data.operation).toBe('create');
    });

    it('matches Update operation name', () => {
      const context = createContext('/project/apps/api-server/src/routes/tasks.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'Update' }
      };
      visitor[':function'](funcNode);

      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'c' },
          property: { type: 'Identifier', name: 'json' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: []
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages[0].data.operation).toBe('update');
    });

    it('matches Delete operation name', () => {
      const context = createContext('/project/apps/api-server/src/routes/tasks.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'Delete' }
      };
      visitor[':function'](funcNode);

      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'c' },
          property: { type: 'Identifier', name: 'json' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: []
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages[0].data.operation).toBe('delete');
    });

    it('matches deleteTask function name for delete schema', () => {
      const context = createContext('/project/apps/api-server/src/routes/tasks.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'deleteTask' }
      };
      visitor[':function'](funcNode);

      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'c' },
          property: { type: 'Identifier', name: 'json' }
        },
        arguments: [
          {
            type: 'ObjectExpression',
            properties: []
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages[0].data.operation).toBe('delete');
    });
  });

  describe('skips non-object arguments', () => {
    it('does not report when JSON.stringify argument is not an object', () => {
      const context = createContext('/project/apps/cli/src/commands/ready.ts');
      const visitor = rule.create(context);

      const funcNode = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'handleReady' }
      };
      visitor[':function'](funcNode);

      // JSON.stringify(someVariable)
      const callNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'JSON' },
          property: { type: 'Identifier', name: 'stringify' }
        },
        arguments: [
          {
            type: 'Identifier',
            name: 'response'
          }
        ]
      };

      visitor.CallExpression(callNode);

      expect(context._messages).toHaveLength(0);
    });
  });
});
