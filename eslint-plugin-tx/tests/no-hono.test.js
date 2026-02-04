/**
 * @fileoverview Tests for the no-hono ESLint rule
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/no-hono.js';

// Mock ESLint context
function createContext() {
  const messages = [];
  return {
    report: (info) => messages.push(info),
    _messages: messages
  };
}

describe('no-hono rule', () => {
  describe('meta', () => {
    it('has correct type', () => {
      expect(rule.meta.type).toBe('problem');
    });

    it('has messages defined', () => {
      expect(rule.meta.messages.noHono).toContain('Use @effect/platform HttpApi instead of Hono');
      expect(rule.meta.messages.noHono).toContain('DOCTRINE RULE 10');
    });

    it('has empty schema (no options)', () => {
      expect(rule.meta.schema).toEqual([]);
    });
  });

  describe('ImportDeclaration', () => {
    it('reports import from "hono"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        source: { value: 'hono' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noHono');
    });

    it('reports import from "hono/middleware"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        source: { value: 'hono/middleware' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noHono');
    });

    it('reports import from "@hono/zod-validator"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        source: { value: '@hono/zod-validator' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noHono');
    });

    it('reports import from "hono/cors"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        source: { value: 'hono/cors' }
      };
      visitor.ImportDeclaration(node);

      expect(context._messages).toHaveLength(1);
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

    it('does not match partial name like "hono-like"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      // "hono-like" does not match ^hono$ or ^hono/
      const node = {
        source: { value: 'hono-like' }
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
    it('reports require("hono")', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ type: 'Literal', value: 'hono' }]
      };
      visitor.CallExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noHono');
    });

    it('reports require("@hono/node-server")', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = {
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ type: 'Literal', value: '@hono/node-server' }]
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
        arguments: [{ type: 'Literal', value: 'hono' }]
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
