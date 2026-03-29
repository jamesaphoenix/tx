/**
 * @fileoverview Tests for the no-supervision-sql-outside-core ESLint rule
 * Verifies INV-SUP-010: app-layer code does not own supervision SQL outside core repos.
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/no-supervision-sql-outside-core.js';

function createContext(filename, options = []) {
  const messages = [];
  return {
    filename,
    cwd: '/project',
    options,
    sourceCode: { getText: () => '' },
    report: (info) => messages.push(info),
    _messages: messages
  };
}

describe('no-supervision-sql-outside-core rule', () => {
  describe('meta', () => {
    it('has correct type', () => {
      expect(rule.meta.type).toBe('problem');
    });

    it('has messages defined', () => {
      expect(rule.meta.messages.noSupervisionSql).toContain('Supervision SQL must be in packages/core/src/repo/');
    });

    it('has schema for options', () => {
      expect(rule.meta.schema).toBeDefined();
      expect(rule.meta.schema[0].properties.allowedPaths).toBeDefined();
      expect(rule.meta.schema[0].properties.tablePatterns).toBeDefined();
    });
  });

  describe('allowed paths', () => {
    it('skips files in packages/core/src/repo/', () => {
      const context = createContext('/project/packages/core/src/repo/supervision-repo.ts');
      const visitor = rule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips files in migrations/', () => {
      const context = createContext('/project/migrations/044_worker_sessions.sql');
      const visitor = rule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips files in test/', () => {
      const context = createContext('/project/test/integration/supervision-service.test.ts');
      const visitor = rule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips files in __tests__/', () => {
      const context = createContext('/project/apps/dashboard/src/components/__tests__/Supervision.test.tsx');
      const visitor = rule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips non-TS/JS files', () => {
      const context = createContext('/project/apps/dashboard/server/schema.sql');
      const visitor = rule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('does not skip dashboard server files', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = rule.create(context);
      expect(visitor.Literal).toBeDefined();
      expect(visitor.TemplateLiteral).toBeDefined();
    });

    it('does not skip CLI files', () => {
      const context = createContext('/project/apps/cli/src/commands/supervision.ts');
      const visitor = rule.create(context);
      expect(visitor.Literal).toBeDefined();
    });

    it('does not skip scripts', () => {
      const context = createContext('/project/scripts/ralph.ts');
      const visitor = rule.create(context);
      expect(visitor.Literal).toBeDefined();
    });
  });

  describe('detection in disallowed paths', () => {
    it('detects worker_sessions in string literals in dashboard server', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = rule.create(context);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM worker_sessions WHERE ended_at IS NULL' });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noSupervisionSql');
      expect(context._messages[0].data.table).toBe('worker_sessions');
    });

    it('detects worker_sessions in template literals', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = rule.create(context);

      visitor.TemplateLiteral({
        type: 'TemplateLiteral',
        quasis: [
          { value: { raw: 'INSERT INTO worker_sessions ' } },
          { value: { raw: ' VALUES (?)' } }
        ]
      });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.table).toBe('worker_sessions');
    });

    it('detects worker_sessions in CLI files', () => {
      const context = createContext('/project/apps/cli/src/commands/supervision.ts');
      const visitor = rule.create(context);

      visitor.Literal({ type: 'Literal', value: 'FROM worker_sessions' });

      expect(context._messages).toHaveLength(1);
    });

    it('detects worker_sessions in scripts', () => {
      const context = createContext('/project/scripts/migrate.ts');
      const visitor = rule.create(context);

      visitor.Literal({ type: 'Literal', value: 'INSERT INTO worker_sessions' });

      expect(context._messages).toHaveLength(1);
    });

    it('is case-insensitive', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = rule.create(context);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM WORKER_SESSIONS' });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.table).toBe('worker_sessions');
    });
  });

  describe('non-matching strings pass', () => {
    it('allows non-SQL strings', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = rule.create(context);

      visitor.Literal({ type: 'Literal', value: 'Hello world' });

      expect(context._messages).toHaveLength(0);
    });

    it('allows SQL referencing other tables', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = rule.create(context);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM tasks WHERE id = ?' });

      expect(context._messages).toHaveLength(0);
    });

    it('allows worker_sessions references inside core repo', () => {
      const context = createContext('/project/packages/core/src/repo/supervision-repo.ts');
      const visitor = rule.create(context);

      // Visitor should be empty for allowed paths
      expect(Object.keys(visitor)).toHaveLength(0);
    });
  });

  describe('custom options', () => {
    it('respects custom allowedPaths', () => {
      const options = [{ allowedPaths: ['custom/path/'] }];
      const context = createContext('/project/custom/path/file.ts', options);
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('respects custom tablePatterns', () => {
      const options = [{ tablePatterns: ['custom_table'] }];
      const context = createContext('/project/apps/cli/src/file.ts', options);
      const visitor = rule.create(context);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM worker_sessions' });
      expect(context._messages).toHaveLength(0);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM custom_table' });
      expect(context._messages).toHaveLength(1);
    });
  });
});
