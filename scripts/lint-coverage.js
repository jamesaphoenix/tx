#!/usr/bin/env node
/**
 * @fileoverview CLI script to check test coverage thresholds
 *
 * Usage: npm run lint:coverage
 *
 * This script reads the vitest coverage output and verifies that all modules
 * meet their required coverage thresholds as defined in DD-007.
 *
 * Thresholds:
 * - Core services (src/services/): 90% line coverage
 * - Repositories (src/repo/, src/repositories/): 85% line coverage
 * - CLI commands (src/cli/): 80% line coverage
 * - Dashboard components/hooks: 75% line coverage
 *
 * Exit codes:
 * - 0: All thresholds met
 * - 1: One or more thresholds not met
 * - 2: Coverage file not found (run tests with --coverage first)
 */

import { checkCoverageThresholds } from '../eslint-plugin-tx/rules/test-coverage-thresholds.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const failOnMissing = !args.includes('--no-fail-on-missing');
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  console.log(`
Usage: npm run lint:coverage [options]

Check that test coverage meets per-module thresholds.

Options:
  --no-fail-on-missing  Don't exit with error if coverage file is missing
  --help, -h            Show this help message

Thresholds:
  src/services/                      90% line coverage
  src/repo/, src/repositories/       85% line coverage
  src/cli/                           80% line coverage
  apps/dashboard/src/components/     75% line coverage
  apps/dashboard/src/hooks/          75% line coverage

Before running:
  npm test -- --coverage

Reference: DD-007 testing strategy
`);
  process.exit(0);
}

console.log('Checking test coverage thresholds...\n');

const result = checkCoverageThresholds(projectRoot);

if (!result.success && result.violations.length === 0) {
  // Coverage file not found
  console.error(result.report);
  console.error('\nTip: Run "npm test -- --coverage" first to generate coverage data.');
  process.exit(failOnMissing ? 2 : 0);
}

if (result.success) {
  console.log('✓ ' + result.report);
  process.exit(0);
} else {
  console.error('✗ ' + result.report);
  process.exit(1);
}
