import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const MCP_TOOLS_DIR = join(CURRENT_DIR, "..", "..", "mcp-server", "src", "tools");

const REGISTRATION_PATTERNS = [
  /registerEffectTool\s*\(\s*server\s*,/g,
  /\bserver\.tool\s*\(/g,
] as const;

const isToolSourceFile = (name: string): boolean =>
  name.endsWith(".ts") && name !== "effect-schema-tool.ts" && name !== "index.ts";

let cachedToolCount: number | undefined;

export const getMcpToolCount = (): number => {
  if (cachedToolCount !== undefined) return cachedToolCount;

  const files = readdirSync(MCP_TOOLS_DIR).filter(isToolSourceFile);

  cachedToolCount = files.reduce((count, file) => {
    const source = readFileSync(join(MCP_TOOLS_DIR, file), "utf8");
    const registrations = REGISTRATION_PATTERNS.reduce((sum, pattern) => {
      return sum + (source.match(pattern)?.length ?? 0);
    }, 0);

    return count + registrations;
  }, 0);

  return cachedToolCount;
};
