/**
 * @fileoverview Tests for the no-zod ESLint rule
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/no-zod.js';

// Mock ESLint context
function createContext() {
  const messages = [];
  return {
    report: (info) => messages.push(info),
    _messages: messages
  };
}

describe('no-zod rule', () => {
  describe('meta', () => {
    it('has correct type', () => {
      expect(rule.meta.type).toBe('problem');
    });

    it('has messages defined', () => {
      expect(rule.meta.messages.noZod).toContain('Use Effect Schema');
      expect(rule.meta.messages.noZod).toContain('DOCTRINE RULE 10');
    });

    it('has empty schema (no options)', () => {
      expect(rule.meta.schema).toEqual([]);
    });
  });

  describe('ImportDeclaration', () => {
    it('reports import from "zod"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        source: { value: 'zod' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noZod');
    });

    it('reports import from "zod/lib/types"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        source: { value: 'zod/lib/types' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noZod');
    });

    it('reports import from "@hono/zod-openapi"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        source: { value: '@hono/zod-openapi' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noZod');
    });

    it('reports import from "@hono/zod-validator"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        source: { value: '@hono/zod-validator' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noZod');
    });

    it('allows import from "effect"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        source: { value: 'effect' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows import from "@effect/platform"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        source: { value: '@effect/platform' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows import from unrelated packages', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        source: { value: 'express' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('does not match partial name like "zod-like"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      // "zod-like" does not match ^zod$ or ^zod/
      const node = {
        source: { value: 'zod-like' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('does not match "zodiac" or similar', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        source: { value: 'zodiac' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('handles node with no source value gracefully', () => {
      const context = createContext();
      const visitor = rule.create(context);

      visitor.ImportDeclaration({ source: null });
      visitor.ImportDeclaration({ source: { value: 42 } });

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('CallExpression (require)', () => {
    it('reports require("zod")', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ type: 'Literal', value: 'zod' }]
      };
      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noZod');
    });

    it('reports require("@hono/zod-openapi")', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ type: 'Literal', value: '@hono/zod-openapi' }]
      };
      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(1);
    });

    it('allows require("effect")', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ type: 'Literal', value: 'effect' }]
      };
      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(0);
    });

    it('ignores non-require calls', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        callee: { type: 'Identifier', name: 'doSomething' },
        arguments: [{ type: 'Literal', value: 'zod' }]
      };
      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(0);
    });

    it('ignores require with no arguments', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        callee: { type: 'Identifier', name: 'require' },
        arguments: []
      };
      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(0);
    });

    it('ignores require with non-string argument', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ type: 'Identifier', name: 'moduleName' }]
      };
      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(0);
    });
  });
});
