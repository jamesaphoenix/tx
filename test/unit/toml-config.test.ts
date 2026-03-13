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
  readTxConfig,
  writeDashboardDefaultTaskAssigmentType,
  scaffoldConfigToml,
  DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY,
} from "@jamesaphoenix/tx-core";

const tempDirs: string[] = [];
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
  },
  memory: { defaultDir: "specs" },
  cycles: { scanPrompt: null, agents: 3, model: "claude-opus-4-6" },
  dashboard: { defaultTaskAssigmentType: "human" },
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
  it("returns defaults when config is missing", () => {
    const cwd = makeTempDir();
    const config = readTxConfig(cwd);
    expect(config).toEqual(DEFAULTS);
  });

  it("returns defaults when config exists but cannot be read", () => {
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

  it("produces a file that readTxConfig parses correctly", () => {
    const cwd = makeTempDir();
    scaffoldConfigToml(cwd);

    const config = readTxConfig(cwd);
    expect(config).toEqual(DEFAULTS);
  });
});
