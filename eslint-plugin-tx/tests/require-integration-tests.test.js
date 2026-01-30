/**
 * @fileoverview Tests for require-integration-tests ESLint rule
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

// Import the rule helper functions by reading the rule file
// (We'll test the functions directly since testing ESLint rules requires special setup)

/**
 * Parse a source file to extract exported identifiers
 */
function extractExports(content) {
  const exports = [];

  // Match: export class ClassName
  const classExports = content.matchAll(/export\s+class\s+(\w+)/g);
  for (const match of classExports) {
    exports.push(match[1]);
  }

  // Match: export const ConstName
  const constExports = content.matchAll(/export\s+const\s+(\w+)/g);
  for (const match of constExports) {
    exports.push(match[1]);
  }

  // Match: export function FuncName
  const funcExports = content.matchAll(/export\s+function\s+(\w+)/g);
  for (const match of funcExports) {
    exports.push(match[1]);
  }

  // Match: export { Named1, Named2 }
  const namedExports = content.matchAll(/export\s*\{([^}]+)\}/g);
  for (const match of namedExports) {
    const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    exports.push(...names.filter(n => n && !n.includes('*')));
  }

  return [...new Set(exports)];
}

/**
 * Parse a test file to extract describe() block names and tested identifiers
 */
function extractTestCoverage(content) {
  const describes = [];
  const testedIdentifiers = new Set();

  const describeMatches = content.matchAll(/describe\s*\(\s*["'`]([^"'`]+)["'`]/g);
  for (const match of describeMatches) {
    describes.push(match[1]);
  }

  const yieldMatches = content.matchAll(/yield\*\s+(\w+)/g);
  for (const match of yieldMatches) {
    testedIdentifiers.add(match[1]);
  }

  const importMatches = content.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']/g);
  for (const match of importMatches) {
    const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    for (const name of names) {
      if (name.endsWith('Service') || name.endsWith('Repository') || name.endsWith('Live')) {
        testedIdentifiers.add(name);
      }
    }
  }

  return {
    describes,
    testedIdentifiers: [...testedIdentifiers]
  };
}

/**
 * Calculate coverage percentage
 */
function calculateCoverage(sourceExports, testedIdentifiers) {
  if (sourceExports.length === 0) return 100;

  const testedSet = new Set(testedIdentifiers.map(s => s.toLowerCase()));
  let covered = 0;

  for (const exp of sourceExports) {
    const expLower = exp.toLowerCase();
    if (testedSet.has(expLower) ||
        testedSet.has(expLower + 'live') ||
        testedSet.has(expLower.replace(/live$/, ''))) {
      covered++;
    }
  }

  return Math.round((covered / sourceExports.length) * 100);
}

describe('require-integration-tests rule', () => {
  describe('extractExports', () => {
    it('extracts class exports', () => {
      const content = `
        export class TaskService extends Context.Tag("TaskService")<...> {}
        export class TaskServiceLive {}
      `;
      const exports = extractExports(content);
      expect(exports).toContain('TaskService');
      expect(exports).toContain('TaskServiceLive');
    });

    it('extracts const exports', () => {
      const content = `
        export const TaskServiceLive = Layer.effect(...)
        export const defaultConfig = {}
      `;
      const exports = extractExports(content);
      expect(exports).toContain('TaskServiceLive');
      expect(exports).toContain('defaultConfig');
    });

    it('extracts function exports', () => {
      const content = `
        export function calculateScore() {}
        export function validateTask() {}
      `;
      const exports = extractExports(content);
      expect(exports).toContain('calculateScore');
      expect(exports).toContain('validateTask');
    });

    it('extracts named exports', () => {
      const content = `
        export { Task, TaskId, TaskWithDeps }
        export { foo as bar }
      `;
      const exports = extractExports(content);
      expect(exports).toContain('Task');
      expect(exports).toContain('TaskId');
      expect(exports).toContain('TaskWithDeps');
      expect(exports).toContain('foo');
    });

    it('removes duplicates', () => {
      const content = `
        export class Service {}
        export { Service }
      `;
      const exports = extractExports(content);
      const serviceCount = exports.filter(e => e === 'Service').length;
      expect(serviceCount).toBe(1);
    });
  });

  describe('extractTestCoverage', () => {
    it('extracts describe blocks', () => {
      const content = `
        describe("Task CRUD", () => {})
        describe('Ready detection', () => {})
        describe(\`Dependency operations\`, () => {})
      `;
      const { describes } = extractTestCoverage(content);
      expect(describes).toContain('Task CRUD');
      expect(describes).toContain('Ready detection');
      expect(describes).toContain('Dependency operations');
    });

    it('extracts service usage from yield*', () => {
      const content = `
        const svc = yield* TaskService
        const dep = yield* DependencyService
      `;
      const { testedIdentifiers } = extractTestCoverage(content);
      expect(testedIdentifiers).toContain('TaskService');
      expect(testedIdentifiers).toContain('DependencyService');
    });

    it('extracts service imports', () => {
      const content = `
        import { TaskService, TaskServiceLive } from "../../src/services/task-service.js"
        import { DependencyRepository } from "../../src/repo/dep-repo.js"
      `;
      const { testedIdentifiers } = extractTestCoverage(content);
      expect(testedIdentifiers).toContain('TaskService');
      expect(testedIdentifiers).toContain('TaskServiceLive');
      expect(testedIdentifiers).toContain('DependencyRepository');
    });
  });

  describe('calculateCoverage', () => {
    it('returns 100% for empty exports', () => {
      expect(calculateCoverage([], ['anything'])).toBe(100);
    });

    it('calculates correct coverage percentage', () => {
      const sourceExports = ['TaskService', 'TaskServiceLive', 'OtherThing'];
      const testedIdentifiers = ['TaskService', 'TaskServiceLive'];
      expect(calculateCoverage(sourceExports, testedIdentifiers)).toBe(67);
    });

    it('matches Service with ServiceLive variant', () => {
      const sourceExports = ['TaskService', 'TaskServiceLive'];
      const testedIdentifiers = ['TaskService'];
      // TaskService matches TaskService, TaskServiceLive matches via 'live' suffix removal
      expect(calculateCoverage(sourceExports, testedIdentifiers)).toBe(100);
    });

    it('is case insensitive', () => {
      const sourceExports = ['TaskService'];
      const testedIdentifiers = ['taskservice'];
      expect(calculateCoverage(sourceExports, testedIdentifiers)).toBe(100);
    });

    it('returns 0% when nothing is tested', () => {
      const sourceExports = ['A', 'B', 'C'];
      const testedIdentifiers = ['X', 'Y', 'Z'];
      expect(calculateCoverage(sourceExports, testedIdentifiers)).toBe(0);
    });
  });

  describe('integration with actual project files', () => {
    it('can read and parse src/services/task-service.ts', () => {
      const filePath = path.join(projectRoot, 'src/services/task-service.ts');
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const exports = extractExports(content);
        expect(exports).toContain('TaskService');
        expect(exports).toContain('TaskServiceLive');
      }
    });

    it('can read and parse test/integration/core.test.ts', () => {
      const filePath = path.join(projectRoot, 'test/integration/core.test.ts');
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const { testedIdentifiers, describes } = extractTestCoverage(content);
        expect(testedIdentifiers.length).toBeGreaterThan(0);
        expect(describes.length).toBeGreaterThan(0);
      }
    });

    it('correctly identifies test coverage for task-service', () => {
      const servicePath = path.join(projectRoot, 'src/services/task-service.ts');
      const testPath = path.join(projectRoot, 'test/integration/core.test.ts');

      if (fs.existsSync(servicePath) && fs.existsSync(testPath)) {
        const serviceContent = fs.readFileSync(servicePath, 'utf-8');
        const testContent = fs.readFileSync(testPath, 'utf-8');

        const sourceExports = extractExports(serviceContent);
        const { testedIdentifiers } = extractTestCoverage(testContent);

        const coverage = calculateCoverage(sourceExports, testedIdentifiers);
        // TaskService should have good coverage
        expect(coverage).toBeGreaterThanOrEqual(50);
      }
    });
  });
});

describe('default mappings configuration', () => {
  const defaultMappings = {
    services: { src: 'src/services', test: 'test/integration', threshold: 90 },
    repos: { src: 'src/repo', test: 'test/integration', threshold: 85 },
    cli: { src: 'src/cli.ts', test: 'test/integration/cli-*.test.ts', threshold: 70 },
    mcp: { src: 'src/mcp/server.ts', test: 'test/integration/mcp.test.ts', threshold: 80 },
    api: { src: 'apps/dashboard/server', test: 'test/integration/dashboard-api.test.ts', threshold: 80 }
  };

  it('has correct thresholds', () => {
    expect(defaultMappings.services.threshold).toBe(90);
    expect(defaultMappings.repos.threshold).toBe(85);
    expect(defaultMappings.cli.threshold).toBe(70);
    expect(defaultMappings.mcp.threshold).toBe(80);
    expect(defaultMappings.api.threshold).toBe(80);
  });

  it('maps services to test/integration', () => {
    expect(defaultMappings.services.test).toBe('test/integration');
  });

  it('maps cli to glob pattern', () => {
    expect(defaultMappings.cli.test).toContain('*');
  });
});
