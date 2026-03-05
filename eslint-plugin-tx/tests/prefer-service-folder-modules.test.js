/**
 * @fileoverview Tests for prefer-service-folder-modules ESLint rule
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import rule from '../rules/prefer-service-folder-modules.js';

function createContext(filename, options = []) {
  const messages = [];
  return {
    getFilename: () => filename,
    options,
    report: (info) => messages.push(info),
    _messages: messages
  };
}

const cleanupDirs = [];

function setupFixture(files) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eslint-service-folders-'));
  cleanupDirs.push(tempDir);
  fs.writeFileSync(path.join(tempDir, 'turbo.json'), '{}');

  for (const relPath of files) {
    const absolutePath = path.join(tempDir, relPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, 'export {}\n');
  }

  return tempDir;
}

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('prefer-service-folder-modules rule', () => {
  it('reports top-level sidecars owned by a public entrypoint', () => {
    const tempDir = setupFixture([
      'packages/core/src/services/task-service.ts',
      'packages/core/src/services/task-service-internals.ts'
    ]);
    const filename = path.join(tempDir, 'packages/core/src/services/task-service-internals.ts');
    const context = createContext(filename);
    const visitor = rule.create(context);

    visitor.Program({ type: 'Program' });

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].messageId).toBe('preferFolder');
    expect(context._messages[0].data).toEqual({
      fileName: 'task-service-internals.ts',
      ownerFolder: 'task-service',
      ownerFile: 'task-service.ts'
    });
  });

  it('resolves service owners from a shared stem', () => {
    const tempDir = setupFixture([
      'packages/core/src/services/daemon-service.ts',
      'packages/core/src/services/daemon-process.ts'
    ]);
    const filename = path.join(tempDir, 'packages/core/src/services/daemon-process.ts');
    const context = createContext(filename);
    const visitor = rule.create(context);

    visitor.Program({ type: 'Program' });

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].data.ownerFolder).toBe('daemon-service');
    expect(context._messages[0].data.ownerFile).toBe('daemon-service.ts');
  });

  it('does not report nested service modules that are already grouped', () => {
    const tempDir = setupFixture([
      'packages/core/src/services/daemon-service.ts',
      'packages/core/src/services/daemon-service/process.ts'
    ]);
    const filename = path.join(tempDir, 'packages/core/src/services/daemon-service/process.ts');
    const context = createContext(filename);
    const visitor = rule.create(context);

    expect(visitor.Program).toBeUndefined();
    expect(context._messages).toHaveLength(0);
  });

  it('does not report public sibling entrypoints that are not sidecars', () => {
    const tempDir = setupFixture([
      'packages/core/src/services/anchor-service.ts',
      'packages/core/src/services/anchor-verification.ts'
    ]);
    const filename = path.join(tempDir, 'packages/core/src/services/anchor-verification.ts');
    const context = createContext(filename);
    const visitor = rule.create(context);

    expect(visitor.Program).toBeUndefined();
    expect(context._messages).toHaveLength(0);
  });

  it('reports service-owned pattern modules', () => {
    const tempDir = setupFixture([
      'packages/core/src/services/ast-grep-service.ts',
      'packages/core/src/services/ast-grep-patterns.ts'
    ]);
    const filename = path.join(tempDir, 'packages/core/src/services/ast-grep-patterns.ts');
    const context = createContext(filename);
    const visitor = rule.create(context);

    visitor.Program({ type: 'Program' });

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].data.ownerFolder).toBe('ast-grep-service');
  });

  it('does not report public entrypoints re-exported from services/index.ts', () => {
    const tempDir = setupFixture([
      'packages/core/src/services/index.ts',
      'packages/core/src/services/worker-service.ts',
      'packages/core/src/services/worker-process.ts'
    ]);
    const indexFile = path.join(tempDir, 'packages/core/src/services/index.ts');
    fs.writeFileSync(indexFile, 'export { runWorkerProcess } from "./worker-process.js"\\n');

    const filename = path.join(tempDir, 'packages/core/src/services/worker-process.ts');
    const context = createContext(filename);
    const visitor = rule.create(context);

    expect(visitor.Program).toBeUndefined();
    expect(context._messages).toHaveLength(0);
  });

  it('does not report public entrypoints re-exported from services/index.js', () => {
    const tempDir = setupFixture([
      'packages/core/src/services/index.js',
      'packages/core/src/services/worker-service.ts',
      'packages/core/src/services/worker-process.ts'
    ]);
    const indexFile = path.join(tempDir, 'packages/core/src/services/index.js');
    fs.writeFileSync(indexFile, 'export { runWorkerProcess } from "./worker-process.js"\\n');

    const filename = path.join(tempDir, 'packages/core/src/services/worker-process.ts');
    const context = createContext(filename);
    const visitor = rule.create(context);

    expect(visitor.Program).toBeUndefined();
    expect(context._messages).toHaveLength(0);
  });
});
