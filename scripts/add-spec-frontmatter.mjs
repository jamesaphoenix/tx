#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, extname, join, relative, resolve } from "node:path"

const ROOT = resolve(process.cwd())
const SPECS_DIR = resolve(ROOT, "specs")
const LAST_REVIEWED_AT = "2026-03-15"

const SKIP_FILES = new Set(["specs/index.md", "specs/examples/README.md"])

const args = new Set(process.argv.slice(2))
const dryRun = args.has("--dry-run")

const files = listMarkdownFiles(SPECS_DIR)
const changed = []
const skippedHasFrontmatter = []
const skippedNonSpec = []

for (const filePath of files) {
  const relPath = relative(ROOT, filePath).replaceAll("\\", "/")
  if (SKIP_FILES.has(relPath)) {
    skippedNonSpec.push(relPath)
    continue
  }

  const content = readFileSync(filePath, "utf8")
  if (startsWithFrontmatter(content)) {
    skippedHasFrontmatter.push(relPath)
    continue
  }

  const fileName = basename(filePath)
  const name = fileName.slice(0, -extname(fileName).length)
  const specType = deriveSpecType(relPath, fileName)
  if (specType === null) {
    skippedNonSpec.push(relPath)
    continue
  }

  const title = deriveTitle(content, name)
  const frontmatter = buildFrontmatter({
    specType,
    name,
    title,
  })

  const nextContent = `${frontmatter}\n${content}`
  if (!dryRun) {
    writeFileSync(filePath, nextContent, "utf8")
  }
  changed.push(relPath)
}

const mode = dryRun ? "DRY-RUN" : "WRITE"
console.log(`[${mode}] updated: ${changed.length}`)
for (const file of changed) {
  console.log(`UPDATED: ${file}`)
}

console.log(`[${mode}] skipped_frontmatter: ${skippedHasFrontmatter.length}`)
console.log(`[${mode}] skipped_non_spec_or_explicit: ${skippedNonSpec.length}`)

function listMarkdownFiles(dirPath) {
  const out = []
  const entries = readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      out.push(...listMarkdownFiles(absolute))
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(absolute)
    }
  }
  return out.sort()
}

function startsWithFrontmatter(content) {
  return content.startsWith("---\n") || content.startsWith("---\r\n") || content.startsWith("\uFEFF---")
}

function deriveSpecType(relPath, fileName) {
  if (relPath.startsWith("specs/examples/") && fileName !== "README.md") {
    return "overview"
  }

  if (fileName === "FAILURE-MODES.md") {
    return "runbook"
  }

  if (/^DD-\d{3}-.*\.md$/i.test(fileName)) {
    return "design"
  }

  if (/^SD-\d{3}-.*\.md$/i.test(fileName)) {
    return "design"
  }

  if (/^PRD-\d{3}-.*\.md$/i.test(fileName)) {
    return "prd"
  }

  if (/^REQ-\d{3}-.*\.md$/i.test(fileName)) {
    return "prd"
  }

  return null
}

function deriveTitle(content, fallbackName) {
  const headingMatch = content.match(/^#\s+(.+?)\s*$/m)
  if (headingMatch && headingMatch[1]) {
    return headingMatch[1].trim()
  }
  return fallbackName
}

function buildFrontmatter({ specType, name, title }) {
  const escapedTitle = yamlDoubleQuoted(title)
  const escapedName = yamlDoubleQuoted(name)

  return [
    "---",
    "kind: spec",
    `spec_type: ${specType}`,
    `name: ${escapedName}`,
    `title: ${escapedTitle}`,
    "status: draft",
    "version: 1",
    `last_reviewed_at: "${LAST_REVIEWED_AT}"`,
    "---",
    "",
  ].join("\n")
}

function yamlDoubleQuoted(value) {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\t", "\\t")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
  return `"${escaped}"`
}
