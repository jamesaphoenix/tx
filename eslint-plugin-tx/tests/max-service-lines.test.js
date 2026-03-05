/**
 * @fileoverview Tests for max-service-lines ESLint rule
 */

import { describe, it, expect } from 'vitest';
import rule from '../rules/max-service-lines.js';

function makeCodeLines(count) {
  return Array.from({ length: count }, (_, i) => `const line_${i} = ${i};`).join('\n');
}

function createContext(filename, sourceText, options = []) {
  const messages = [];
  return {
    filename,
    cwd: '/project',
    options,
    sourceCode: {
      lines: sourceText.split(/\r?\n/)
    },
    report: (info) => messages.push(info),
    _messages: messages
  };
}

describe('max-service-lines rule', () => {
  it('does not report files under warn threshold', () => {
    const source = makeCodeLines(500);
    const context = createContext('/project/packages/core/src/services/small-service.ts', source);
    const visitor = rule.create(context);

    visitor.Program({ type: 'Program' });

    expect(context._messages).toHaveLength(0);
  });

  it('reports warn threshold breach at 501 lines', () => {
    const source = makeCodeLines(501);
    const context = createContext('/project/packages/core/src/services/medium-service.ts', source);
    const visitor = rule.create(context);

    visitor.Program({ type: 'Program' });

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].messageId).toBe('warnLimit');
    expect(context._messages[0].data).toEqual({ lineCount: '501', limit: '500' });
  });

  it('reports error threshold breach at 1001 lines', () => {
    const source = makeCodeLines(1001);
    const context = createContext('/project/packages/core/src/services/huge-service.ts', source);
    const visitor = rule.create(context);

    visitor.Program({ type: 'Program' });

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].messageId).toBe('errorLimit');
    expect(context._messages[0].data).toEqual({ lineCount: '1001', limit: '1000' });
  });

  it('supports custom thresholds', () => {
    const source = makeCodeLines(21);
    const context = createContext(
      '/project/packages/core/src/repo/custom-repo.ts',
      source,
      [{ warnAt: 10, errorAt: 20 }]
    );
    const visitor = rule.create(context);

    visitor.Program({ type: 'Program' });

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].messageId).toBe('errorLimit');
    expect(context._messages[0].data).toEqual({ lineCount: '21', limit: '20' });
  });

  it('does not report when file path is outside configured paths', () => {
    const source = makeCodeLines(1500);
    const context = createContext('/project/apps/cli/src/commands/spec.ts', source);
    const visitor = rule.create(context);
    expect(visitor.Program).toBeUndefined();
    expect(context._messages).toHaveLength(0);
  });

  it('does not report nested service internals', () => {
    const source = makeCodeLines(1500);
    const context = createContext('/project/packages/core/src/services/task-service/internals.ts', source);
    const visitor = rule.create(context);

    expect(visitor.Program).toBeUndefined();
    expect(context._messages).toHaveLength(0);
  });

  it('does not report nested repo internals', () => {
    const source = makeCodeLines(1500);
    const context = createContext('/project/packages/core/src/repo/task-repo/read.ts', source);
    const visitor = rule.create(context);

    expect(visitor.Program).toBeUndefined();
    expect(context._messages).toHaveLength(0);
  });

  it('does not report top-level index files', () => {
    const source = makeCodeLines(1500);
    const context = createContext('/project/packages/core/src/services/index.ts', source);
    const visitor = rule.create(context);

    expect(visitor.Program).toBeUndefined();
    expect(context._messages).toHaveLength(0);
  });

  it('normalizes inverted thresholds to avoid inconsistent reporting', () => {
    const source = makeCodeLines(950);
    const context = createContext(
      '/project/packages/core/src/services/inverted-thresholds.ts',
      source,
      [{ warnAt: 1000, errorAt: 900 }]
    );
    const visitor = rule.create(context);

    visitor.Program({ type: 'Program' });

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].messageId).toBe('warnLimit');
    expect(context._messages[0].data).toEqual({ lineCount: '950', limit: '900' });
  });
});
