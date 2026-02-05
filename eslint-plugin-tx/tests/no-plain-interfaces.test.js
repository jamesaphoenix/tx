/**
 * @fileoverview Tests for the no-plain-interfaces ESLint rule
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/no-plain-interfaces.js';

// Mock ESLint context
function createContext(options = []) {
  const messages = [];
  return {
    report: (info) => messages.push(info),
    options,
    _messages: messages
  };
}

describe('no-plain-interfaces rule', () => {
  describe('meta', () => {
    it('has correct type', () => {
      expect(rule.meta.type).toBe('suggestion');
    });

    it('has messages defined', () => {
      expect(rule.meta.messages.noPlainInterface).toContain('Effect Schema');
      expect(rule.meta.messages.noPlainInterface).toContain('DOCTRINE RULE 10');
    });

    it('has schema with options', () => {
      expect(rule.meta.schema).toHaveLength(1);
      expect(rule.meta.schema[0].type).toBe('object');
      expect(rule.meta.schema[0].properties).toHaveProperty('excludedNames');
      expect(rule.meta.schema[0].properties).toHaveProperty('excludedSuffixes');
    });
  });

  describe('TSInterfaceDeclaration', () => {
    it('reports plain interface "Task"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = { id: { name: 'Task' } };
      visitor.TSInterfaceDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noPlainInterface');
      expect(context._messages[0].data.name).toBe('Task');
    });

    it('reports plain interface "Learning"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = { id: { name: 'Learning' } };
      visitor.TSInterfaceDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noPlainInterface');
    });

    it('reports plain interface "TaskWithDeps"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = { id: { name: 'TaskWithDeps' } };
      visitor.TSInterfaceDeclaration(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.name).toBe('TaskWithDeps');
    });

    it('reports plain interface "Anchor"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = { id: { name: 'Anchor' } };
      visitor.TSInterfaceDeclaration(node);

      expect(context._messages).toHaveLength(1);
    });

    it('allows database row type "TaskRow"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = { id: { name: 'TaskRow' } };
      visitor.TSInterfaceDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows database row type "LearningRow"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = { id: { name: 'LearningRow' } };
      visitor.TSInterfaceDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows extended row type "LearningRowWithBM25"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = { id: { name: 'LearningRowWithBM25' } };
      visitor.TSInterfaceDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows database row type "EdgeRow"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = { id: { name: 'EdgeRow' } };
      visitor.TSInterfaceDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows response envelope "ListResponse"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = { id: { name: 'ListResponse' } };
      visitor.TSInterfaceDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows response envelope "PaginatedResponse"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = { id: { name: 'PaginatedResponse' } };
      visitor.TSInterfaceDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows response envelope "ActionResponse"', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = { id: { name: 'ActionResponse' } };
      visitor.TSInterfaceDeclaration(node);

      expect(context._messages).toHaveLength(0);
    });

    it('handles node with no id gracefully', () => {
      const context = createContext();
      const visitor = rule.create(context);

      visitor.TSInterfaceDeclaration({ id: null });
      visitor.TSInterfaceDeclaration({});

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('custom options', () => {
    it('respects custom excludedNames', () => {
      const context = createContext([{
        excludedNames: ['MySpecialType'],
        excludedSuffixes: ['Row']
      }]);
      const visitor = rule.create(context);

      // MySpecialType is excluded
      visitor.TSInterfaceDeclaration({ id: { name: 'MySpecialType' } });
      expect(context._messages).toHaveLength(0);

      // ListResponse is NOT excluded (custom list doesn't include it)
      visitor.TSInterfaceDeclaration({ id: { name: 'ListResponse' } });
      expect(context._messages).toHaveLength(1);
    });

    it('respects custom excludedSuffixes', () => {
      const context = createContext([{
        excludedNames: [],
        excludedSuffixes: ['DTO']
      }]);
      const visitor = rule.create(context);

      // TaskDTO is excluded
      visitor.TSInterfaceDeclaration({ id: { name: 'TaskDTO' } });
      expect(context._messages).toHaveLength(0);

      // TaskRow is NOT excluded (custom suffixes don't include Row)
      visitor.TSInterfaceDeclaration({ id: { name: 'TaskRow' } });
      expect(context._messages).toHaveLength(1);
    });

    it('uses defaults when no options provided', () => {
      const context = createContext();
      const visitor = rule.create(context);

      // Default excludedSuffixes includes Row
      visitor.TSInterfaceDeclaration({ id: { name: 'TaskRow' } });
      expect(context._messages).toHaveLength(0);

      // Default excludedNames includes ListResponse
      visitor.TSInterfaceDeclaration({ id: { name: 'ListResponse' } });
      expect(context._messages).toHaveLength(0);
    });
  });

  describe('message content', () => {
    it('includes the interface name in the message data', () => {
      const context = createContext();
      const visitor = rule.create(context);

      visitor.TSInterfaceDeclaration({ id: { name: 'Candidate' } });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data).toEqual({ name: 'Candidate' });
    });

    it('reports the full node for positioning', () => {
      const context = createContext();
      const visitor = rule.create(context);

      const node = { id: { name: 'Run' }, loc: { start: { line: 5 } } };
      visitor.TSInterfaceDeclaration(node);

      expect(context._messages[0].node).toBe(node);
    });
  });
});
