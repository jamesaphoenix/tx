/**
 * @fileoverview ESLint rule that enforces test coverage thresholds per module
 *
 * Works with vitest coverage output (coverage/coverage-summary.json).
 * Enforces different thresholds for different parts of the codebase:
 * - Core services (src/services/): 90% line coverage required
 * - Repositories (src/repositories/): 85% line coverage
 * - CLI commands (src/cli/): 80% line coverage
 * - Dashboard components: 75% line coverage
 *
 * Reference: DD-007 testing strategy coverage targets
 */

import fs from 'fs';
import path from 'path';

/**
 * Default coverage thresholds per module
 */
const defaultThresholds = {
  'src/services/': 90,
  'src/repositories/': 85,
  'src/repo/': 85,
  'src/cli/': 80,
  'src/cli.ts': 80,
  'apps/dashboard/src/components/': 75,
  'apps/dashboard/src/hooks/': 75
};

/**
 * Read and parse the coverage summary JSON file
 * @param {string} coveragePath - Path to coverage-summary.json
 * @returns {object|null} - Parsed coverage data or null if not found
 */
function readCoverageSummary(coveragePath) {
  try {
    if (!fs.existsSync(coveragePath)) {
      return null;
    }
    const content = fs.readFileSync(coveragePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get the threshold for a given file path
 * @param {string} filePath - Relative path to the file
 * @param {object} thresholds - Threshold configuration
 * @returns {number|null} - Required threshold or null if no threshold applies
 */
function getThresholdForPath(filePath, thresholds) {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Find the most specific matching threshold
  let matchedThreshold = null;
  let matchedPrefix = '';

  for (const [prefix, threshold] of Object.entries(thresholds)) {
    if (normalizedPath.startsWith(prefix) || normalizedPath.includes(prefix)) {
      // Prefer more specific (longer) prefix matches
      if (prefix.length > matchedPrefix.length) {
        matchedThreshold = threshold;
        matchedPrefix = prefix;
      }
    }
  }

  return matchedThreshold;
}

/**
 * Analyze coverage data and find files below threshold
 * @param {object} coverageData - Parsed coverage-summary.json
 * @param {object} thresholds - Threshold configuration
 * @param {string} cwd - Current working directory
 * @returns {Array<{file: string, coverage: number, threshold: number, uncoveredLines: number[]}>}
 */
function findBelowThreshold(coverageData, thresholds, cwd) {
  const violations = [];

  for (const [filePath, data] of Object.entries(coverageData)) {
    // Skip the 'total' summary
    if (filePath === 'total') continue;

    // Get relative path from absolute path
    let relativePath = filePath;
    if (path.isAbsolute(filePath)) {
      relativePath = path.relative(cwd, filePath);
    }

    const threshold = getThresholdForPath(relativePath, thresholds);
    if (threshold === null) continue;

    // Check line coverage percentage
    const lineData = data.lines || {};
    const linePct = lineData.pct ?? 0;

    if (linePct < threshold) {
      violations.push({
        file: relativePath,
        coverage: linePct,
        threshold,
        total: lineData.total || 0,
        covered: lineData.covered || 0,
        uncovered: (lineData.total || 0) - (lineData.covered || 0)
      });
    }
  }

  return violations;
}

/**
 * Group violations by module category
 * @param {Array} violations - Array of violation objects
 * @returns {object} - Violations grouped by module
 */
function groupViolationsByModule(violations) {
  const groups = {
    services: [],
    repositories: [],
    cli: [],
    components: [],
    other: []
  };

  for (const violation of violations) {
    const file = violation.file;
    if (file.includes('src/services/')) {
      groups.services.push(violation);
    } else if (file.includes('src/repo') || file.includes('src/repositories')) {
      groups.repositories.push(violation);
    } else if (file.includes('src/cli')) {
      groups.cli.push(violation);
    } else if (file.includes('components/') || file.includes('hooks/')) {
      groups.components.push(violation);
    } else {
      groups.other.push(violation);
    }
  }

  return groups;
}

/**
 * Format violations into a readable report
 * @param {Array} violations - Array of violation objects
 * @returns {string} - Formatted report
 */
function formatViolationReport(violations) {
  if (violations.length === 0) return '';

  const groups = groupViolationsByModule(violations);
  const lines = [];

  const addGroup = (name, items) => {
    if (items.length === 0) return;
    lines.push(`\n  ${name}:`);
    for (const v of items) {
      const uncoveredInfo = v.uncovered > 0 ? ` (${v.uncovered} uncovered lines)` : '';
      lines.push(`    - ${v.file}: ${v.coverage.toFixed(1)}% < ${v.threshold}%${uncoveredInfo}`);
    }
  };

  addGroup('Services (90% required)', groups.services);
  addGroup('Repositories (85% required)', groups.repositories);
  addGroup('CLI (80% required)', groups.cli);
  addGroup('Components (75% required)', groups.components);
  addGroup('Other', groups.other);

  return lines.join('\n');
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce test coverage thresholds per module based on vitest coverage output',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      coverageFileMissing: 'Coverage summary file not found at {{path}}. Run: npm test -- --coverage',
      belowThreshold: 'Test coverage below threshold for {{count}} file(s):{{report}}\n\nRun: npm test -- --coverage to regenerate',
      modulesBelowThreshold: 'Module coverage below threshold: {{module}} requires {{threshold}}% but has {{actual}}%'
    },
    schema: [
      {
        type: 'object',
        properties: {
          coveragePath: {
            type: 'string',
            description: 'Path to coverage-summary.json relative to project root'
          },
          thresholds: {
            type: 'object',
            additionalProperties: {
              type: 'number',
              minimum: 0,
              maximum: 100
            },
            description: 'Coverage thresholds per module path prefix'
          },
          failOnMissing: {
            type: 'boolean',
            description: 'Whether to fail if coverage file is missing'
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = context.options[0] || {};
    const coverageRelPath = options.coveragePath || 'coverage/coverage-summary.json';
    const thresholds = { ...defaultThresholds, ...options.thresholds };
    const failOnMissing = options.failOnMissing ?? false;
    // Use context.cwd for ESLint 9+ flat config, fallback to getCwd for legacy
    const cwd = context.cwd ?? (typeof context.getCwd === 'function' ? context.getCwd() : process.cwd());
    const coveragePath = path.join(cwd, coverageRelPath);
    const filename = context.filename || context.getFilename?.() || '';
    const relPath = path.relative(cwd, filename);

    // Skip if this file doesn't match any threshold
    const fileThreshold = getThresholdForPath(relPath, thresholds);
    if (fileThreshold === null) {
      return {};
    }

    return {
      Program(node) {
        // Read coverage data
        const coverageData = readCoverageSummary(coveragePath);

        if (!coverageData) {
          if (failOnMissing) {
            context.report({
              node,
              messageId: 'coverageFileMissing',
              data: { path: coverageRelPath }
            });
          }
          return;
        }

        // Check this specific file's coverage
        let fileData = null;
        for (const [filePath, data] of Object.entries(coverageData)) {
          if (filePath === 'total') continue;

          let checkPath = filePath;
          if (path.isAbsolute(filePath)) {
            checkPath = path.relative(cwd, filePath);
          }

          // Match the current file
          if (checkPath === relPath || filePath.endsWith(relPath)) {
            fileData = data;
            break;
          }
        }

        if (!fileData) {
          // File not in coverage report - might not have been tested
          return;
        }

        // Check line coverage for this file
        const lineData = fileData.lines || {};
        const linePct = lineData.pct ?? 0;

        if (linePct < fileThreshold) {
          context.report({
            node,
            messageId: 'modulesBelowThreshold',
            data: {
              module: relPath,
              threshold: fileThreshold.toString(),
              actual: linePct.toFixed(1)
            }
          });
        }
      }
    };
  }
};

/**
 * Standalone function to check all coverage and generate a report
 * This can be called from a script or CLI
 * @param {string} cwd - Working directory
 * @param {object} options - Configuration options
 * @returns {{success: boolean, violations: Array, report: string}}
 */
export function checkCoverageThresholds(cwd, options = {}) {
  const coverageRelPath = options.coveragePath || 'coverage/coverage-summary.json';
  const thresholds = { ...defaultThresholds, ...options.thresholds };
  const coveragePath = path.join(cwd, coverageRelPath);

  const coverageData = readCoverageSummary(coveragePath);

  if (!coverageData) {
    return {
      success: false,
      violations: [],
      report: `Coverage file not found: ${coveragePath}\nRun: npm test -- --coverage`
    };
  }

  const violations = findBelowThreshold(coverageData, thresholds, cwd);

  if (violations.length === 0) {
    return {
      success: true,
      violations: [],
      report: 'All files meet coverage thresholds!'
    };
  }

  const report = formatViolationReport(violations);

  return {
    success: false,
    violations,
    report: `Coverage thresholds not met for ${violations.length} file(s):${report}`
  };
}
