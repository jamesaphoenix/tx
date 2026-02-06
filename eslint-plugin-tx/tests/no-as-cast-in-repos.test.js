/**
 * @fileoverview Tests for the no-as-cast-in-repos ESLint rule
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/no-as-cast-in-repos.js';

// Mock ESLint context with filename support
function createContext(options = [], filename = '') {
  const messages = [];
  return {
    report: (info) => messages.push(info),
    options,
    filename,
    getFilename: () => filename,
    _messages: messages
  };
}

describe('no-as-cast-in-repos rule', () => {
  describe('meta', () => {
    it('has correct type', () => {
      expect(rule.meta.type).toBe('suggestion');
    });

    it('has messages defined', () => {
      expect(rule.meta.messages.noAsCast).toContain('runtime validation');
      expect(rule.meta.messages.noAsCast).toContain('Schema.decode');
    });

    it('has schema with options', () => {
      expect(rule.meta.schema).toHaveLength(1);
      expect(rule.meta.schema[0].type).toBe('object');
      expect(rule.meta.schema[0].properties).toHaveProperty('enforcePaths');
      expect(rule.meta.schema[0].properties).toHaveProperty('allowedTypes');
    });
  });

  describe('file path filtering', () => {
    it('returns empty visitor for files outside repo/ and mappers/', () => {
      const context = createContext([], 'packages/core/src/services/task-service.ts');
      const visitor = rule.create(context);

      // Should have no TSAsExpression visitor
      expect(visitor.TSAsExpression).toBeUndefined();
    });

    it('returns visitor for files in repo/', () => {
      const context = createContext([], 'packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      expect(visitor.TSAsExpression).toBeDefined();
    });

    it('returns visitor for files in mappers/', () => {
      const context = createContext([], 'packages/core/src/mappers/task.ts');
      const visitor = rule.create(context);

      expect(visitor.TSAsExpression).toBeDefined();
    });

    it('normalizes Windows backslash paths', () => {
      const context = createContext([], 'packages\\core\\src\\repo\\task-repo.ts');
      const visitor = rule.create(context);

      expect(visitor.TSAsExpression).toBeDefined();
    });

    it('respects custom enforcePaths', () => {
      const context = createContext(
        [{ enforcePaths: ['services/'] }],
        'packages/core/src/services/task-service.ts'
      );
      const visitor = rule.create(context);

      expect(visitor.TSAsExpression).toBeDefined();
    });
  });

  describe('TSAsExpression - reports unsafe casts', () => {
    it('reports "as TaskRow"', () => {
      const context = createContext([], 'packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: { name: 'TaskRow' }
        }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('noAsCast');
      expect(context._messages[0].data.typeName).toBe('TaskRow');
    });

    it('reports "as TaskId"', () => {
      const context = createContext([], 'packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: { name: 'TaskId' }
        }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.typeName).toBe('TaskId');
    });

    it('reports "as RunStatus"', () => {
      const context = createContext([], 'packages/core/src/repo/run-repo.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: { name: 'RunStatus' }
        }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.typeName).toBe('RunStatus');
    });

    it('reports union type "as TaskRow | undefined"', () => {
      const context = createContext([], 'packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: {
          type: 'TSUnionType',
          types: [
            { type: 'TSTypeReference', typeName: { name: 'TaskRow' } },
            { type: 'TSUndefinedKeyword' }
          ]
        }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.typeName).toBe('TaskRow | undefined');
    });

    it('reports generic type "as Map<string, number>"', () => {
      const context = createContext([], 'packages/core/src/repo/edge-repo.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: { name: 'Map' },
          typeArguments: {
            params: [
              { type: 'TSStringKeyword' },
              { type: 'TSNumberKeyword' }
            ]
          }
        }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.typeName).toBe('Map<string, number>');
    });

    it('reports array type "as string[]"', () => {
      const context = createContext([], 'packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: {
          type: 'TSArrayType',
          elementType: { type: 'TSStringKeyword' }
        }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.typeName).toBe('string[]');
    });

    it('reports qualified name "as Attempt[\"id\"]"', () => {
      const context = createContext([], 'packages/core/src/mappers/attempt.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: {
            type: 'TSQualifiedName',
            left: { name: 'Attempt' },
            right: { name: 'id' }
          }
        }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.typeName).toBe('Attempt.id');
    });

    it('reports "as any"', () => {
      const context = createContext([], 'packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: { type: 'TSAnyKeyword' }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.typeName).toBe('any');
    });

    it('reports casts in mappers/ directory', () => {
      const context = createContext([], 'packages/core/src/mappers/learning.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: { name: 'FileLearningId' }
        }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.typeName).toBe('FileLearningId');
    });
  });

  describe('TSAsExpression - allows safe casts', () => {
    it('allows "as const"', () => {
      const context = createContext([], 'packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: { name: 'const' }
        }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(0);
    });

    it('allows "as unknown" by default', () => {
      const context = createContext([], 'packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: { type: 'TSUnknownKeyword' }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(0);
    });

    it('does not report in non-matching files', () => {
      const context = createContext([], 'packages/core/src/services/task-service.ts');
      const visitor = rule.create(context);

      // No visitor returned for non-matching files
      expect(visitor.TSAsExpression).toBeUndefined();
    });
  });

  describe('custom options', () => {
    it('respects custom allowedTypes', () => {
      const context = createContext(
        [{ allowedTypes: ['string'] }],
        'packages/core/src/repo/task-repo.ts'
      );
      const visitor = rule.create(context);

      // 'as string' is allowed with custom config
      visitor.TSAsExpression({
        typeAnnotation: { type: 'TSStringKeyword' }
      });
      expect(context._messages).toHaveLength(0);

      // 'as unknown' is NOT allowed (not in custom list)
      visitor.TSAsExpression({
        typeAnnotation: { type: 'TSUnknownKeyword' }
      });
      expect(context._messages).toHaveLength(1);
    });

    it('"as const" is always allowed regardless of allowedTypes', () => {
      const context = createContext(
        [{ allowedTypes: [] }],
        'packages/core/src/repo/task-repo.ts'
      );
      const visitor = rule.create(context);

      visitor.TSAsExpression({
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: { name: 'const' }
        }
      });
      expect(context._messages).toHaveLength(0);
    });

    it('respects custom enforcePaths', () => {
      // Default paths don't include services/
      const ctx1 = createContext([], 'packages/core/src/services/foo.ts');
      const visitor1 = rule.create(ctx1);
      expect(visitor1.TSAsExpression).toBeUndefined();

      // Custom paths include services/
      const ctx2 = createContext(
        [{ enforcePaths: ['services/'] }],
        'packages/core/src/services/foo.ts'
      );
      const visitor2 = rule.create(ctx2);
      expect(visitor2.TSAsExpression).toBeDefined();
    });
  });

  describe('type name extraction', () => {
    it('handles missing typeAnnotation gracefully', () => {
      const context = createContext([], 'packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      // Node with null typeAnnotation - isAllowedCast returns false, getTypeName handles null
      visitor.TSAsExpression({ typeAnnotation: null });
      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.typeName).toBe('type');
    });

    it('extracts generic type with typeParameters (legacy field)', () => {
      const context = createContext([], 'packages/core/src/repo/edge-repo.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: { name: 'ReadonlyMap' },
          typeParameters: {
            params: [
              { type: 'TSTypeReference', typeName: { name: 'EdgeType' } },
              { type: 'TSNumberKeyword' }
            ]
          }
        }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.typeName).toBe('ReadonlyMap<EdgeType, number>');
    });

    it('extracts intersection type "A & B"', () => {
      const context = createContext([], 'packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: {
          type: 'TSIntersectionType',
          types: [
            { type: 'TSTypeReference', typeName: { name: 'TaskRow' } },
            { type: 'TSTypeReference', typeName: { name: 'Extra' } }
          ]
        }
      };
      visitor.TSAsExpression(node);

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.typeName).toBe('TaskRow & Extra');
    });
  });

  describe('message content', () => {
    it('includes the type name in the message data', () => {
      const context = createContext([], 'packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      visitor.TSAsExpression({
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: { name: 'ClaimRow' }
        }
      });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data).toEqual({ typeName: 'ClaimRow' });
    });

    it('reports the full node for positioning', () => {
      const context = createContext([], 'packages/core/src/repo/task-repo.ts');
      const visitor = rule.create(context);

      const node = {
        typeAnnotation: {
          type: 'TSTypeReference',
          typeName: { name: 'TaskRow' }
        },
        loc: { start: { line: 39 } }
      };
      visitor.TSAsExpression(node);

      expect(context._messages[0].node).toBe(node);
    });
  });
});
