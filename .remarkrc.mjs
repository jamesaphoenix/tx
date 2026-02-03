import remarkPresetLintRecommended from 'remark-preset-lint-recommended'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkLintPrdRequiredFields from './scripts/remark-lint-prd-required-fields.mjs'
import remarkLintDdTestingSections from './scripts/remark-lint-dd-testing-sections.mjs'
import remarkLintPrdFailureModes from './scripts/remark-lint-prd-failure-modes.mjs'

export default {
  plugins: [
    remarkPresetLintRecommended,
    remarkFrontmatter,
    remarkGfm,
    // Custom tx rules
    [remarkLintPrdRequiredFields, ['error']],
    [remarkLintDdTestingSections, ['error']],
    [remarkLintPrdFailureModes, ['warn']], // warn for now until existing PRDs are updated
  ]
}
