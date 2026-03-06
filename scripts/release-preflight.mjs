#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { execSync } from "node:child_process"
import { join } from "node:path"

const root = process.cwd()
const targetVersion = process.argv[2]

const workspacePackagePaths = [
  "package.json",
  ...listPackageJsons("packages"),
  ...listPackageJsons("apps"),
]

const publishablePackages = workspacePackagePaths
  .filter((path) => path !== "package.json")
  .map((path) => ({ path, json: readJson(path) }))
  .filter(({ json }) => json.name?.startsWith("@jamesaphoenix/") && json.private !== true)

const allWorkspacePackages = workspacePackagePaths.map((path) => ({
  path,
  json: readJson(path),
}))

const errors = []
const notices = []

checkWorktree()
checkVersions()
checkPublishWorkflow()
checkPublishMetadata()

if (errors.length > 0) {
  console.error("release-preflight failed:")
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log("release-preflight passed")
for (const notice of notices) {
  console.log(`- ${notice}`)
}

function listPackageJsons(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${dir}/${entry.name}/package.json`)
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"))
}

function checkWorktree() {
  const status = execSync("git status --short", { cwd: root, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== "?? .tx/")

  if (status.length > 0) {
    errors.push(`working tree is not clean: ${status.join(", ")}`)
  } else {
    notices.push("working tree clean (ignoring local .tx/)")
  }
}

function checkVersions() {
  const versionMap = new Map()

  for (const { path, json } of allWorkspacePackages) {
    versionMap.set(path, json.version)
  }

  const uniqueVersions = new Set(versionMap.values())
  if (uniqueVersions.size !== 1) {
    errors.push(
      `workspace versions are not lockstep: ${Array.from(versionMap.entries())
        .map(([path, version]) => `${path}=${version}`)
        .join(", ")}`
    )
    return
  }

  const [workspaceVersion] = uniqueVersions
  if (targetVersion && workspaceVersion !== targetVersion) {
    errors.push(`workspace version ${workspaceVersion} does not match requested ${targetVersion}`)
  } else {
    notices.push(`workspace version ${workspaceVersion}`)
  }
}

function checkPublishWorkflow() {
  const workflow = readFileSync(join(root, ".github/workflows/publish.yml"), "utf8")
  const publishedDirs = [...workflow.matchAll(/working-directory:\s*([^\n]+)/g)].map((match) =>
    match[1].trim()
  )
  const expectedDirs = publishablePackages.map(({ path }) => path.replace(/\/package\.json$/, ""))

  const missing = expectedDirs.filter((dir) => !publishedDirs.includes(dir))
  const extra = publishedDirs.filter((dir) => !expectedDirs.includes(dir))

  if (missing.length > 0) {
    errors.push(`publish workflow missing package directories: ${missing.join(", ")}`)
  }
  if (extra.length > 0) {
    errors.push(`publish workflow has unexpected package directories: ${extra.join(", ")}`)
  }

  if (missing.length === 0 && extra.length === 0) {
    notices.push(`publish workflow covers ${expectedDirs.length} publishable packages`)
  }
}

function checkPublishMetadata() {
  for (const { path, json } of publishablePackages) {
    const dir = path.replace(/\/package\.json$/, "")
    const problems = []

    if (!json.repository?.url) {
      problems.push("missing repository.url")
    }
    if (!json.repository?.directory) {
      problems.push("missing repository.directory")
    }
    if (!json.author) {
      problems.push("missing author")
    }
    if (!json.license) {
      problems.push("missing license")
    }
    if (!existsSync(join(root, dir, "README.md"))) {
      problems.push("missing README.md")
    }

    if (problems.length > 0) {
      errors.push(`${dir}: ${problems.join(", ")}`)
    }
  }
}
