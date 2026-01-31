/**
 * @fileoverview Tests for the require-effect-error-handling ESLint rule
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/require-effect-error-handling.js';

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

describe('require-effect-error-handling rule', () => {
  describe('meta', () => {
    it('has correct type', () => {
      expect(rule.meta.type).toBe('problem');
    });

    it('has messages defined', () => {
      expect(rule.meta.messages.runPromiseNoErrorHandling).toBeDefined();
      expect(rule.meta.messages.unknownErrorType).toBeDefined();
    });

    it('has schema for options', () => {
      expect(rule.meta.schema).toBeDefined();
      expect(rule.meta.schema[0].properties.allowedPaths).toBeDefined();
      expect(rule.meta.schema[0].properties.checkTypeAnnotations).toBeDefined();
    });
  });

  describe('allowed paths', () => {
    it('skips files in test/', () => {
      const context = createContext('/project/test/integration/task.test.ts');
      const visitor = rule.create(context);

      // Should have visitors but should not report errors for test files
      expect(visitor.CallExpression).toBeDefined();
    });

    it('skips .test.ts files', () => {
      const context = createContext('/project/src/services/task.test.ts');
      const visitor = rule.create(context);

      // Simulate a runPromise call in a test file
      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'runPromise' }
        },
        arguments: [{ type: 'Identifier', name: 'effect' }],
        parent: { type: 'Program' }
      };

      visitor.CallExpression(node);

      // No errors should be reported for test files
      expect(context._messages).toHaveLength(0);
    });

    it('skips non-TypeScript files', () => {
      const context = createContext('/project/src/services/task.js');
      const visitor = rule.create(context);

      // Should return empty object for non-TS files
      expect(Object.keys(visitor)).toHaveLength(0);
    });
  });

  describe('Effect.runPromise detection', () => {
    it('reports error for runPromise without error handling', () => {
      const context = createContext('/project/src/cli.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'runPromise' }
        },
        arguments: [{ type: 'Identifier', name: 'effect' }],
        parent: { type: 'Program' }
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('runPromiseNoErrorHandling');
    });

    it('reports error for runPromiseExit without error handling', () => {
      const context = createContext('/project/src/cli.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'runPromiseExit' }
        },
        arguments: [{ type: 'Identifier', name: 'effect' }],
        parent: { type: 'Program' }
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('runPromiseNoErrorHandling');
    });

    it('reports error for runSync without error handling', () => {
      const context = createContext('/project/src/cli.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'runSync' }
        },
        arguments: [{ type: 'Identifier', name: 'effect' }],
        parent: { type: 'Program' }
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('runPromiseNoErrorHandling');
    });

    it('allows runPromise in try block', () => {
      const context = createContext('/project/src/cli.ts');
      const visitor = rule.create(context);

      const tryStatement = { type: 'TryStatement' };
      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'runPromise' }
        },
        arguments: [{ type: 'Identifier', name: 'effect' }],
        parent: tryStatement
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows runPromise with .catch() chain', () => {
      const context = createContext('/project/src/cli.ts');
      const visitor = rule.create(context);

      // Parent is MemberExpression for .catch
      const catchMember = {
        type: 'MemberExpression',
        property: { type: 'Identifier', name: 'catch' }
      };

      const runPromiseCall = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'runPromise' }
        },
        arguments: [{ type: 'Identifier', name: 'effect' }],
        parent: catchMember
      };

      // Set up the chain
      catchMember.object = runPromiseCall;

      visitor.CallExpression(runPromiseCall);

      expect(context._messages).toHaveLength(0);
    });

    it('allows runPromise with Effect.catchAll in argument', () => {
      const context = createContext('/project/src/cli.ts');
      const visitor = rule.create(context);

      // effect.pipe(Effect.catchAll(...))
      const effectArg = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'effect' },
          property: { type: 'Identifier', name: 'pipe' }
        },
        arguments: []
      };

      // Add the catchAll to the chain
      effectArg.callee.object = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'catchAll' }
        },
        arguments: []
      };

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'runPromise' }
        },
        arguments: [effectArg],
        parent: { type: 'Program' }
      };

      visitor.CallExpression(node);

      // Should allow since catchAll is in the effect chain
      expect(context._messages).toHaveLength(0);
    });
  });

  describe('allows non-Effect calls', () => {
    it('does not report for regular function calls', () => {
      const context = createContext('/project/src/cli.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'someFunction' },
        arguments: [],
        parent: { type: 'Program' }
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(0);
    });

    it('does not report for other Effect methods', () => {
      const context = createContext('/project/src/cli.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'succeed' }
        },
        arguments: [{ type: 'Literal', value: 42 }],
        parent: { type: 'Program' }
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('custom options', () => {
    it('respects custom allowedPaths', () => {
      const options = [{ allowedPaths: ['examples/'] }];
      const context = createContext('/project/examples/demo.ts', options);
      const visitor = rule.create(context);

      const node = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'Effect' },
          property: { type: 'Identifier', name: 'runPromise' }
        },
        arguments: [{ type: 'Identifier', name: 'effect' }],
        parent: { type: 'Program' }
      };

      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(0);
    });
  });
});
