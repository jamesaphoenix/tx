/**
 * remark-lint rule: tx/prd-required-metadata
 *
 * Ensures PRD files have required metadata fields:
 * - Status
 * - Priority
 * - Owner
 * - Last Updated
 */

import { lintRule } from 'unified-lint-rule'
import { visit } from 'unist-util-visit'
import { toString } from 'mdast-util-to-string'

const remarkLintPrdRequiredFields = lintRule(
  'remark-lint:tx/prd-required-metadata',
  (tree, file) => {
    const filePath = file.path || ''

    // Only apply to PRD files
    if (!filePath.includes('/prd/') && !filePath.includes('PRD-')) {
      return
    }

    const requiredFields = ['Status', 'Priority', 'Owner', 'Last Updated']
    const foundFields = new Set()

    visit(tree, 'paragraph', (node) => {
      const text = toString(node)
      for (const field of requiredFields) {
        // toString() strips markdown formatting, so match plain text "Field: value"
        if (text.match(new RegExp(`^${field}\\s*:`, 'im'))) {
          foundFields.add(field)
        }
      }
    })

    for (const field of requiredFields) {
      if (!foundFields.has(field)) {
        file.message(
          `PRD missing required field: **${field}**`,
          tree.position?.start
        )
      }
    }
  }
)

export default remarkLintPrdRequiredFields
