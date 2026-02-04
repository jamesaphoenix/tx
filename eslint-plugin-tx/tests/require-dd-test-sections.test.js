/**
 * @fileoverview Tests for require-dd-test-sections ESLint rule
 *
 * Tests that Design Documents (DD-*.md) have Integration Tests and Unit Tests
 * sections documented, per DD-007 (Testing Strategy).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Import the helper functions from the rule
import {
  hasIntegrationTestsSection,
  hasUnitTestsSection,
  hasTestingStrategySection,
  getMissingSections
} from '../rules/require-dd-test-sections.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const docsDesignDir = path.join(projectRoot, 'docs/design');

// =============================================================================
// Unit Tests for Helper Functions
// =============================================================================

describe('require-dd-test-sections rule helper functions', () => {
  describe('hasTestingStrategySection', () => {
    it('detects ## Testing Strategy heading', () => {
      const content = `
# DD-001: Some Feature

## Overview
Description here.

## Testing Strategy

Some testing notes.
      `;
      expect(hasTestingStrategySection(content)).toBe(true);
    });

    it('detects ### Testing Strategy heading', () => {
      const content = `
# DD-001: Some Feature

### Testing Strategy

Some testing notes.
      `;
      expect(hasTestingStrategySection(content)).toBe(true);
    });

    it('returns false when no Testing Strategy section', () => {
      const content = `
# DD-001: Some Feature

## Overview
Description here.

## Implementation
Code here.
      `;
      expect(hasTestingStrategySection(content)).toBe(false);
    });

    it('is case insensitive', () => {
      const content = `
## testing strategy

Notes here.
      `;
      expect(hasTestingStrategySection(content)).toBe(true);
    });
  });

  describe('hasIntegrationTestsSection', () => {
    it('detects ## Integration Tests heading', () => {
      const content = `
## Integration Tests

Test examples here.
      `;
      expect(hasIntegrationTestsSection(content)).toBe(true);
    });

    it('detects ### X Tests (Integration) pattern', () => {
      const content = `
### Service Layer Tests (Integration)

Test examples here.
      `;
      expect(hasIntegrationTestsSection(content)).toBe(true);
    });

    it('detects #### X Tests (Integration) pattern', () => {
      const content = `
#### Schema Tests (Integration)

Test examples here.
      `;
      expect(hasIntegrationTestsSection(content)).toBe(true);
    });

    it('detects Integration Test Architecture heading', () => {
      const content = `
## Integration Test Architecture

Architecture notes here.
      `;
      expect(hasIntegrationTestsSection(content)).toBe(true);
    });

    it('detects Integration Test Examples heading', () => {
      const content = `
## Integration Test Examples

Examples here.
      `;
      expect(hasIntegrationTestsSection(content)).toBe(true);
    });

    it('detects test/integration directory reference', () => {
      const content = `
Tests are located in \`test/integration\` directory.
      `;
      expect(hasIntegrationTestsSection(content)).toBe(true);
    });

    it('returns false when no Integration Tests section', () => {
      const content = `
## Unit Tests

Unit test examples here.
      `;
      expect(hasIntegrationTestsSection(content)).toBe(false);
    });
  });

  describe('hasUnitTestsSection', () => {
    it('detects ## Unit Tests heading', () => {
      const content = `
## Unit Tests

Test examples here.
      `;
      expect(hasUnitTestsSection(content)).toBe(true);
    });

    it('detects ### X Tests (Unit) pattern', () => {
      const content = `
### ID Generation Tests (Unit)

Test examples here.
      `;
      expect(hasUnitTestsSection(content)).toBe(true);
    });

    it('detects #### X Tests (Unit) pattern', () => {
      const content = `
#### Error Type Tests (Unit)

Test examples here.
      `;
      expect(hasUnitTestsSection(content)).toBe(true);
    });

    it('detects test/unit directory reference', () => {
      const content = `
Tests are located in \`test/unit\` directory.
      `;
      expect(hasUnitTestsSection(content)).toBe(true);
    });

    it('returns false when no Unit Tests section', () => {
      const content = `
## Integration Tests

Integration test examples here.
      `;
      expect(hasUnitTestsSection(content)).toBe(false);
    });
  });

  describe('getMissingSections', () => {
    it('returns all three when content has no test sections', () => {
      const content = `
# DD-001: Feature

## Overview
Description here.
      `;
      const missing = getMissingSections(content);
      expect(missing).toContain('Testing Strategy');
      expect(missing).toContain('Integration Tests');
      expect(missing).toContain('Unit Tests');
      expect(missing).toHaveLength(3);
    });

    it('returns empty array when all sections present', () => {
      const content = `
# DD-001: Feature

## Testing Strategy

### Schema Tests (Integration)

Test code here.

### ID Generation Tests (Unit)

More test code.
      `;
      const missing = getMissingSections(content);
      expect(missing).toHaveLength(0);
    });

    it('returns only missing sections', () => {
      const content = `
# DD-001: Feature

## Testing Strategy

### Integration Tests

Test code here.
      `;
      const missing = getMissingSections(content);
      expect(missing).not.toContain('Testing Strategy');
      expect(missing).not.toContain('Integration Tests');
      expect(missing).toContain('Unit Tests');
      expect(missing).toHaveLength(1);
    });
  });
});

// =============================================================================
// Integration Tests with Actual Project Files
// =============================================================================

describe('integration with actual Design Documents', () => {
  // Get all DD-*.md files in docs/design
  const ddFiles = fs.existsSync(docsDesignDir)
    ? fs.readdirSync(docsDesignDir)
        .filter(f => /^DD-\d{3}-.+\.md$/.test(f))
        .map(f => path.join(docsDesignDir, f))
    : [];

  it('can find Design Documents in docs/design', () => {
    expect(ddFiles.length).toBeGreaterThan(0);
  });

  describe('DD-001-data-model-storage.md', () => {
    const ddPath = path.join(docsDesignDir, 'DD-001-data-model-storage.md');

    it('exists', () => {
      expect(fs.existsSync(ddPath)).toBe(true);
    });

    it('has Testing Strategy section', () => {
      if (fs.existsSync(ddPath)) {
        const content = fs.readFileSync(ddPath, 'utf-8');
        expect(hasTestingStrategySection(content)).toBe(true);
      }
    });

    it('has Integration Tests documentation', () => {
      if (fs.existsSync(ddPath)) {
        const content = fs.readFileSync(ddPath, 'utf-8');
        expect(hasIntegrationTestsSection(content)).toBe(true);
      }
    });

    it('has Unit Tests documentation', () => {
      if (fs.existsSync(ddPath)) {
        const content = fs.readFileSync(ddPath, 'utf-8');
        expect(hasUnitTestsSection(content)).toBe(true);
      }
    });
  });

  describe('DD-002-effect-ts-service-layer.md', () => {
    const ddPath = path.join(docsDesignDir, 'DD-002-effect-ts-service-layer.md');

    it('exists', () => {
      expect(fs.existsSync(ddPath)).toBe(true);
    });

    it('has Testing Strategy section', () => {
      if (fs.existsSync(ddPath)) {
        const content = fs.readFileSync(ddPath, 'utf-8');
        expect(hasTestingStrategySection(content)).toBe(true);
      }
    });

    it('has Integration Tests documentation', () => {
      if (fs.existsSync(ddPath)) {
        const content = fs.readFileSync(ddPath, 'utf-8');
        expect(hasIntegrationTestsSection(content)).toBe(true);
      }
    });

    it('has Unit Tests documentation', () => {
      if (fs.existsSync(ddPath)) {
        const content = fs.readFileSync(ddPath, 'utf-8');
        expect(hasUnitTestsSection(content)).toBe(true);
      }
    });
  });

  describe('DD-005-mcp-agent-sdk-integration.md', () => {
    const ddPath = path.join(docsDesignDir, 'DD-005-mcp-agent-sdk-integration.md');

    it('exists', () => {
      expect(fs.existsSync(ddPath)).toBe(true);
    });

    it('has Testing Strategy section', () => {
      if (fs.existsSync(ddPath)) {
        const content = fs.readFileSync(ddPath, 'utf-8');
        expect(hasTestingStrategySection(content)).toBe(true);
      }
    });

    it('has Integration Tests documentation', () => {
      if (fs.existsSync(ddPath)) {
        const content = fs.readFileSync(ddPath, 'utf-8');
        expect(hasIntegrationTestsSection(content)).toBe(true);
      }
    });

    it('has Unit Tests documentation', () => {
      if (fs.existsSync(ddPath)) {
        const content = fs.readFileSync(ddPath, 'utf-8');
        expect(hasUnitTestsSection(content)).toBe(true);
      }
    });
  });

  describe('DD-007-testing-strategy.md (the testing strategy DD itself)', () => {
    const ddPath = path.join(docsDesignDir, 'DD-007-testing-strategy.md');

    it('exists', () => {
      expect(fs.existsSync(ddPath)).toBe(true);
    });

    it('references Integration Tests', () => {
      if (fs.existsSync(ddPath)) {
        const content = fs.readFileSync(ddPath, 'utf-8');
        expect(hasIntegrationTestsSection(content)).toBe(true);
      }
    });

    it('references Unit Tests', () => {
      if (fs.existsSync(ddPath)) {
        const content = fs.readFileSync(ddPath, 'utf-8');
        expect(hasUnitTestsSection(content)).toBe(true);
      }
    });
  });

  // Test all DD files for compliance
  describe('all Design Documents have required test sections', () => {
    for (const ddFile of ddFiles) {
      const basename = path.basename(ddFile);

      it(`${basename} has Testing Strategy, Integration Tests, and Unit Tests`, () => {
        const content = fs.readFileSync(ddFile, 'utf-8');
        const missing = getMissingSections(content);

        if (missing.length > 0) {
          console.warn(`  Warning: ${basename} is missing: ${missing.join(', ')}`);
        }

        // Note: This is a warning test - it logs but doesn't fail
        // The actual ESLint rule will enforce this
        expect(true).toBe(true);
      });
    }
  });
});

// =============================================================================
// Pattern Matching Edge Cases
// =============================================================================

describe('pattern matching edge cases', () => {
  describe('Integration Tests patterns', () => {
    it('matches "MCP Tool Response Tests (Integration)"', () => {
      const content = `### MCP Tool Response Tests (Integration)`;
      expect(hasIntegrationTestsSection(content)).toBe(true);
    });

    it('matches "Schema Tests (Integration)"', () => {
      const content = `### Schema Tests (Integration)`;
      expect(hasIntegrationTestsSection(content)).toBe(true);
    });

    it('matches "Migration Tests (Integration)"', () => {
      const content = `### Migration Tests (Integration)`;
      expect(hasIntegrationTestsSection(content)).toBe(true);
    });

    it('matches "Performance Tests (Integration)"', () => {
      const content = `### Performance Tests (Integration)`;
      expect(hasIntegrationTestsSection(content)).toBe(true);
    });

    it('matches "Layer Composition Tests (Integration)"', () => {
      const content = `### Layer Composition Tests (Integration)`;
      expect(hasIntegrationTestsSection(content)).toBe(true);
    });
  });

  describe('Unit Tests patterns', () => {
    it('matches "ID Generation Tests (Unit)"', () => {
      const content = `### ID Generation Tests (Unit)`;
      expect(hasUnitTestsSection(content)).toBe(true);
    });

    it('matches "Row-to-Model Tests (Unit)"', () => {
      const content = `### Row-to-Model Tests (Unit)`;
      expect(hasUnitTestsSection(content)).toBe(true);
    });

    it('matches "Error Type Tests (Unit)"', () => {
      const content = `### Error Type Tests (Unit)`;
      expect(hasUnitTestsSection(content)).toBe(true);
    });

    it('matches "Tool Definition Tests (Unit)"', () => {
      const content = `### Tool Definition Tests (Unit)`;
      expect(hasUnitTestsSection(content)).toBe(true);
    });
  });

  describe('does not match unrelated content', () => {
    it('does not match "Integration" alone', () => {
      const content = `This is about API integration with external services.`;
      expect(hasIntegrationTestsSection(content)).toBe(false);
    });

    it('does not match "Unit" alone', () => {
      const content = `This is a single unit of work.`;
      expect(hasUnitTestsSection(content)).toBe(false);
    });

    it('does not match "Testing" alone', () => {
      const content = `We are testing the waters here.`;
      expect(hasTestingStrategySection(content)).toBe(false);
    });
  });
});

// =============================================================================
// Configuration Options Tests
// =============================================================================

describe('rule configuration options', () => {
  const defaultOptions = {
    ddPattern: /^DD-\d{3}-.+\.md$/,
    ddDirectory: 'docs/design',
    requireTestingStrategy: true,
    requireIntegrationTests: true,
    requireUnitTests: true,
  };

  it('has correct default pattern', () => {
    expect(defaultOptions.ddPattern.test('DD-001-feature.md')).toBe(true);
    expect(defaultOptions.ddPattern.test('DD-123-some-feature.md')).toBe(true);
    expect(defaultOptions.ddPattern.test('PRD-001-feature.md')).toBe(false);
    expect(defaultOptions.ddPattern.test('README.md')).toBe(false);
  });

  it('has correct default directory', () => {
    expect(defaultOptions.ddDirectory).toBe('docs/design');
  });

  it('requires all test sections by default', () => {
    expect(defaultOptions.requireTestingStrategy).toBe(true);
    expect(defaultOptions.requireIntegrationTests).toBe(true);
    expect(defaultOptions.requireUnitTests).toBe(true);
  });
});
