import { describe, it, expect, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  listTomlSections,
  readTxConfig,
  writeDashboardDefaultTaskAssigmentType,
  scaffoldConfigToml,
  DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY,
} from "@jamesaphoenix/tx";

const tempDirs: string[] = [];

// Built-in spec-type defaults, read from a directory with no config file.
// Keeping these derived (rather than duplicated) keeps the round-trip
// assertions meaningful: the scaffolded TOML must parse back to these exact
// values.
const NO_CONFIG_DEFAULTS = readTxConfig(mkdtempSync(join(tmpdir(), "tx-toml-defaults-")));
const BUILTIN_SPEC_TYPES = NO_CONFIG_DEFAULTS.spec.types;
const BUILTIN_LINT_MESSAGES = NO_CONFIG_DEFAULTS.spec.lintMessages;

const DEFAULTS = {
  docs: { path: "specs" },
  spec: {
    testPatterns: [
      "test/**/*.test.{ts,js,tsx,jsx}",
      "tests/**/*.py",
      "**/*_test.go",
      "**/*_test.rs",
      "**/test_*.py",
      "**/*.spec.{ts,js,tsx,jsx}",
      "**/Test*.java",
      "**/*Test.java",
      "**/*_spec.rb",
      "**/*.test.{c,cpp,cc}",
      "**/*_test.{c,cpp,cc}",
    ],
    designDocMissingTaskLinks: "always",
    // Section definitions are large and are asserted structurally below; reuse
    // the values readTxConfig produces for a project with no config file.
    types: BUILTIN_SPEC_TYPES,
    lintMessages: BUILTIN_LINT_MESSAGES,
  },
  memory: { defaultDir: "specs" },
  cycles: { scanPrompt: null, agents: 3, model: "claude-opus-4-6" },
  dashboard: {
    defaultTaskAssigmentType: "human",
    defaultTaskView: "list",
    cycles: {
      cycleLengthDays: 7,
      cycleStartDay: "monday",
      carryStatuses: ["planning", "active", "blocked", "review", "needs_review"],
    },
  },
  pins: { targetFiles: ["CLAUDE.md", "AGENTS.md"], blockAgentDoneWhenTaskIdPresent: true },
  guard: {
    mode: "advisory",
    maxPending: null,
    maxChildren: null,
    maxDepth: null,
  },
  verify: { timeout: 300, defaultSchema: null },
  reflect: {
    provider: "auto",
    model: null,
    defaultSessions: 10,
    includeTranscripts: false,
  },
  reviews: {
    designDocs: {
      enabled: false,
      runtime: "pi",
      transport: "rpc",
      template: "double-check",
      blocking: false,
      createFollowupTasks: true,
      retriggerOnTaskReopen: true,
    },
  },
} as const;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tx-toml-config-"));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(cwd: string, content: string): void {
  const path = join(cwd, ".tx", "config.toml");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("toml-config", () => {
  it("[INV-SPECCFG-001] returns defaults when config is missing", () => {
    const cwd = makeTempDir();
    const config = readTxConfig(cwd);
    expect(config).toEqual(DEFAULTS);
  });

  it("[INV-SPECCFG-009] returns defaults when config exists but cannot be read", () => {
    const cwd = makeTempDir();
    const invalidPath = join(cwd, ".tx", "config.toml");
    mkdirSync(invalidPath, { recursive: true });

    const config = readTxConfig(cwd);
    expect(config).toEqual(DEFAULTS);
  });

  it("parses dashboard assignment type from canonical key", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      ["[dashboard]", `${DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY} = "agent"`].join(
        "\n",
      ),
    );

    const parsed = readTxConfig(cwd);
    expect(parsed.dashboard.defaultTaskAssigmentType).toBe("agent");
  });

  it("defaults dashboard assignment when [dashboard] section is absent", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      ["[docs]", 'path = "custom/docs"', "", "[cycles]", "agents = 7"].join(
        "\n",
      ),
    );

    const parsed = readTxConfig(cwd);
    expect(parsed.docs.path).toBe("custom/docs");
    expect(parsed.cycles.agents).toBe(7);
    expect(parsed.dashboard.defaultTaskAssigmentType).toBe("human");
  });

  it("ignores unknown keys in docs section gracefully", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      ["[docs]", 'path = "specs"', "require_ears = false"].join("\n"),
    );

    const parsed = readTxConfig(cwd);
    // require_ears is no longer a config option (EARS is always mandatory)
    expect(parsed.docs.path).toBe("specs");
  });

  it("writes dashboard default assignment type to config.toml", () => {
    const cwd = makeTempDir();

    const updated = writeDashboardDefaultTaskAssigmentType("agent", cwd);
    expect(updated.dashboard.defaultTaskAssigmentType).toBe("agent");

    const raw = readFileSync(join(cwd, ".tx", "config.toml"), "utf8");
    expect(raw).toContain("[dashboard]");
    expect(raw).toContain(`${DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY} = "agent"`);
  });

  it("patches existing dashboard key and preserves unrelated sections", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      [
        "# keep file header",
        "[docs]",
        'path = "custom/docs"',
        "",
        "[dashboard]",
        "# keep dashboard comment",
        'default_task_assigment_type = "human"',
        'ui_mode = "compact"',
        "",
        "[cycles]",
        'model = "claude-opus-4-6"',
      ].join("\n"),
    );

    writeDashboardDefaultTaskAssigmentType("agent", cwd);

    const raw = readFileSync(join(cwd, ".tx", "config.toml"), "utf8");
    expect(raw).toContain("# keep file header");
    expect(raw).toContain("# keep dashboard comment");
    expect(raw).toContain('[docs]\npath = "custom/docs"');
    expect(raw).toContain('ui_mode = "compact"');
    expect(raw).toContain('[cycles]\nmodel = "claude-opus-4-6"');
    expect(raw).toContain('default_task_assigment_type = "agent"');
  });

  it("falls back to human when dashboard assignment type is invalid", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      ["[dashboard]", 'default_task_assigment_type = "bot"'].join("\n"),
    );

    const parsed = readTxConfig(cwd);
    expect(parsed.dashboard.defaultTaskAssigmentType).toBe("human");
  });

  it("ignores non-canonical dashboard key names", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      ["[dashboard]", 'default_task_assignment_type = "agent"'].join("\n"),
    );

    const parsed = readTxConfig(cwd);
    expect(parsed.dashboard.defaultTaskAssigmentType).toBe("human");
  });

  it("parses memory default_dir from config", () => {
    const cwd = makeTempDir();
    writeConfig(cwd, ["[memory]", 'default_dir = "knowledge"'].join("\n"));

    const parsed = readTxConfig(cwd);
    expect(parsed.memory.defaultDir).toBe("knowledge");
  });

  it("parses [spec] test_patterns array", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      [
        "[spec]",
        "test_patterns = [",
        '  "tests/**/*.py",',
        '  "**/*_test.go",',
        "]",
      ].join("\n"),
    );

    const parsed = readTxConfig(cwd);
    expect(parsed.spec.testPatterns).toEqual(["tests/**/*.py", "**/*_test.go"]);
    expect(parsed.spec.designDocMissingTaskLinks).toBe("always");
  });

  it("parses [spec] design_doc_missing_task_links", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      ["[spec]", 'design_doc_missing_task_links = "never"'].join("\n"),
    );

    const parsed = readTxConfig(cwd);
    expect(parsed.spec.designDocMissingTaskLinks).toBe("never");
  });

  it("falls back to always when design_doc_missing_task_links is invalid", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      ["[spec]", 'design_doc_missing_task_links = "off"'].join("\n"),
    );

    const parsed = readTxConfig(cwd);
    expect(parsed.spec.designDocMissingTaskLinks).toBe("always");
  });

  it("defaults memory default_dir to docs when section is absent", () => {
    const cwd = makeTempDir();
    writeConfig(cwd, ["[docs]", 'path = "specs"'].join("\n"));

    const parsed = readTxConfig(cwd);
    expect(parsed.memory.defaultDir).toBe("specs");
  });

  it("parses pins target_files as comma-separated list", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      ["[pins]", 'target_files = "CLAUDE.md, AGENTS.md"'].join("\n"),
    );

    const parsed = readTxConfig(cwd);
    expect(parsed.pins.targetFiles).toEqual(["CLAUDE.md", "AGENTS.md"]);
    expect(parsed.pins.blockAgentDoneWhenTaskIdPresent).toBe(true);
  });

  it("parses pins block_agent_done_when_task_id_present override", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      ["[pins]", "block_agent_done_when_task_id_present = false"].join("\n"),
    );

    const parsed = readTxConfig(cwd);
    expect(parsed.pins.targetFiles).toEqual(["CLAUDE.md", "AGENTS.md"]);
    expect(parsed.pins.blockAgentDoneWhenTaskIdPresent).toBe(false);
  });

  it("defaults pins target_files to CLAUDE.md and AGENTS.md when section is absent", () => {
    const cwd = makeTempDir();
    writeConfig(cwd, ["[docs]", 'path = "specs"'].join("\n"));

    const parsed = readTxConfig(cwd);
    expect(parsed.pins.targetFiles).toEqual(["CLAUDE.md", "AGENTS.md"]);
  });

  it("parses single pin target file", () => {
    const cwd = makeTempDir();
    writeConfig(cwd, ["[pins]", 'target_files = "AGENTS.md"'].join("\n"));

    const parsed = readTxConfig(cwd);
    expect(parsed.pins.targetFiles).toEqual(["AGENTS.md"]);
  });
});

describe("scaffoldConfigToml", () => {
  it("creates config.toml with annotated defaults", () => {
    const cwd = makeTempDir();
    mkdirSync(join(cwd, ".tx"), { recursive: true });

    const created = scaffoldConfigToml(cwd);
    expect(created).toBe(true);

    const raw = readFileSync(join(cwd, ".tx", "config.toml"), "utf8");
    // Check header
    expect(raw).toContain("# tx configuration");
    expect(raw).toContain("https://txdocs.dev/docs");
    // Check all sections exist with doc links
    expect(raw).toContain("[docs]");
    expect(raw).toContain("https://txdocs.dev/docs/primitives/docs");
    expect(raw).toContain("EARS (Easy Approach to Requirements Syntax) is mandatory");
    expect(raw).toContain("[spec]");
    expect(raw).toContain("tx spec discover");
    expect(raw).toContain("[memory]");
    expect(raw).toContain("https://txdocs.dev/docs/primitives/memory");
    expect(raw).toContain('default_dir = "specs"');
    expect(raw).toContain("[cycles]");
    expect(raw).toContain("https://txdocs.dev/docs/headful/docs-runs-cycles");
    expect(raw).toContain("[dashboard]");
    expect(raw).toContain(
      "https://txdocs.dev/docs/headful/filters-and-settings",
    );
    expect(raw).toContain("[pins]");
    expect(raw).toContain("https://txdocs.dev/docs/primitives/pin");
    // Check defaults are set
    expect(raw).toContain('path = "specs"');
    expect(raw).toContain("test_patterns = [");
    expect(raw).toContain('design_doc_missing_task_links = "always"');
    expect(raw).toContain("agents = 3");
    expect(raw).toContain('model = "claude-opus-4-6"');
    expect(raw).toContain('default_task_assigment_type = "human"');
    expect(raw).toContain('target_files = "CLAUDE.md, AGENTS.md"');
    expect(raw).toContain("block_agent_done_when_task_id_present = true");
    // Bounded autonomy sections
    expect(raw).toContain("[guard]");
    expect(raw).toContain('mode = "advisory"');
    expect(raw).toContain("[verify]");
    expect(raw).toContain("timeout = 300");
    expect(raw).toContain("[reflect]");
    expect(raw).toContain('provider = "auto"');
    expect(raw).toContain("default_sessions = 10");
  });

  it("is a no-op when config.toml already exists", () => {
    const cwd = makeTempDir();
    writeConfig(cwd, '# custom config\n[docs]\npath = "custom"\n');

    const created = scaffoldConfigToml(cwd);
    expect(created).toBe(false);

    const raw = readFileSync(join(cwd, ".tx", "config.toml"), "utf8");
    expect(raw).toContain("# custom config");
    expect(raw).toContain('path = "custom"');
  });

  it("creates .tx directory if it does not exist", () => {
    const cwd = makeTempDir();

    scaffoldConfigToml(cwd);
    expect(existsSync(join(cwd, ".tx", "config.toml"))).toBe(true);
  });

  it("[INV-SPECCFG-002] produces a file that readTxConfig parses correctly", () => {
    const cwd = makeTempDir();
    scaffoldConfigToml(cwd);

    const config = readTxConfig(cwd);
    expect(config).toEqual(DEFAULTS);
  });
});

describe("listTomlSections", () => {
  it("lists sections matching a prefix in file order", () => {
    const toml = [
      "[docs]",
      'path = "specs"',
      "[spec.types.prd]",
      'severity = "error"',
      "[spec.types.prd.section.summary]",
      'heading = "Summary"',
      "[spec.types.rfc]",
      "[dashboard]",
    ].join("\n");

    expect(listTomlSections(toml, "spec.types")).toEqual([
      "spec.types.prd",
      "spec.types.prd.section.summary",
      "spec.types.rfc",
    ]);
  });

  it("ignores trailing comments, indentation, and duplicates", () => {
    const toml = [
      "  [spec.types.prd]   # the PRD type",
      "[spec.types.prd]",
      "[other]",
    ].join("\n");

    expect(listTomlSections(toml, "spec.types")).toEqual(["spec.types.prd"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(listTomlSections("[docs]\npath = \"specs\"\n", "spec.types")).toEqual([]);
  });

  it("does not match a prefix that is only a partial name segment", () => {
    expect(listTomlSections("[spec.typesetting]\n", "spec.types")).toEqual([]);
  });
});

describe("spec type configuration", () => {
  it("ships built-in types with headings, descriptions, and severities", () => {
    const config = readTxConfig(makeTempDir());

    expect(Object.keys(config.spec.types).sort()).toEqual([
      "decision",
      "design",
      "overview",
      "prd",
      "runbook",
    ]);
    expect(config.spec.types.prd.sections.map((s) => s.heading)).toEqual([
      "Summary",
      "Problem",
      "Scope",
      "Requirements",
      "Acceptance Criteria",
    ]);
    expect(config.spec.types.prd.severity).toBe("error");
    // overview docs live at the docs root
    expect(config.spec.types.overview.subdir).toBe("");
    for (const section of config.spec.types.design.sections) {
      expect(section.description.length).toBeGreaterThan(0);
    }
  });

  it("parses per-section tables with heading, description, and message", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      [
        "[spec.types.rfc]",
        'severity = "warn"',
        'subdir = "rfc"',
        "",
        "[spec.types.rfc.section.summary]",
        'description = "What this proposes."',
        "",
        "[spec.types.rfc.section.open-questions]",
        'message = "{name}: add {section}"',
        "",
      ].join("\n"),
    );

    const rfc = readTxConfig(cwd).spec.types.rfc;
    expect(rfc.severity).toBe("warn");
    expect(rfc.subdir).toBe("rfc");
    expect(rfc.sections).toEqual([
      { slug: "summary", heading: "Summary", description: "What this proposes.", message: null },
      // heading falls back to the title-cased slug
      { slug: "open-questions", heading: "Open Questions", description: "", message: "{name}: add {section}" },
    ]);
  });

  it("accepts the sections array shorthand", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      ["[spec.types.rfc]", 'sections = ["Summary", "Motivation"]', ""].join("\n"),
    );

    const rfc = readTxConfig(cwd).spec.types.rfc;
    expect(rfc.sections.map((s) => s.heading)).toEqual(["Summary", "Motivation"]);
    expect(rfc.sections.map((s) => s.slug)).toEqual(["summary", "motivation"]);
    expect(rfc.severity).toBe("error");
    // subdir defaults to the type name at registry-resolution time
    expect(rfc.subdir).toBeNull();
  });

  it("prefers per-section tables over the array shorthand", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      [
        "[spec.types.rfc]",
        'sections = ["Ignored"]',
        "",
        "[spec.types.rfc.section.summary]",
        'description = "Wins."',
        "",
      ].join("\n"),
    );

    expect(readTxConfig(cwd).spec.types.rfc.sections.map((s) => s.heading)).toEqual([
      "Summary",
    ]);
  });

  it("overrides a built-in type's sections while keeping other built-ins", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      [
        "[spec.types.prd]",
        'sections = ["Summary", "Why Now"]',
        "",
      ].join("\n"),
    );

    const config = readTxConfig(cwd);
    expect(config.spec.types.prd.sections.map((s) => s.heading)).toEqual([
      "Summary",
      "Why Now",
    ]);
    expect(config.spec.types.design.sections).toEqual(BUILTIN_SPEC_TYPES.design.sections);
  });

  it("keeps built-in sections when a type declares only severity", () => {
    const cwd = makeTempDir();
    writeConfig(cwd, ['[spec.types.prd]', 'severity = "off"', ""].join("\n"));

    const prd = readTxConfig(cwd).spec.types.prd;
    expect(prd.severity).toBe("off");
    expect(prd.sections).toEqual(BUILTIN_SPEC_TYPES.prd.sections);
  });

  it("falls back to the default severity when the value is invalid", () => {
    const cwd = makeTempDir();
    writeConfig(cwd, ['[spec.types.prd]', 'severity = "loud"', ""].join("\n"));

    expect(readTxConfig(cwd).spec.types.prd.severity).toBe("error");
  });

  it("skips type names that are not valid identifiers", () => {
    const cwd = makeTempDir();
    writeConfig(cwd, ['[spec.types.Not Valid]', 'severity = "warn"', ""].join("\n"));

    expect(readTxConfig(cwd).spec.types["Not Valid"]).toBeUndefined();
    expect(Object.keys(readTxConfig(cwd).spec.types).sort()).toEqual(
      Object.keys(BUILTIN_SPEC_TYPES).sort(),
    );
  });

  it("reads global lint message overrides", () => {
    const cwd = makeTempDir();
    writeConfig(
      cwd,
      [
        "[spec.lint.messages]",
        'missing_section = "custom {section}"',
        "",
      ].join("\n"),
    );

    const messages = readTxConfig(cwd).spec.lintMessages;
    expect(messages.missing_section).toBe("custom {section}");
    // untouched keys keep their defaults
    expect(messages.unknown_spec_type).toBe(BUILTIN_LINT_MESSAGES.unknown_spec_type);
  });

  it("keeps [spec] scalar keys readable alongside [spec.types.*] subtables", () => {
    const cwd = makeTempDir();
    scaffoldConfigToml(cwd);

    const config = readTxConfig(cwd);
    expect(config.spec.designDocMissingTaskLinks).toBe("always");
    expect(config.spec.testPatterns.length).toBe(11);
    expect(config.memory.defaultDir).toBe("specs");
  });
});
