/**
 * remark-lint rule: tx/dd-testing-strategy
 *
 * Ensures Design Docs have testing sections:
 * - Integration Tests (or ## Testing Strategy containing integration)
 * - Unit Tests (or ## Testing Strategy containing unit)
 */

import { lintRule } from 'unified-lint-rule'
import { visit } from 'unist-util-visit'
import { toString } from 'mdast-util-to-string'

const remarkLintDdTestingSections = lintRule(
  'remark-lint:tx/dd-testing-strategy',
  (tree, file) => {
    const filePath = file.path || ''

    // Only apply to DD files
    if (!filePath.includes('/design/') && !filePath.includes('DD-')) {
      return
    }

    let hasTestingStrategy = false
    let hasIntegrationTests = false
    let hasUnitTests = false
    let testingStrategyNode = null

    // First pass: find headings
    visit(tree, 'heading', (node) => {
      const text = toString(node).toLowerCase()

      if (text.includes('testing strategy') || text.includes('testing')) {
        hasTestingStrategy = true
        testingStrategyNode = node
      }
      if (text.includes('integration test')) {
        hasIntegrationTests = true
      }
      if (text.includes('unit test')) {
        hasUnitTests = true
      }
    })

    // If there's a Testing Strategy section, check its content for integration/unit mentions
    if (hasTestingStrategy && testingStrategyNode) {
      let inTestingSection = false
      let testingSectionContent = ''

      visit(tree, (node) => {
        if (node === testingStrategyNode) {
          inTestingSection = true
          return
        }

        // Stop at next heading of same or higher level
        if (inTestingSection && node.type === 'heading') {
          const testingLevel = testingStrategyNode.depth
          if (node.depth <= testingLevel) {
            inTestingSection = false
          }
        }

        if (inTestingSection && (node.type === 'paragraph' || node.type === 'listItem' || node.type === 'heading')) {
          testingSectionContent += ' ' + toString(node).toLowerCase()
        }
      })

      if (testingSectionContent.includes('integration')) {
        hasIntegrationTests = true
      }
      if (testingSectionContent.includes('unit')) {
        hasUnitTests = true
      }
    }

    if (!hasTestingStrategy && !hasIntegrationTests && !hasUnitTests) {
      file.message(
        'DD missing testing documentation. Add ## Testing Strategy section with Integration Tests and Unit Tests subsections.',
        tree.position?.start
      )
    } else {
      if (!hasIntegrationTests) {
        file.message(
          'DD missing Integration Tests documentation',
          tree.position?.start
        )
      }
      if (!hasUnitTests) {
        file.message(
          'DD missing Unit Tests documentation',
          tree.position?.start
        )
      }
    }
  }
)

export default remarkLintDdTestingSections
