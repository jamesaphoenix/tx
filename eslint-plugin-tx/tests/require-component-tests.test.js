/**
 * @fileoverview Tests for the require-component-tests ESLint rule
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import rule from '../rules/require-component-tests.js';

// Create a temporary directory structure for testing
let tempDir;

function createContext(filename, options = []) {
  const messages = [];
  return {
    filename,
    cwd: tempDir,
    options,
    sourceCode: {
      getText: () => ''
    },
    report: (info) => messages.push(info),
    _messages: messages
  };
}

function createFile(relPath, content = '') {
  const fullPath = path.join(tempDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

describe('require-component-tests rule', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eslint-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('meta', () => {
    it('has correct type', () => {
      expect(rule.meta.type).toBe('problem');
    });

    it('has messages defined', () => {
      expect(rule.meta.messages.missingTestFile).toBeDefined();
      expect(rule.meta.messages.missingTestDir).toBeDefined();
    });

    it('has schema for options', () => {
      expect(rule.meta.schema).toBeDefined();
      expect(rule.meta.schema[0].properties.components).toBeDefined();
      expect(rule.meta.schema[0].properties.hooks).toBeDefined();
      expect(rule.meta.schema[0].properties.services).toBeDefined();
    });
  });

  describe('pattern matching', () => {
    it('matches component files in src/components/', () => {
      const sourcePath = createFile('src/components/Button.tsx', 'export const Button = () => {};');
      const context = createContext(sourcePath);
      const visitor = rule.create(context);

      // Should have Program visitor (file matches pattern)
      expect(visitor.Program).toBeDefined();
    });

    it('matches hook files in src/hooks/', () => {
      const sourcePath = createFile('src/hooks/useAuth.ts', 'export const useAuth = () => {};');
      const context = createContext(sourcePath);
      const visitor = rule.create(context);

      expect(visitor.Program).toBeDefined();
    });

    it('matches service files in src/services/', () => {
      const sourcePath = createFile('src/services/auth-service.ts', 'export const AuthService = {};');
      const context = createContext(sourcePath);
      const visitor = rule.create(context);

      expect(visitor.Program).toBeDefined();
    });

    it('skips files that do not match any pattern', () => {
      const sourcePath = createFile('src/utils/helpers.ts', 'export const helper = () => {};');
      const context = createContext(sourcePath);
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips test files themselves', () => {
      const sourcePath = createFile('src/components/__tests__/Button.test.tsx', '');
      const context = createContext(sourcePath);
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips index files', () => {
      const sourcePath = createFile('src/components/index.tsx', 'export * from "./Button";');
      const context = createContext(sourcePath);
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });

    it('skips type definition files', () => {
      const sourcePath = createFile('src/components/Button.d.ts', 'export type ButtonProps = {};');
      const context = createContext(sourcePath);
      const visitor = rule.create(context);

      expect(Object.keys(visitor)).toHaveLength(0);
    });
  });

  describe('component tests with __tests__ directory', () => {
    it('reports missing test file when __tests__ exists but test file does not', () => {
      const sourcePath = createFile('src/components/Button.tsx', 'export const Button = () => {};');
      createFile('src/components/__tests__/.gitkeep', '');

      const context = createContext(sourcePath);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('missingTestFile');
      expect(context._messages[0].data.sourceFile).toBe('src/components/Button.tsx');
    });

    it('reports missing __tests__ directory', () => {
      const sourcePath = createFile('src/components/Button.tsx', 'export const Button = () => {};');

      const context = createContext(sourcePath);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('missingTestDir');
      expect(context._messages[0].data.component).toBe('src/components/Button.tsx');
    });

    it('passes when test file exists in __tests__ directory', () => {
      const sourcePath = createFile('src/components/Button.tsx', 'export const Button = () => {};');
      createFile('src/components/__tests__/Button.test.tsx', 'describe("Button", () => {});');

      const context = createContext(sourcePath);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(0);
    });

    it('accepts .spec.tsx as alternative test suffix', () => {
      const sourcePath = createFile('src/components/Card.tsx', 'export const Card = () => {};');
      createFile('src/components/__tests__/Card.spec.tsx', 'describe("Card", () => {});');

      const context = createContext(sourcePath);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(0);
    });
  });

  describe('hook tests with __tests__ directory', () => {
    it('passes when hook test file exists', () => {
      const sourcePath = createFile('src/hooks/useAuth.ts', 'export const useAuth = () => {};');
      createFile('src/hooks/__tests__/useAuth.test.ts', 'describe("useAuth", () => {});');

      const context = createContext(sourcePath);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(0);
    });

    it('reports missing hook test file', () => {
      const sourcePath = createFile('src/hooks/useTheme.ts', 'export const useTheme = () => {};');
      createFile('src/hooks/__tests__/.gitkeep', '');

      const context = createContext(sourcePath);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.sourceFile).toBe('src/hooks/useTheme.ts');
    });
  });

  describe('service tests with integration test directory', () => {
    it('passes when integration test exists for service', () => {
      const sourcePath = createFile('src/services/auth-service.ts', 'export const AuthService = {};');
      createFile('test/integration/auth.test.ts', `
        import { AuthService } from '../../src/services/auth-service';
        describe('AuthService', () => {});
      `);

      const context = createContext(sourcePath);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(0);
    });

    it('passes when test file imports service by module name', () => {
      const sourcePath = createFile('src/services/task-service.ts', 'export const TaskService = {};');
      createFile('test/integration/tasks.test.ts', `
        import { TaskService } from '../../src/services/task-service';
        describe('task operations', () => {});
      `);

      const context = createContext(sourcePath);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(0);
    });

    it('reports missing integration test for service', () => {
      const sourcePath = createFile('src/services/email-service.ts', 'export const EmailService = {};');
      createFile('test/integration/.gitkeep', '');

      const context = createContext(sourcePath);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].messageId).toBe('missingTestFile');
    });
  });

  describe('nested component directories', () => {
    it('handles deeply nested components', () => {
      const sourcePath = createFile('src/components/forms/inputs/TextField.tsx', 'export const TextField = () => {};');
      createFile('src/components/forms/inputs/__tests__/TextField.test.tsx', 'describe("TextField", () => {});');

      const context = createContext(sourcePath);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(0);
    });

    it('reports missing test for nested component', () => {
      const sourcePath = createFile('src/components/layout/Header.tsx', 'export const Header = () => {};');
      createFile('src/components/layout/__tests__/.gitkeep', '');

      const context = createContext(sourcePath);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(1);
      expect(context._messages[0].data.sourceFile).toBe('src/components/layout/Header.tsx');
    });
  });

  describe('custom configuration', () => {
    it('respects custom pattern for components', () => {
      const options = [{
        components: {
          pattern: 'app/components/**/*.tsx',
          testDir: '__tests__',
          testSuffix: '.test.tsx'
        }
      }];

      // File in custom location
      const sourcePath = createFile('app/components/Button.tsx', 'export const Button = () => {};');

      const context = createContext(sourcePath, options);
      const visitor = rule.create(context);

      expect(visitor.Program).toBeDefined();
    });

    it('respects custom testDir', () => {
      const options = [{
        components: {
          pattern: 'src/components/**/*.tsx',
          testDir: 'tests',
          testSuffix: '.test.tsx'
        }
      }];

      const sourcePath = createFile('src/components/Button.tsx', 'export const Button = () => {};');
      createFile('tests/Button.test.tsx', 'describe("Button", () => {});');

      const context = createContext(sourcePath, options);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(0);
    });

    it('allows custom categories', () => {
      const options = [{
        widgets: {
          pattern: 'src/widgets/**/*.tsx',
          testDir: '__tests__',
          testSuffix: '.test.tsx'
        }
      }];

      const sourcePath = createFile('src/widgets/Clock.tsx', 'export const Clock = () => {};');
      createFile('src/widgets/__tests__/Clock.test.tsx', 'describe("Clock", () => {});');

      const context = createContext(sourcePath, options);
      const visitor = rule.create(context);
      visitor.Program({ type: 'Program' });

      expect(context._messages).toHaveLength(0);
    });
  });
});
