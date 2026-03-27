/**
 * @fileoverview Enforce structured CLI error handling in agent-facing CLI files.
 *
 * World-class CLI contracts need one canonical failure path so humans and
 * agents see consistent, actionable output. This rule bans the most common
 * ad hoc failure patterns in selected CLI entrypoints:
 *
 * - process.exit(...)
 * - console.error(...)
 * - throw new CliExitError(...)
 * - Effect.fail(new CliExitError(...))
 *
 * Those files should throw a shared CliUserError instead and let the top-level
 * runner render text or JSON consistently.
 */

import path from "path";

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

function matchesConfiguredRoot(filePath, roots) {
  return roots.some((root) => filePath.startsWith(root));
}

function isIdentifier(node, name) {
  return node?.type === "Identifier" && node.name === name;
}

function isMember(node, objectName, propertyName) {
  return node?.type === "MemberExpression"
    && !node.computed
    && isIdentifier(node.object, objectName)
    && isIdentifier(node.property, propertyName);
}

function isProcessExitCall(node) {
  return isMember(node?.callee, "process", "exit");
}

function isConsoleErrorCall(node) {
  return isMember(node?.callee, "console", "error");
}

function isCliExitNewExpression(node) {
  return node?.type === "NewExpression"
    && isIdentifier(node.callee, "CliExitError");
}

function isEffectFailCliExit(node) {
  return isMember(node?.callee, "Effect", "fail")
    && node.arguments?.length > 0
    && isCliExitNewExpression(node.arguments[0]);
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow ad hoc CLI stderr/exit handling in agent-facing CLI files",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      noProcessExit: "Use shared CLI error helpers and let the top-level runner set exit status instead of calling process.exit() here.",
      noConsoleError: "Do not write ad hoc console.error() output in agent-facing CLI files. Throw a CliUserError so text and --json failures stay consistent.",
      noBareCliExit: "Do not use bare CliExitError in agent-facing CLI files. Throw a CliUserError with a message, hint, and usage instead.",
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
          enforceRoots: {
            type: "array",
            items: { type: "string" },
            description: "Path prefixes where the rule is enforced",
          },
          extraPaths: {
            type: "array",
            items: { type: "string" },
            description: "Additional exact/substring paths to enforce outside the configured roots",
          },
          ignorePaths: {
            type: "array",
            items: { type: "string" },
            description: "Path substrings to exclude from enforcement",
          },
          allowProcessExitPaths: {
            type: "array",
            items: { type: "string" },
            description: "Path substrings where process.exit() is allowed",
          },
          allowConsoleErrorPaths: {
            type: "array",
            items: { type: "string" },
            description: "Path substrings where console.error() is allowed",
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const enforcePaths = options.enforcePaths || [];
    const enforceRoots = options.enforceRoots || [];
    const extraPaths = options.extraPaths || [];
    const ignorePaths = options.ignorePaths || [];
    const allowProcessExitPaths = options.allowProcessExitPaths || [];
    const allowConsoleErrorPaths = options.allowConsoleErrorPaths || [];

    const filename = context.filename || context.getFilename();
    const cwd = context.cwd || context.getCwd?.() || process.cwd();
    const relPath = normalizeFilePath(filename, cwd);
    if (matchesConfiguredPath(relPath, DEFAULT_EXCLUDED_PATTERNS)) {
      return {};
    }

    const matchesExplicitPath = enforcePaths.length > 0 && matchesConfiguredPath(relPath, enforcePaths);
    const matchesRoot = enforceRoots.length > 0 && matchesConfiguredRoot(relPath, enforceRoots);
    const matchesExtraPath = extraPaths.length > 0 && matchesConfiguredPath(relPath, extraPaths);
    const isIgnored = ignorePaths.length > 0 && matchesConfiguredPath(relPath, ignorePaths);

    if ((!matchesExplicitPath && !matchesRoot && !matchesExtraPath) || isIgnored) {
      return {};
    }

    return {
      CallExpression(node) {
        if (isProcessExitCall(node) && !matchesConfiguredPath(relPath, allowProcessExitPaths)) {
          context.report({ node, messageId: "noProcessExit" });
        }

        if (isConsoleErrorCall(node) && !matchesConfiguredPath(relPath, allowConsoleErrorPaths)) {
          context.report({ node, messageId: "noConsoleError" });
        }

        if (isEffectFailCliExit(node)) {
          context.report({ node, messageId: "noBareCliExit" });
        }
      },

      ThrowStatement(node) {
        if (isCliExitNewExpression(node.argument)) {
          context.report({ node, messageId: "noBareCliExit" });
        }
      },
    };
  },
};
