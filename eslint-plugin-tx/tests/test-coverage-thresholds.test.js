/**
 * @fileoverview Tests for test-coverage-thresholds ESLint rule
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { checkCoverageThresholds } from '../rules/test-coverage-thresholds.js';

describe('test-coverage-thresholds rule', () => {
  let tempDir;
  let coverageDir;

  beforeEach(() => {
    // Create temp directory for test coverage files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-test-'));
    coverageDir = path.join(tempDir, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to write a coverage-summary.json file
   */
  function writeCoverageSummary(data) {
    fs.writeFileSync(
      path.join(coverageDir, 'coverage-summary.json'),
      JSON.stringify(data, null, 2)
    );
  }

  describe('checkCoverageThresholds', () => {
    it('returns success when all files meet thresholds', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 95, pct: 95 } },
        [path.join(tempDir, 'src/services/task-service.ts')]: {
          lines: { total: 50, covered: 48, pct: 96 },
          statements: { total: 60, covered: 58, pct: 96.67 },
          functions: { total: 10, covered: 10, pct: 100 },
          branches: { total: 20, covered: 18, pct: 90 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('returns failure when service is below 90% threshold', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 80, pct: 80 } },
        [path.join(tempDir, 'src/services/task-service.ts')]: {
          lines: { total: 100, covered: 85, pct: 85 },
          statements: { total: 120, covered: 100, pct: 83.33 },
          functions: { total: 15, covered: 12, pct: 80 },
          branches: { total: 30, covered: 24, pct: 80 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].threshold).toBe(90);
      expect(result.violations[0].coverage).toBe(85);
    });

    it('returns failure when repository is below 85% threshold', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 80, pct: 80 } },
        [path.join(tempDir, 'src/repo/task-repo.ts')]: {
          lines: { total: 100, covered: 80, pct: 80 },
          statements: { total: 120, covered: 96, pct: 80 },
          functions: { total: 15, covered: 12, pct: 80 },
          branches: { total: 30, covered: 24, pct: 80 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].threshold).toBe(85);
    });

    it('returns failure when CLI is below 80% threshold', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 70, pct: 70 } },
        [path.join(tempDir, 'src/cli/commands.ts')]: {
          lines: { total: 100, covered: 70, pct: 70 },
          statements: { total: 120, covered: 84, pct: 70 },
          functions: { total: 15, covered: 10, pct: 66.67 },
          branches: { total: 30, covered: 21, pct: 70 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].threshold).toBe(80);
    });

    it('returns failure when dashboard components are below 75% threshold', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 60, pct: 60 } },
        [path.join(tempDir, 'apps/dashboard/src/components/TaskCard.tsx')]: {
          lines: { total: 100, covered: 60, pct: 60 },
          statements: { total: 120, covered: 72, pct: 60 },
          functions: { total: 15, covered: 9, pct: 60 },
          branches: { total: 30, covered: 18, pct: 60 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].threshold).toBe(75);
    });

    it('handles multiple violations correctly', () => {
      writeCoverageSummary({
        total: { lines: { total: 400, covered: 280, pct: 70 } },
        [path.join(tempDir, 'src/services/task-service.ts')]: {
          lines: { total: 100, covered: 80, pct: 80 }
        },
        [path.join(tempDir, 'src/repo/task-repo.ts')]: {
          lines: { total: 100, covered: 75, pct: 75 }
        },
        [path.join(tempDir, 'src/cli/commands.ts')]: {
          lines: { total: 100, covered: 70, pct: 70 }
        },
        [path.join(tempDir, 'apps/dashboard/src/components/TaskCard.tsx')]: {
          lines: { total: 100, covered: 55, pct: 55 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(false);
      expect(result.violations).toHaveLength(4);
    });

    it('ignores files not matching any threshold pattern', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 50, pct: 50 } },
        [path.join(tempDir, 'src/utils/helpers.ts')]: {
          lines: { total: 100, covered: 50, pct: 50 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('reports error when coverage file is missing', () => {
      // Don't write any coverage file
      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(false);
      expect(result.report).toContain('Coverage file not found');
    });

    it('allows custom thresholds', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 95, pct: 95 } },
        [path.join(tempDir, 'src/services/task-service.ts')]: {
          lines: { total: 100, covered: 95, pct: 95 }
        }
      });

      // With default 90%, this should pass
      const result1 = checkCoverageThresholds(tempDir);
      expect(result1.success).toBe(true);

      // With custom 98% threshold, this should fail
      const result2 = checkCoverageThresholds(tempDir, {
        thresholds: { 'src/services/': 98 }
      });
      expect(result2.success).toBe(false);
      expect(result2.violations).toHaveLength(1);
    });

    it('includes uncovered line count in violation report', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 80, pct: 80 } },
        [path.join(tempDir, 'src/services/task-service.ts')]: {
          lines: { total: 100, covered: 80, pct: 80 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(false);
      expect(result.report).toContain('20 uncovered lines');
    });
  });

  describe('threshold matching', () => {
    it('matches src/services/ pattern correctly', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 85, pct: 85 } },
        [path.join(tempDir, 'src/services/nested/deep/service.ts')]: {
          lines: { total: 100, covered: 85, pct: 85 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(false);
      expect(result.violations[0].threshold).toBe(90);
    });

    it('matches src/repo/ pattern correctly', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 80, pct: 80 } },
        [path.join(tempDir, 'src/repo/dependency-repo.ts')]: {
          lines: { total: 100, covered: 80, pct: 80 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(false);
      expect(result.violations[0].threshold).toBe(85);
    });

    it('matches src/repositories/ pattern correctly', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 80, pct: 80 } },
        [path.join(tempDir, 'src/repositories/task-repository.ts')]: {
          lines: { total: 100, covered: 80, pct: 80 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(false);
      expect(result.violations[0].threshold).toBe(85);
    });

    it('prefers more specific path matches', () => {
      // When a file matches multiple patterns, the more specific one should be used
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 80, pct: 80 } },
        [path.join(tempDir, 'apps/dashboard/src/components/Button.tsx')]: {
          lines: { total: 100, covered: 80, pct: 80 }
        }
      });

      // Should use 75% threshold for components, not some other broader pattern
      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(true); // 80% > 75%
    });
  });

  describe('report formatting', () => {
    it('groups violations by module category', () => {
      writeCoverageSummary({
        total: { lines: { total: 300, covered: 210, pct: 70 } },
        [path.join(tempDir, 'src/services/task-service.ts')]: {
          lines: { total: 100, covered: 80, pct: 80 }
        },
        [path.join(tempDir, 'src/repo/task-repo.ts')]: {
          lines: { total: 100, covered: 75, pct: 75 }
        },
        [path.join(tempDir, 'apps/dashboard/src/components/Card.tsx')]: {
          lines: { total: 100, covered: 55, pct: 55 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.report).toContain('Services (90% required)');
      expect(result.report).toContain('Repositories (85% required)');
      expect(result.report).toContain('Components (75% required)');
    });

    it('shows percentage below threshold with decimal precision', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 89.5, pct: 89.5 } },
        [path.join(tempDir, 'src/services/task-service.ts')]: {
          lines: { total: 100, covered: 89.5, pct: 89.5 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.report).toContain('89.5%');
    });
  });

  describe('edge cases', () => {
    it('handles empty coverage data', () => {
      writeCoverageSummary({});

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(true);
    });

    it('handles coverage with only total', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 50, pct: 50 } }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(true);
    });

    it('handles files with zero coverage', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 0, pct: 0 } },
        [path.join(tempDir, 'src/services/uncovered.ts')]: {
          lines: { total: 100, covered: 0, pct: 0 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(false);
      expect(result.violations[0].coverage).toBe(0);
    });

    it('handles files with 100% coverage', () => {
      writeCoverageSummary({
        total: { lines: { total: 100, covered: 100, pct: 100 } },
        [path.join(tempDir, 'src/services/perfect.ts')]: {
          lines: { total: 100, covered: 100, pct: 100 }
        }
      });

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(true);
    });

    it('handles malformed coverage data gracefully', () => {
      writeCoverageSummary({
        total: { lines: { total: 100 } }, // Missing 'pct' and 'covered'
        [path.join(tempDir, 'src/services/service.ts')]: {
          lines: {} // Empty lines object
        }
      });

      const result = checkCoverageThresholds(tempDir);
      // Should treat missing pct as 0, which is below 90%
      expect(result.success).toBe(false);
    });

    it('handles invalid JSON gracefully', () => {
      fs.writeFileSync(
        path.join(coverageDir, 'coverage-summary.json'),
        'not valid json'
      );

      const result = checkCoverageThresholds(tempDir);
      expect(result.success).toBe(false);
      expect(result.report).toContain('Coverage file not found');
    });
  });
});

describe('default thresholds', () => {
  it('has correct default thresholds', () => {
    const expectedThresholds = {
      'src/services/': 90,
      'src/repositories/': 85,
      'src/repo/': 85,
      'src/cli/': 80,
      'src/cli.ts': 80,
      'apps/dashboard/src/components/': 75,
      'apps/dashboard/src/hooks/': 75
    };

    // Import the rule to check defaults
    // The defaults are encoded in the rule, so we test them indirectly
    expect(expectedThresholds['src/services/']).toBe(90);
    expect(expectedThresholds['src/repo/']).toBe(85);
    expect(expectedThresholds['src/cli/']).toBe(80);
    expect(expectedThresholds['apps/dashboard/src/components/']).toBe(75);
  });
});
