/**
 * @fileoverview Tests for the no-inline-sql ESLint rule
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/no-inline-sql.js';

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

describe('no-inline-sql rule', () => {
  describe('meta', () => {
    it('has correct type', () => {
      expect(rule.meta.type).toBe('problem');
    });

    it('has messages defined', () => {
      expect(rule.meta.messages.noInlineSql).toContain('SQL schema definitions must be in migrations/');
    });

    it('has schema for options', () => {
      expect(rule.meta.schema).toBeDefined();
      expect(rule.meta.schema[0].properties.allowedPaths).toBeDefined();
      expect(rule.meta.schema[0].properties.ddlKeywords).toBeDefined();
    });
  });

  describe('allowed paths', () => {
    it('skips files in migrations/', () => {
      const context = createContext('/project/migrations/001_init.ts');
      const visitor = rule.create(context);

      // Should return empty object (no visitors) for allowed paths
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips files in test/fixtures/', () => {
      const context = createContext('/project/test/fixtures/setup.ts');
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('does not skip regular src files', () => {
      const context = createContext('/project/src/services/task-service.ts');
      const visitor = rule.create(context);

      // Should have visitors for Literal and TemplateLiteral
      expect(visitor.Literal).toBeDefined();
      expect(visitor.TemplateLiteral).toBeDefined();
    });

    it('skips .sql files', () => {
      const context = createContext('/project/src/schema.sql');
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });
  });

  describe('DDL detection', () => {
    it('detects CREATE TABLE in string literals', () => {
      const context = createContext('/project/src/db.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'Literal',
        value: 'CREATE TABLE tasks (id TEXT PRIMARY KEY)'
      };
      visitor.Literal(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noInlineSql');
      expect(context._messages[0].data.keyword).toBe('CREATE TABLE');
    });

    it('detects CREATE INDEX', () => {
      const context = createContext('/project/src/db.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'Literal',
        value: 'CREATE INDEX idx_tasks_status ON tasks(status)'
      };
      visitor.Literal(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.keyword).toBe('CREATE INDEX');
    });

    it('detects ALTER TABLE', () => {
      const context = createContext('/project/src/db.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'Literal',
        value: 'ALTER TABLE tasks ADD COLUMN score INTEGER'
      };
      visitor.Literal(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.keyword).toBe('ALTER TABLE');
    });

    it('detects DROP TABLE', () => {
      const context = createContext('/project/src/db.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'Literal',
        value: 'DROP TABLE tasks'
      };
      visitor.Literal(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.keyword).toBe('DROP TABLE');
    });

    it('detects DDL in template literals', () => {
      const context = createContext('/project/src/db.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'TemplateLiteral',
        quasis: [
          { value: { raw: 'CREATE TABLE ' } },
          { value: { raw: ' (id TEXT)' } }
        ]
      };
      visitor.TemplateLiteral(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.keyword).toBe('CREATE TABLE');
    });

    it('is case-insensitive', () => {
      const context = createContext('/project/src/db.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'Literal',
        value: 'create table tasks (id text)'
      };
      visitor.Literal(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.keyword).toBe('CREATE TABLE');
    });
  });

  describe('allowed queries', () => {
    it('allows SELECT statements', () => {
      const context = createContext('/project/src/repo.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'Literal',
        value: 'SELECT * FROM tasks WHERE status = ?'
      };
      visitor.Literal(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows INSERT statements', () => {
      const context = createContext('/project/src/repo.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'Literal',
        value: 'INSERT INTO tasks (id, title) VALUES (?, ?)'
      };
      visitor.Literal(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows UPDATE statements', () => {
      const context = createContext('/project/src/repo.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'Literal',
        value: 'UPDATE tasks SET status = ? WHERE id = ?'
      };
      visitor.Literal(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows DELETE statements', () => {
      const context = createContext('/project/src/repo.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'Literal',
        value: 'DELETE FROM tasks WHERE id = ?'
      };
      visitor.Literal(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows non-SQL strings', () => {
      const context = createContext('/project/src/utils.ts');
      const visitor = rule.create(context);

      const node = {
        type: 'Literal',
        value: 'This is just a regular string'
      };
      visitor.Literal(node);

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('custom options', () => {
    it('respects custom allowedPaths', () => {
      const options = [{ allowedPaths: ['schema/'] }];
      const context = createContext('/project/schema/init.ts', options);
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('respects custom ddlKeywords', () => {
      const options = [{ ddlKeywords: ['TRUNCATE'] }];
      const context = createContext('/project/src/db.ts', options);
      const visitor = rule.create(context);

      // Should not detect CREATE TABLE with custom keywords
      const node1 = {
        type: 'Literal',
        value: 'CREATE TABLE tasks (id TEXT)'
      };
      visitor.Literal(node1);
      expect(context._messages).toHaveLength(0);

      // Should detect TRUNCATE
      const node2 = {
        type: 'Literal',
        value: 'TRUNCATE tasks'
      };
      visitor.Literal(node2);
      expect(context._messages).toHaveLength(1);
    });
  });
});
