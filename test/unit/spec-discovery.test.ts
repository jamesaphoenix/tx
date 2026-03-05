import { afterEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import {
  discoverSpecTests,
  readSpecManifest,
  defaultSpecTestPatterns,
} from "@jamesaphoenix/tx-core"

const tempDirs: string[] = []

const makeTempProject = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "tx-spec-discovery-"))
  tempDirs.push(dir)
  return dir
}

const writeRelative = (root: string, relativePath: string, content: string): void => {
  const absPath = join(root, relativePath)
  mkdirSync(dirname(absPath), { recursive: true })
  writeFileSync(absPath, content, "utf8")
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("spec-discovery", () => {
  it("discovers tags/comments/underscore refs across TypeScript, Python, and Go files", async () => {
    const root = makeTempProject()

    writeRelative(root, "test/spec/spec-discovery.test.ts", [
      "import { it } from \"vitest\"",
      "",
      "// @spec INV-DISC-002, INV-DISC-003",
      "/*",
      " * @spec INV-DISC-006",
      " */",
      "it(\"[INV-DISC-001] ts discovery\", () => {})",
    ].join("\n"))

    writeRelative(root, "tests/unit/test_spec_discovery.py", [
      "def test_python_discovery_INV_DISC_004():",
      "    assert True",
    ].join("\n"))

    writeRelative(root, "pkg/spec_discovery_test.go", [
      "package spec",
      "",
      "func TestGoDiscovery_INV_DISC_005(t *testing.T) {}",
    ].join("\n"))

    const result = await discoverSpecTests(root, [
      "test/**/*.test.ts",
      "tests/**/*.py",
      "**/*_test.go",
    ])

    const ids = new Set(result.discovered.map((row) => row.invariantId))

    expect(result.scannedFiles).toBe(3)
    expect(result.tagLinks).toBe(3)
    expect(result.commentLinks).toBe(3)
    expect(result.manifestLinks).toBe(0)
    expect(result.discovered).toHaveLength(6)

    expect(ids).toEqual(new Set([
      "INV-DISC-001",
      "INV-DISC-002",
      "INV-DISC-003",
      "INV-DISC-004",
      "INV-DISC-005",
      "INV-DISC-006",
    ]))

    expect(result.discovered.find((row) => row.invariantId === "INV-DISC-001")?.framework).toBe("vitest")
    expect(result.discovered.find((row) => row.invariantId === "INV-DISC-004")?.framework).toBe("pytest")
    expect(result.discovered.find((row) => row.invariantId === "INV-DISC-005")?.framework).toBe("go")
  })

  it("respects glob patterns and ignores non-matching files", async () => {
    const root = makeTempProject()

    writeRelative(root, "src/not-a-test.ts", [
      "const marker = \"[INV-IGNORE-001]\"",
    ].join("\n"))

    writeRelative(root, "test/top-level.test.ts", [
      "import { it } from \"vitest\"",
      "it(\"[INV-MATCH-002] top-level should match\", () => {})",
    ].join("\n"))

    writeRelative(root, "test/unit/only.test.ts", [
      "import { it } from \"vitest\"",
      "it(\"[INV-MATCH-001] only this should match\", () => {})",
    ].join("\n"))

    const result = await discoverSpecTests(root, ["test/**/*.test.ts"])
    const ids = result.discovered.map((row) => row.invariantId)

    expect(result.scannedFiles).toBe(2)
    expect(new Set(ids)).toEqual(new Set(["INV-MATCH-001", "INV-MATCH-002"]))
  })

  it("parses manifest mappings and ignores malformed entries", async () => {
    const root = makeTempProject()

    writeRelative(root, ".tx/spec-tests.yml", [
      "mappings:",
      "  - invariant: INV-MAN-001",
      "    tests:",
      "      - file: test/manifest-a.test.ts",
      "        name: from manifest",
      "        framework: vitest",
      "      - file: tests/test_manifest.py",
      "      - file: ../../outside/test.ts",
      "      - file: /abs/path/test.ts",
      "  - invariant: invalid-id",
      "    tests:",
      "      - file: test/ignored.test.ts",
      "  - invariant: INV-MAN-002",
      "    tests: not-an-array",
    ].join("\n"))

    const manifest = await readSpecManifest(root)
    const discovered = await discoverSpecTests(root, ["test/**/*.test.ts"])

    expect(manifest).toHaveLength(2)
    expect(manifest.every((row) => row.invariantId === "INV-MAN-001")).toBe(true)
    expect(manifest.every((row) => row.discovery === "manifest")).toBe(true)

    const byId = new Map(manifest.map((row) => [row.testId, row]))
    expect(byId.get("test/manifest-a.test.ts::from manifest")?.framework).toBe("vitest")
    expect(byId.get("tests/test_manifest.py::spec@line-1")?.framework).toBe("pytest")

    expect(discovered.scannedFiles).toBe(0)
    expect(discovered.tagLinks).toBe(0)
    expect(discovered.commentLinks).toBe(0)
    expect(discovered.manifestLinks).toBe(2)
    expect(discovered.discovered).toHaveLength(2)
  })

  it("handles malformed manifest YAML without crashing discovery", async () => {
    const root = makeTempProject()

    writeRelative(root, "test/unit/ok.test.ts", [
      "import { it } from \"vitest\"",
      "it(\"[INV-MALFORMED-001] fallback discovery\", () => {})",
    ].join("\n"))

    writeRelative(root, ".tx/spec-tests.yml", [
      "mappings:",
      "  - invariant: INV-BROKEN-001",
      "    tests:",
      "      - file: test/broken.test.ts",
      "        name: broken",
      "  - [",
    ].join("\n"))

    const result = await discoverSpecTests(root, ["test/**/*.test.ts"])

    expect(result.scannedFiles).toBe(1)
    expect(result.tagLinks).toBe(1)
    expect(result.commentLinks).toBe(0)
    expect(result.manifestLinks).toBe(0)
    expect(result.discovered).toHaveLength(1)
    expect(result.discovered[0]?.invariantId).toBe("INV-MALFORMED-001")
  })

  it("discovers @spec annotations across Rust/Java/Ruby/C test files", async () => {
    const root = makeTempProject()

    writeRelative(root, "src/lang/example_test.rs", [
      "// @spec INV-LANG-001",
      "fn test_rust_case() {}",
    ].join("\n"))

    writeRelative(root, "java/TestLang.java", [
      "// @spec INV-LANG-002",
      "public class TestLang {}",
    ].join("\n"))

    writeRelative(root, "ruby/example_spec.rb", [
      "# @spec INV-LANG-003",
      "describe 'lang spec' do; end",
    ].join("\n"))

    writeRelative(root, "c/example_test.c", [
      "// @spec INV-LANG-004",
      "void test_lang_case(void) {}",
    ].join("\n"))

    const result = await discoverSpecTests(root, [...defaultSpecTestPatterns()])
    const ids = new Set(result.discovered.map((row) => row.invariantId))

    expect(result.scannedFiles).toBe(4)
    expect(result.commentLinks).toBe(4)
    expect(result.tagLinks).toBe(0)
    expect(ids).toEqual(new Set([
      "INV-LANG-001",
      "INV-LANG-002",
      "INV-LANG-003",
      "INV-LANG-004",
    ]))
  })

  it("deduplicates repeated invariant/test pairs from file annotations and manifest", async () => {
    const root = makeTempProject()

    writeRelative(root, "test/unit/dup.test.ts", [
      "import { it } from \"vitest\"",
      "it(\"duplicate [INV-DUP-001]\", () => {})",
    ].join("\n"))

    writeRelative(root, ".tx/spec-tests.yml", [
      "mappings:",
      "  - invariant: INV-DUP-001",
      "    tests:",
      "      - file: test/unit/dup.test.ts",
      "        name: duplicate [INV-DUP-001]",
      "        framework: vitest",
    ].join("\n"))

    const result = await discoverSpecTests(root, ["test/**/*.test.ts"])

    expect(result.tagLinks).toBe(1)
    expect(result.manifestLinks).toBe(1)
    expect(result.discovered).toHaveLength(1)
    expect(result.discovered[0]?.invariantId).toBe("INV-DUP-001")
    expect(result.discovered[0]?.testId).toBe("test/unit/dup.test.ts::duplicate [INV-DUP-001]")
  })

  it("exposes stable default scan patterns", () => {
    const patterns = defaultSpecTestPatterns()

    expect(patterns).toContain("test/**/*.test.{ts,js,tsx,jsx}")
    expect(patterns).toContain("tests/**/*.py")
    expect(patterns).toContain("**/*_test.go")
    expect(patterns).toContain("**/*.spec.{ts,js,tsx,jsx}")
    expect(patterns).toContain("**/*_test.rs")
    expect(patterns).toContain("**/Test*.java")
    expect(patterns).toContain("**/*Test.java")
    expect(patterns).toContain("**/*_spec.rb")
    expect(patterns).toContain("**/*.test.{c,cpp,cc}")
    expect(patterns).toContain("**/*_test.{c,cpp,cc}")
  })
})
