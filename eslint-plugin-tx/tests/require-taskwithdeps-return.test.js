/**
 * @fileoverview Tests for the require-taskwithdeps-return ESLint rule
 *
 * Tests CLAUDE.md RULE 1 enforcement:
 * "Every API response MUST include full dependency information"
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/require-taskwithdeps-return.js';

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

describe('require-taskwithdeps-return rule', () => {
  describe('meta', () => {
    it('has correct type', () => {
      expect(rule.meta.type).toBe('problem');
    });

    it('has messages defined', () => {
      expect(rule.meta.messages.bareTaskReturn).toBeDefined();
      expect(rule.meta.messages.bareTaskArray).toBeDefined();
      expect(rule.meta.messages.missingDepsProperties).toBeDefined();
      expect(rule.meta.messages.mcpToolBareTask).toBeDefined();
    });

    it('has schema for options', () => {
      expect(rule.meta.schema).toBeDefined();
      expect(rule.meta.schema[0].properties.externalPaths).toBeDefined();
      expect(rule.meta.schema[0].properties.internalPaths).toBeDefined();
      expect(rule.meta.schema[0].properties.checkObjectLiterals).toBeDefined();
    });
  });

  describe('file path filtering', () => {
    it('skips non-TypeScript files', () => {
      const context = createContext('/project/src/mcp/server.js');
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips test files', () => {
      const context = createContext('/project/test/integration/task.test.ts');
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips .test.ts files', () => {
      const context = createContext('/project/src/services/task.test.ts');
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips internal repo files', () => {
      const context = createContext('/project/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('checks MCP files', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      expect(visitor.FunctionDeclaration).toBeDefined();
      expect(visitor.ArrowFunctionExpression).toBeDefined();
    });

    it('checks apps/api-server files', () => {
      const context = createContext('/project/apps/api-server/routes/tasks.ts');
      const visitor = rule.create(context);

      expect(visitor.FunctionDeclaration).toBeDefined();
    });
  });

  describe('bare Task return type detection', () => {
    it('reports error for function returning Task', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'getTask' },
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSTypeReference',
            typeName: { type: 'Identifier', name: 'Task' }
          }
        }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('bareTaskReturn');
    });

    it('reports error for function returning Task[]', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'getTasks' },
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSArrayType',
            elementType: {
              type: 'TSTypeReference',
              typeName: { type: 'Identifier', name: 'Task' }
            }
          }
        }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('bareTaskArray');
    });

    it('reports error for function returning Array<Task>', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'getTasks' },
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSTypeReference',
            typeName: { type: 'Identifier', name: 'Array' },
            typeParameters: {
              params: [{
                type: 'TSTypeReference',
                typeName: { type: 'Identifier', name: 'Task' }
              }]
            }
          }
        }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('bareTaskArray');
    });

    it('reports error for function returning Promise<Task>', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'getTask' },
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSTypeReference',
            typeName: { type: 'Identifier', name: 'Promise' },
            typeParameters: {
              params: [{
                type: 'TSTypeReference',
                typeName: { type: 'Identifier', name: 'Task' }
              }]
            }
          }
        }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('bareTaskReturn');
    });

    it('reports error for function returning Effect<Task, E>', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'getTask' },
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSTypeReference',
            typeName: { type: 'Identifier', name: 'Effect' },
            typeParameters: {
              params: [{
                type: 'TSTypeReference',
                typeName: { type: 'Identifier', name: 'Task' }
              }]
            }
          }
        }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('bareTaskReturn');
    });

    it('reports error for Effect.Effect<Task, E>', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'getTask' },
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSTypeReference',
            typeName: {
              type: 'TSQualifiedName',
              left: { type: 'Identifier', name: 'Effect' },
              right: { type: 'Identifier', name: 'Effect' }
            },
            typeParameters: {
              params: [{
                type: 'TSTypeReference',
                typeName: { type: 'Identifier', name: 'Task' }
              }]
            }
          }
        }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('bareTaskReturn');
    });
  });

  describe('allows TaskWithDeps return types', () => {
    it('does not report for function returning TaskWithDeps', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'getTask' },
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSTypeReference',
            typeName: { type: 'Identifier', name: 'TaskWithDeps' }
          }
        }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('does not report for function returning TaskWithDeps[]', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'getTasks' },
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSArrayType',
            elementType: {
              type: 'TSTypeReference',
              typeName: { type: 'Identifier', name: 'TaskWithDeps' }
            }
          }
        }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('does not report for function returning void', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'deleteTask' },
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSVoidKeyword'
          }
        }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('does not report for function returning string', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'getTaskId' },
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSStringKeyword'
          }
        }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('arrow function expressions', () => {
    it('reports error for arrow function returning Task', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'ArrowFunctionExpression',
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSTypeReference',
            typeName: { type: 'Identifier', name: 'Task' }
          }
        }
      };

      visitor.ArrowFunctionExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('bareTaskReturn');
    });
  });

  describe('function expressions', () => {
    it('reports error for function expression returning Task', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionExpression',
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSTypeReference',
            typeName: { type: 'Identifier', name: 'Task' }
          }
        }
      };

      visitor.FunctionExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('bareTaskReturn');
    });
  });

  describe('method definitions', () => {
    it('reports error for method returning Task', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'MethodDefinition',
        value: {
          returnType: {
            type: 'TSTypeAnnotation',
            typeAnnotation: {
              type: 'TSTypeReference',
              typeName: { type: 'Identifier', name: 'Task' }
            }
          }
        }
      };

      visitor.MethodDefinition(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('bareTaskReturn');
    });
  });

  describe('object literal checking', () => {
    it('reports error for object missing deps properties in MCP handler', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      // Create an MCP tool handler structure
      const toolCallNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'server' },
          property: { type: 'Identifier', name: 'tool' }
        }
      };

      const objectNode = {
        type: 'ObjectExpression',
        properties: [
          {
            type: 'Property',
            key: { type: 'Identifier', name: 'id' },
            value: { type: 'Literal', value: 'tx-123' }
          },
          {
            type: 'Property',
            key: { type: 'Identifier', name: 'title' },
            value: { type: 'Literal', value: 'Test task' }
          },
          {
            type: 'Property',
            key: { type: 'Identifier', name: 'status' },
            value: { type: 'Literal', value: 'active' }
          }
        ],
        parent: toolCallNode
      };

      visitor.ObjectExpression(objectNode);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('mcpToolBareTask');
    });

    it('does not report for object with all deps properties', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const toolCallNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'server' },
          property: { type: 'Identifier', name: 'tool' }
        }
      };

      const objectNode = {
        type: 'ObjectExpression',
        properties: [
          { type: 'Property', key: { type: 'Identifier', name: 'id' }, value: { type: 'Literal' } },
          { type: 'Property', key: { type: 'Identifier', name: 'title' }, value: { type: 'Literal' } },
          { type: 'Property', key: { type: 'Identifier', name: 'status' }, value: { type: 'Literal' } },
          { type: 'Property', key: { type: 'Identifier', name: 'blockedBy' }, value: { type: 'ArrayExpression' } },
          { type: 'Property', key: { type: 'Identifier', name: 'blocks' }, value: { type: 'ArrayExpression' } },
          { type: 'Property', key: { type: 'Identifier', name: 'children' }, value: { type: 'ArrayExpression' } },
          { type: 'Property', key: { type: 'Identifier', name: 'isReady' }, value: { type: 'Literal' } }
        ],
        parent: toolCallNode
      };

      visitor.ObjectExpression(objectNode);

      expect(context._messages).toHaveLength(0);
    });

    it('skips objects with spread elements', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const toolCallNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'server' },
          property: { type: 'Identifier', name: 'tool' }
        }
      };

      const objectNode = {
        type: 'ObjectExpression',
        properties: [
          { type: 'Property', key: { type: 'Identifier', name: 'id' }, value: { type: 'Literal' } },
          { type: 'Property', key: { type: 'Identifier', name: 'title' }, value: { type: 'Literal' } },
          { type: 'SpreadElement', argument: { type: 'Identifier', name: 'existingTask' } }
        ],
        parent: toolCallNode
      };

      visitor.ObjectExpression(objectNode);

      // Should not report because spread might include the deps properties
      expect(context._messages).toHaveLength(0);
    });

    it('skips objects that do not look like Task', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const toolCallNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'server' },
          property: { type: 'Identifier', name: 'tool' }
        }
      };

      const objectNode = {
        type: 'ObjectExpression',
        properties: [
          { type: 'Property', key: { type: 'Identifier', name: 'foo' }, value: { type: 'Literal' } },
          { type: 'Property', key: { type: 'Identifier', name: 'bar' }, value: { type: 'Literal' } }
        ],
        parent: toolCallNode
      };

      visitor.ObjectExpression(objectNode);

      expect(context._messages).toHaveLength(0);
    });

    it('skips Zod schema objects (e.g., tool parameter definitions)', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const toolCallNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'server' },
          property: { type: 'Identifier', name: 'tool' }
        }
      };

      // Object with Zod schema calls: { id: z.string(), title: z.string(), status: z.string() }
      const zodStringCall = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'z' },
          property: { type: 'Identifier', name: 'string' }
        }
      };

      const objectNode = {
        type: 'ObjectExpression',
        properties: [
          { type: 'Property', key: { type: 'Identifier', name: 'id' }, value: zodStringCall },
          { type: 'Property', key: { type: 'Identifier', name: 'title' }, value: zodStringCall },
          { type: 'Property', key: { type: 'Identifier', name: 'status' }, value: zodStringCall }
        ],
        parent: toolCallNode
      };

      visitor.ObjectExpression(objectNode);

      // Should not report because this is a Zod schema definition, not a Task object
      expect(context._messages).toHaveLength(0);
    });

    it('skips objects with chained Zod calls (z.string().optional().describe())', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const toolCallNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'server' },
          property: { type: 'Identifier', name: 'tool' }
        }
      };

      // z.string().optional().describe("...")
      const zodChainedCall = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: {
            type: 'CallExpression',
            callee: {
              type: 'MemberExpression',
              object: {
                type: 'CallExpression',
                callee: {
                  type: 'MemberExpression',
                  object: { type: 'Identifier', name: 'z' },
                  property: { type: 'Identifier', name: 'string' }
                }
              },
              property: { type: 'Identifier', name: 'optional' }
            }
          },
          property: { type: 'Identifier', name: 'describe' }
        }
      };

      const objectNode = {
        type: 'ObjectExpression',
        properties: [
          { type: 'Property', key: { type: 'Identifier', name: 'id' }, value: zodChainedCall },
          { type: 'Property', key: { type: 'Identifier', name: 'title' }, value: zodChainedCall },
          { type: 'Property', key: { type: 'Identifier', name: 'status' }, value: zodChainedCall }
        ],
        parent: toolCallNode
      };

      visitor.ObjectExpression(objectNode);

      // Should not report because this is a Zod schema definition, not a Task object
      expect(context._messages).toHaveLength(0);
    });

    it('requires id, title, AND status to consider as Task object', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const toolCallNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'server' },
          property: { type: 'Identifier', name: 'tool' }
        }
      };

      // Object with id and title but no status - should not be treated as Task
      const objectNode = {
        type: 'ObjectExpression',
        properties: [
          { type: 'Property', key: { type: 'Identifier', name: 'id' }, value: { type: 'Literal' } },
          { type: 'Property', key: { type: 'Identifier', name: 'title' }, value: { type: 'Literal' } }
        ],
        parent: toolCallNode
      };

      visitor.ObjectExpression(objectNode);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('type alias declarations', () => {
    it('reports error for type alias with Response suffix returning Task', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'TSTypeAliasDeclaration',
        id: { type: 'Identifier', name: 'TaskResponse' },
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: { type: 'Identifier', name: 'Task' }
        }
      };

      visitor.TSTypeAliasDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('bareTaskReturn');
    });

    it('does not report for internal type alias', () => {
      const context = createContext('/project/src/mcp/server.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'TSTypeAliasDeclaration',
        id: { type: 'Identifier', name: 'InternalTask' },
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: { type: 'Identifier', name: 'Task' }
        }
      };

      visitor.TSTypeAliasDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('custom options', () => {
    it('respects custom externalPaths', () => {
      const options = [{ externalPaths: ['src/custom-api/'] }];
      const context = createContext('/project/src/custom-api/handler.ts', options);
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'getTask' },
        returnType: {
          type: 'TSTypeAnnotation',
          typeAnnotation: {
            type: 'TSTypeReference',
            typeName: { type: 'Identifier', name: 'Task' }
          }
        }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('bareTaskReturn');
    });

    it('respects custom internalPaths', () => {
      const options = [{ internalPaths: ['src/special-internal/'] }];
      const context = createContext('/project/src/special-internal/service.ts', options);
      const visitor = rule.create(context);

      // Should skip because it's an internal path
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('respects checkObjectLiterals: false', () => {
      const options = [{ checkObjectLiterals: false }];
      const context = createContext('/project/src/mcp/server.ts', options);
      const visitor = rule.create(context);

      const toolCallNode = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'server' },
          property: { type: 'Identifier', name: 'tool' }
        }
      };

      const objectNode = {
        type: 'ObjectExpression',
        properties: [
          { type: 'Property', key: { type: 'Identifier', name: 'id' }, value: { type: 'Literal' } },
          { type: 'Property', key: { type: 'Identifier', name: 'title' }, value: { type: 'Literal' } }
        ],
        parent: toolCallNode
      };

      visitor.ObjectExpression(objectNode);

      // Should not report because checkObjectLiterals is false
      expect(context._messages).toHaveLength(0);
    });
  });
});
