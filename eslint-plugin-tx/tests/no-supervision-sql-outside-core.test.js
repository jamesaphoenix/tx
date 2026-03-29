/**
 * @fileoverview Tests for no-supervision-sql-outside-core and no-domain-events-sql-outside-core ESLint rules
 * Verifies INV-SUP-010: app-layer code does not own supervision or review SQL outside core repos.
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/no-supervision-sql-outside-core.js';
import domainEventsRule from '../rules/no-domain-events-sql-outside-core.js';

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

describe('no-domain-events-sql-outside-core rule', () => {
  describe('meta', () => {
    it('has correct type', () => {
      expect(domainEventsRule.meta.type).toBe('problem');
    });

    it('has messages defined', () => {
      expect(domainEventsRule.meta.messages.noDomainEventsSql).toContain('Domain event/review SQL must be in packages/core/src/repo/');
    });

    it('has schema for options', () => {
      expect(domainEventsRule.meta.schema).toBeDefined();
      expect(domainEventsRule.meta.schema[0].properties.allowedPaths).toBeDefined();
      expect(domainEventsRule.meta.schema[0].properties.tablePatterns).toBeDefined();
    });
  });

  describe('allowed paths', () => {
    it('skips files in packages/core/src/repo/', () => {
      const context = createContext('/project/packages/core/src/repo/domain-event-repo.ts');
      const visitor = domainEventsRule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips files in migrations/', () => {
      const context = createContext('/project/migrations/043_domain_events.sql');
      const visitor = domainEventsRule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips files in test/', () => {
      const context = createContext('/project/test/integration/domain-event-service.test.ts');
      const visitor = domainEventsRule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips files in __tests__/', () => {
      const context = createContext('/project/apps/dashboard/src/components/__tests__/EventTimeline.test.tsx');
      const visitor = domainEventsRule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips non-TS/JS files', () => {
      const context = createContext('/project/apps/dashboard/server/schema.sql');
      const visitor = domainEventsRule.create(context);
      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('does not skip dashboard server files', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = domainEventsRule.create(context);
      expect(visitor.Literal).toBeDefined();
      expect(visitor.TemplateLiteral).toBeDefined();
    });

    it('does not skip CLI files', () => {
      const context = createContext('/project/apps/cli/src/commands/events.ts');
      const visitor = domainEventsRule.create(context);
      expect(visitor.Literal).toBeDefined();
    });

    it('does not skip scripts', () => {
      const context = createContext('/project/scripts/ralph.ts');
      const visitor = domainEventsRule.create(context);
      expect(visitor.Literal).toBeDefined();
    });
  });

  describe('detection of domain_events in disallowed paths', () => {
    it('detects domain_events in string literals in dashboard server', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = domainEventsRule.create(context);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM domain_events WHERE stream_id = ?' });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noDomainEventsSql');
      expect(context._messages[0].data.table).toBe('domain_events');
    });

    it('detects domain_events in template literals', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = domainEventsRule.create(context);

      visitor.TemplateLiteral({
        type: 'TemplateLiteral',
        quasis: [
          { value: { raw: 'INSERT INTO domain_events ' } },
          { value: { raw: ' VALUES (?)' } }
        ]
      });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.table).toBe('domain_events');
    });

    it('detects domain_events in CLI files', () => {
      const context = createContext('/project/apps/cli/src/commands/events.ts');
      const visitor = domainEventsRule.create(context);

      visitor.Literal({ type: 'Literal', value: 'FROM domain_events' });

      expect(context._messages).toHaveLength(1);
    });

    it('detects domain_events in scripts', () => {
      const context = createContext('/project/scripts/migrate.ts');
      const visitor = domainEventsRule.create(context);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM domain_events ORDER BY occurred_at' });

      expect(context._messages).toHaveLength(1);
    });

    it('is case-insensitive for domain_events', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = domainEventsRule.create(context);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM DOMAIN_EVENTS' });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.table).toBe('domain_events');
    });
  });

  describe('detection of doc_review_runs in disallowed paths', () => {
    it('detects doc_review_runs in string literals in dashboard server', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = domainEventsRule.create(context);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM doc_review_runs WHERE status = ?' });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noDomainEventsSql');
      expect(context._messages[0].data.table).toBe('doc_review_runs');
    });

    it('detects doc_review_runs in template literals', () => {
      const context = createContext('/project/apps/cli/src/commands/review.ts');
      const visitor = domainEventsRule.create(context);

      visitor.TemplateLiteral({
        type: 'TemplateLiteral',
        quasis: [
          { value: { raw: 'UPDATE doc_review_runs SET status = ' } },
          { value: { raw: '' } }
        ]
      });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.table).toBe('doc_review_runs');
    });

    it('detects doc_review_runs in scripts', () => {
      const context = createContext('/project/scripts/review-check.ts');
      const visitor = domainEventsRule.create(context);

      visitor.Literal({ type: 'Literal', value: 'INSERT INTO doc_review_runs' });

      expect(context._messages).toHaveLength(1);
    });

    it('is case-insensitive for doc_review_runs', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = domainEventsRule.create(context);

      visitor.Literal({ type: 'Literal', value: 'DELETE FROM DOC_REVIEW_RUNS WHERE id = ?' });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.table).toBe('doc_review_runs');
    });
  });

  describe('non-matching strings pass', () => {
    it('allows non-SQL strings', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = domainEventsRule.create(context);

      visitor.Literal({ type: 'Literal', value: 'Hello world' });

      expect(context._messages).toHaveLength(0);
    });

    it('allows SQL referencing other tables', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = domainEventsRule.create(context);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM tasks WHERE id = ?' });

      expect(context._messages).toHaveLength(0);
    });

    it('allows domain_events references inside core repo', () => {
      const context = createContext('/project/packages/core/src/repo/domain-event-repo.ts');
      const visitor = domainEventsRule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('allows doc_review_runs references inside core repo', () => {
      const context = createContext('/project/packages/core/src/repo/doc-review-repo.ts');
      const visitor = domainEventsRule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('does not flag worker_sessions (different rule)', () => {
      const context = createContext('/project/apps/dashboard/server/routes.ts');
      const visitor = domainEventsRule.create(context);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM worker_sessions' });

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('custom options', () => {
    it('respects custom allowedPaths', () => {
      const options = [{ allowedPaths: ['custom/path/'] }];
      const context = createContext('/project/custom/path/file.ts', options);
      const visitor = domainEventsRule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('respects custom tablePatterns', () => {
      const options = [{ tablePatterns: ['custom_events'] }];
      const context = createContext('/project/apps/cli/src/file.ts', options);
      const visitor = domainEventsRule.create(context);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM domain_events' });
      expect(context._messages).toHaveLength(0);

      visitor.Literal({ type: 'Literal', value: 'SELECT * FROM custom_events' });
      expect(context._messages).toHaveLength(1);
    });
  });
});
