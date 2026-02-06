/**
 * remark-lint rule: tx/prd-dd-pairing
 *
 * Ensures every PRD-NNN has a corresponding DD-NNN and vice versa.
 * When processing a PRD file, checks that docs/design/DD-NNN-*.md exists.
 * When processing a DD file, checks that docs/prd/PRD-NNN-*.md exists.
 */

import { lintRule } from 'unified-lint-rule'
import fs from 'node:fs'
import path from 'node:path'

const remarkLintPrdDdPairing = lintRule(
  'remark-lint:tx/prd-dd-pairing',
  (tree, file) => {
    const filePath = file.path || ''
    const fileName = path.basename(filePath)

    const prdMatch = fileName.match(/^PRD-(\d{3})-/)
    const ddMatch = fileName.match(/^DD-(\d{3})-/)

    if (!prdMatch && !ddMatch) {
      return
    }

    // Resolve the docs root relative to the file being processed
    const docsRoot = path.resolve(path.dirname(filePath), '..')

    if (prdMatch) {
      const number = prdMatch[1]
      const designDir = path.join(docsRoot, 'design')

      if (!fs.existsSync(designDir)) {
        return
      }

      const hasMatchingDD = fs.readdirSync(designDir).some(
        (f) => f.match(new RegExp(`^DD-${number}-.*\\.md$`))
      )

      if (!hasMatchingDD) {
        file.message(
          `PRD-${number} has no corresponding DD-${number} in docs/design/. Every PRD must have a matching Design Doc.`,
          tree.position?.start
        )
      }
    }

    if (ddMatch) {
      const number = ddMatch[1]
      const prdDir = path.join(docsRoot, 'prd')

      if (!fs.existsSync(prdDir)) {
        return
      }

      const hasMatchingPRD = fs.readdirSync(prdDir).some(
        (f) => f.match(new RegExp(`^PRD-${number}-.*\\.md$`))
      )

      if (!hasMatchingPRD) {
        file.message(
          `DD-${number} has no corresponding PRD-${number} in docs/prd/. Every Design Doc must have a matching PRD.`,
          tree.position?.start
        )
      }
    }
  }
)

export default remarkLintPrdDdPairing
