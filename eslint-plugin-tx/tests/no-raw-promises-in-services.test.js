/**
 * @fileoverview Tests for the no-raw-promises-in-services ESLint rule
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/no-raw-promises-in-services.js';

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

describe('no-raw-promises-in-services rule', () => {
  describe('meta', () => {
    it('has correct type', () => {
      expect(rule.meta.type).toBe('problem');
    });

    it('has messages defined', () => {
      expect(rule.meta.messages.noAsyncFunction).toBeDefined();
      expect(rule.meta.messages.noAsyncArrowFunction).toBeDefined();
      expect(rule.meta.messages.noNewPromise).toBeDefined();
      expect(rule.meta.messages.noPromiseStatic).toBeDefined();
      expect(rule.meta.messages.noPromiseChain).toBeDefined();
    });

    it('has schema for options', () => {
      expect(rule.meta.schema).toBeDefined();
      expect(rule.meta.schema[0].properties.servicePaths).toBeDefined();
    });
  });

  describe('file path filtering', () => {
    it('skips files not in service paths', () => {
      const context = createContext('/project/src/cli.ts');
      const visitor = rule.create(context);

      // Should return empty object for non-service files
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('checks files in src/services/', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      // Should have visitors for service files
      expect(visitor.FunctionDeclaration).toBeDefined();
      expect(visitor.ArrowFunctionExpression).toBeDefined();
    });

    it('skips non-TypeScript files', () => {
      const context = createContext('/project/src/services/task.js');
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });
  });

  describe('async function detection', () => {
    it('reports error for async function declarations', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        async: true,
        id: { type: 'Identifier', name: 'fetchData' }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noAsyncFunction');
    });

    it('reports error for async arrow functions', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'ArrowFunctionExpression',
        async: true,
        parent: { type: 'VariableDeclarator' }
      };

      visitor.ArrowFunctionExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noAsyncArrowFunction');
    });

    it('reports error for async function expressions', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionExpression',
        async: true
      };

      visitor.FunctionExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noAsyncFunction');
    });

    it('allows non-async functions', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'FunctionDeclaration',
        async: false,
        id: { type: 'Identifier', name: 'processData' }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows async arrow functions inside Effect.tryPromise', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      // Effect.tryPromise({ try: async () => { ... } })
      const tryPromiseCall = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'tryPromise' }
        }
      };

      const node = {
        type: 'ArrowFunctionExpression',
        async: true,
        parent: { type: 'Property', parent: { type: 'ObjectExpression', parent: tryPromiseCall } }
      };

      // Set up parent chain
      node.parent.parent.parent = tryPromiseCall;

      visitor.ArrowFunctionExpression(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows async arrow functions inside Effect.promise', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      // Effect.promise(async () => { ... })
      const promiseCall = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'promise' }
        }
      };

      const node = {
        type: 'ArrowFunctionExpression',
        async: true,
        parent: promiseCall
      };

      visitor.ArrowFunctionExpression(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows async arrow functions inside Effect.async', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      // Effect.async(async () => { ... })
      const asyncCall = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'async' }
        }
      };

      const node = {
        type: 'ArrowFunctionExpression',
        async: true,
        parent: asyncCall
      };

      visitor.ArrowFunctionExpression(node);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('new Promise detection', () => {
    it('reports error for new Promise()', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'NewExpression',
        callee: { type: 'Identifier', name: 'Promise' }
      };

      visitor.NewExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noNewPromise');
    });

    it('allows new SomeOtherClass()', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'NewExpression',
        callee: { type: 'Identifier', name: 'SomeClass' }
      };

      visitor.NewExpression(node);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('Promise static method detection', () => {
    it('reports error for Promise.resolve()', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Promise' },
          property: { type: 'Identifier', name: 'resolve' }
        },
        arguments: [{ type: 'Literal', value: 42 }]
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noPromiseStatic');
      expect(context._messages[0].data.method).toBe('resolve');
      expect(context._messages[0].data.suggestion).toBe('succeed');
    });

    it('reports error for Promise.reject()', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Promise' },
          property: { type: 'Identifier', name: 'reject' }
        },
        arguments: [{ type: 'Identifier', name: 'error' }]
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noPromiseStatic');
      expect(context._messages[0].data.method).toBe('reject');
      expect(context._messages[0].data.suggestion).toBe('fail');
    });

    it('reports error for Promise.all()', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Promise' },
          property: { type: 'Identifier', name: 'all' }
        },
        arguments: [{ type: 'ArrayExpression', elements: [] }]
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.method).toBe('all');
      expect(context._messages[0].data.suggestion).toBe('all');
    });

    it('reports error for Promise.race()', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Promise' },
          property: { type: 'Identifier', name: 'race' }
        },
        arguments: [{ type: 'ArrayExpression', elements: [] }]
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.method).toBe('race');
    });
  });

  describe('Promise chain detection', () => {
    it('reports error for .then() chains', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'somePromise' },
          property: { type: 'Identifier', name: 'then' }
        },
        arguments: [{ type: 'ArrowFunctionExpression' }],
        parent: { type: 'ExpressionStatement' }
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noPromiseChain');
      expect(context._messages[0].data.method).toBe('then');
    });

    it('reports error for .catch() chains', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'somePromise' },
          property: { type: 'Identifier', name: 'catch' }
        },
        arguments: [{ type: 'ArrowFunctionExpression' }],
        parent: { type: 'ExpressionStatement' }
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noPromiseChain');
      expect(context._messages[0].data.method).toBe('catch');
    });

    it('allows .catch() on Effect.runPromise result', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      // Effect.runPromise(effect).catch(...)
      const runPromiseCall = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'runPromise' }
        },
        arguments: [{ type: 'Identifier', name: 'effect' }]
      };

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: runPromiseCall,
          property: { type: 'Identifier', name: 'catch' }
        },
        arguments: [{ type: 'ArrowFunctionExpression' }],
        parent: { type: 'ExpressionStatement' }
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('custom options', () => {
    it('respects custom servicePaths', () => {
      const options = [{ servicePaths: ['src/domain/'] }];
      const context = createContext('/project/src/domain/task.ts', options);
      const visitor = rule.create(context);

      // Should have visitors for custom domain path
      expect(visitor.FunctionDeclaration).toBeDefined();

      // Test async function detection
      const node = {
        type: 'FunctionDeclaration',
        async: true,
        id: { type: 'Identifier', name: 'fetchData' }
      };

      visitor.FunctionDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noAsyncFunction');
    });

    it('allows files outside custom servicePaths', () => {
      const options = [{ servicePaths: ['src/domain/'] }];
      const context = createContext('/project/src/services/task.ts', options);
      const visitor = rule.create(context);

      // Default src/services/ should not be included with custom config
      expect(Object.keys(visitor)).toHaveLength(0);
    });
  });
});
