/**
 * @fileoverview Tests for the no-throw-in-services ESLint rule
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/no-throw-in-services.js';

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

describe('no-throw-in-services rule', () => {
  describe('meta', () => {
    it('has correct type', () => {
      expect(rule.meta.type).toBe('problem');
    });

    it('has messages defined', () => {
      expect(rule.meta.messages.noThrow).toContain('Effect.fail()');
    });

    it('has schema for options', () => {
      expect(rule.meta.schema).toBeDefined();
      expect(rule.meta.schema[0].properties.excludedPatterns).toBeDefined();
      expect(rule.meta.schema[0].properties.allowHttpException).toBeDefined();
      expect(rule.meta.schema[0].properties.allowTypedErrors).toBeDefined();
    });
  });

  describe('excluded paths', () => {
    it('skips test files with .test. in name', () => {
      const context = createContext('/project/src/services/task-service.test.ts');
      const visitor = rule.create(context);

      // Should return empty object (no visitors) for excluded paths
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips test files with .spec. in name', () => {
      const context = createContext('/project/src/services/task-service.spec.ts');
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips files in __tests__ directory', () => {
      const context = createContext('/project/src/services/__tests__/task-service.ts');
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips files in scripts directory', () => {
      const context = createContext('/project/scripts/migrate.ts');
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips files in test directory', () => {
      const context = createContext('/project/test/integration/task.test.ts');
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('does not skip regular src files', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      // Should have visitor for ThrowStatement
      expect(visitor.ThrowStatement).toBeDefined();
    });

    it('skips non-TypeScript files', () => {
      const context = createContext('/project/src/schema.json');
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });
  });

  describe('throw detection', () => {
    it('detects throw new Error()', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'ThrowStatement',
        argument: {
          type: 'NewExpression',
          callee: { type: 'Identifier', name: 'Error' },
          arguments: [{ type: 'Literal', value: 'Something went wrong' }]
        }
      };
      visitor.ThrowStatement(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noThrow');
    });

    it('detects throw with identifiers', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'ThrowStatement',
        argument: {
          type: 'Identifier',
          name: 'err'
        }
      };
      visitor.ThrowStatement(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noThrow');
    });

    it('detects throw with string literal', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'ThrowStatement',
        argument: {
          type: 'Literal',
          value: 'error message'
        }
      };
      visitor.ThrowStatement(node);

      expect(context._messages).toHaveLength(1);
    });
  });

  describe('allowHttpException option', () => {
    it('blocks HTTPException by default', () => {
      const context = createContext('/project/apps/api-server/src/routes/tasks.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'ThrowStatement',
        argument: {
          type: 'NewExpression',
          callee: { type: 'Identifier', name: 'HTTPException' },
          arguments: [{ type: 'Literal', value: 404 }]
        }
      };
      visitor.ThrowStatement(node);

      expect(context._messages).toHaveLength(1);
    });

    it('allows HTTPException when option is enabled', () => {
      const options = [{ allowHttpException: true }];
      const context = createContext('/project/apps/api-server/src/routes/tasks.ts', options);
      const visitor = rule.create(context);

      const node = {
        type: 'ThrowStatement',
        argument: {
          type: 'NewExpression',
          callee: { type: 'Identifier', name: 'HTTPException' },
          arguments: [{ type: 'Literal', value: 404 }]
        }
      };
      visitor.ThrowStatement(node);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('allowTypedErrors option', () => {
    it('blocks custom errors by default', () => {
      const context = createContext('/project/packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'ThrowStatement',
        argument: {
          type: 'NewExpression',
          callee: { type: 'Identifier', name: 'TaskNotFoundError' },
          arguments: [{ type: 'ObjectExpression', properties: [] }]
        }
      };
      visitor.ThrowStatement(node);

      expect(context._messages).toHaveLength(1);
    });

    it('allows custom typed errors when option is enabled', () => {
      const options = [{ allowTypedErrors: true }];
      const context = createContext('/project/packages/core/src/repo/task-repo.ts', options);
      const visitor = rule.create(context);

      const node = {
        type: 'ThrowStatement',
        argument: {
          type: 'NewExpression',
          callee: { type: 'Identifier', name: 'TaskNotFoundError' },
          arguments: [{ type: 'ObjectExpression', properties: [] }]
        }
      };
      visitor.ThrowStatement(node);

      expect(context._messages).toHaveLength(0);
    });

    it('still blocks plain Error even with allowTypedErrors', () => {
      const options = [{ allowTypedErrors: true }];
      const context = createContext('/project/packages/core/src/services/task-service.ts', options);
      const visitor = rule.create(context);

      const node = {
        type: 'ThrowStatement',
        argument: {
          type: 'NewExpression',
          callee: { type: 'Identifier', name: 'Error' },
          arguments: [{ type: 'Literal', value: 'plain error' }]
        }
      };
      visitor.ThrowStatement(node);

      expect(context._messages).toHaveLength(1);
    });
  });

  describe('custom options', () => {
    it('respects custom excludedPatterns', () => {
      const options = [{ excludedPatterns: ['/custom-allowed/'] }];
      const context = createContext('/project/custom-allowed/utils.ts', options);
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('custom patterns do not override defaults unless explicitly set', () => {
      // When custom patterns are provided, they replace defaults
      const options = [{ excludedPatterns: ['/custom-allowed/'] }];
      const context = createContext('/project/src/services/task-service.test.ts', options);
      const visitor = rule.create(context);

      // With only custom pattern, test files are no longer excluded
      expect(visitor.ThrowStatement).toBeDefined();
    });
  });
});
