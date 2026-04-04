/**
 * @fileoverview Enforce that registered CLI commands have discoverable help.
 *
 * Agent-friendly CLIs cannot rely on tribal knowledge. Any command that is
 * reachable from the top-level registry must also exist in commandHelp so:
 *
 * - tx help <command> works
 * - tx help --json exposes the command
 * - tx schema <command> can be derived from the same source of truth
 *
 * The rule inspects the commands registry programmatically rather than relying
 * on a hardcoded command list. Deprecated aliases routed through
 * deprecatedAlias(...) are excluded.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_EXCLUDED_PATTERNS = [
  ".test.",
  ".spec.",
  "__tests__/",
];

function normalizeFilePath(filename, cwd) {
  return path.relative(cwd, filename).replace(/\\/g, "/");
}

function matchesConfiguredPath(filePath, patterns) {
  return patterns.some((pattern) => filePath.includes(pattern));
}

function getStaticPropertyName(node) {
  if (!node || node.type !== "Property" || node.computed) {
    return null;
  }
  if (node.key.type === "Identifier") {
    return node.key.name;
  }
  if (node.key.type === "Literal" && typeof node.key.value === "string") {
    return node.key.value;
  }
  return null;
}

function isDeprecatedAliasCall(node) {
  return node?.type === "CallExpression"
    && node.callee?.type === "Identifier"
    && node.callee.name === "deprecatedAlias";
}

function parseHelpKeys(helpSourceText) {
  const keys = new Set();
  for (const match of helpSourceText.matchAll(/^\s{2}(?:"([^"]+)"|([A-Za-z0-9_-]+)):\s*`/gm)) {
    keys.add(match[1] || match[2]);
  }
  return keys;
}

function readHelpKeys(options, cwd) {
  if (typeof options.helpSourceText === "string") {
    return { helpKeys: parseHelpKeys(options.helpSourceText) };
  }

  if (typeof options.helpFile !== "string" || options.helpFile.length === 0) {
    return {
      error: "Missing required `helpFile` option for tx/require-cli-help-coverage.",
    };
  }

  try {
    const resolvedPath = path.resolve(cwd, options.helpFile);
    return {
      helpKeys: parseHelpKeys(readFileSync(resolvedPath, "utf8")),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: `Failed to read CLI help source '${options.helpFile}': ${message}`,
    };
  }
}

function findCommandsObject(programNode) {
  for (const statement of programNode.body ?? []) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declarations ?? []) {
      if (declaration.id?.type !== "Identifier" || declaration.id.name !== "commands") continue;
      if (declaration.init?.type === "ObjectExpression") {
        return declaration.init;
      }
    }
  }
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require commandHelp coverage for registered CLI commands",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      missingHelp: "Command '{{command}}' is registered in the top-level CLI registry but missing from commandHelp. Add a '{{command}}' entry to {{helpFile}} so `tx help` and `tx schema` can discover it.",
      helpFileUnreadable: "{{message}}",
    },
    schema: [
      {
        type: "object",
        properties: {
          enforcePaths: {
            type: "array",
            items: { type: "string" },
            description: "Path substrings where the rule is enforced",
          },
          helpFile: {
            type: "string",
            description: "Path to the CLI help source file",
          },
          helpSourceText: {
            type: "string",
            description: "Inline help source used for testing",
          },
          ignoreCommands: {
            type: "array",
            items: { type: "string" },
            description: "Registered commands that intentionally do not require commandHelp entries",
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const enforcePaths = options.enforcePaths || [];
    const ignoreCommands = new Set(options.ignoreCommands || []);

    const filename = context.filename || context.getFilename();
    const cwd = context.cwd || context.getCwd?.() || process.cwd();
    const relPath = normalizeFilePath(filename, cwd);

    if (matchesConfiguredPath(relPath, DEFAULT_EXCLUDED_PATTERNS)) {
      return {};
    }

    if (enforcePaths.length > 0 && !matchesConfiguredPath(relPath, enforcePaths)) {
      return {};
    }

    const helpResult = readHelpKeys(options, cwd);
    if (helpResult.error) {
      return {
        Program(node) {
          context.report({
            node,
            messageId: "helpFileUnreadable",
            data: { message: helpResult.error },
          });
        },
      };
    }

    const helpKeys = helpResult.helpKeys;
    return {
      Program(node) {
        const commandsObject = findCommandsObject(node);
        if (!commandsObject) {
          return;
        }

        for (const property of commandsObject.properties ?? []) {
          const command = getStaticPropertyName(property);
          if (!command) continue;
          if (ignoreCommands.has(command)) continue;
          if (command.includes(":")) continue;
          if (isDeprecatedAliasCall(property.value)) continue;
          if (helpKeys.has(command)) continue;

          context.report({
            node: property.key ?? property,
            messageId: "missingHelp",
            data: {
              command,
              helpFile: options.helpFile ?? "apps/cli/src/help.ts",
            },
          });
        }
      },
    };
  },
};
