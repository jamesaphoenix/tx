/**
 * remark-lint rule: tx/prd-failure-modes
 *
 * Ensures PRD files have a Failure Modes section documenting:
 * - What can go wrong
 * - Impact of failures
 * - Mitigation strategies
 */

import { lintRule } from 'unified-lint-rule'
import { visit } from 'unist-util-visit'
import { toString } from 'mdast-util-to-string'

const remarkLintPrdFailureModes = lintRule(
  'remark-lint:tx/prd-failure-modes',
  (tree, file) => {
    const filePath = file.path || ''

    // Only apply to PRD files
    if (!filePath.includes('/prd/') && !filePath.includes('PRD-')) {
      return
    }

    let hasFailureModes = false
    let hasErrorRecovery = false

    visit(tree, 'heading', (node) => {
      const text = toString(node).toLowerCase()

      if (
        text.includes('failure mode') ||
        text.includes('failure scenario') ||
        text.includes('what could go wrong')
      ) {
        hasFailureModes = true
      }

      // Also accept "Error Recovery" as an alternative
      if (text.includes('error recovery') || text.includes('error handling')) {
        hasErrorRecovery = true
      }
    })

    if (!hasFailureModes && !hasErrorRecovery) {
      file.message(
        'PRD missing ## Failure Modes section. Document what can go wrong, impact, and mitigation strategies.',
        tree.position?.start
      )
    }
  }
)

export default remarkLintPrdFailureModes
