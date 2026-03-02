/**
 * @fileoverview Enforce that services have all required interface implementations.
 *
 * This rule is config-driven: it uses a manifest that maps services to their
 * interface files (CLI, MCP, API, SDK). When a file belonging to a service is
 * linted, the rule checks that all required interface files exist on disk.
 *
 * Example config:
 *   "tx/require-interface-coverage": ["warn", {
 *     services: {
 *       tasks: {
 *         cli: "apps/cli/src/commands/task.ts",
 *         mcp: "apps/mcp-server/src/tools/task.ts",
 *         api: "apps/api-server/src/routes/tasks.ts",
 *         sdk: "apps/agent-sdk/src/client.ts",
 *         required: ["cli", "mcp", "api", "sdk"]
 *       }
 *     }
 *   }]
 *
 * @author tx
 */

import fs from "fs"
import path from "path"

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Ensure services have implementations across all required interfaces (CLI, MCP, REST, SDK)",
      category: "Interface Coverage",
      recommended: false,
    },
    schema: [
      {
        type: "object",
        properties: {
          services: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                cli: {
                  oneOf: [
                    { type: "string" },
                    { type: "array", items: { type: "string" } },
                  ],
                },
                mcp: {
                  oneOf: [
                    { type: "string" },
                    { type: "array", items: { type: "string" } },
                  ],
                },
                api: {
                  oneOf: [
                    { type: "string" },
                    { type: "array", items: { type: "string" } },
                  ],
                },
                sdk: {
                  oneOf: [
                    { type: "string" },
                    { type: "array", items: { type: "string" } },
                  ],
                },
                required: { type: "array", items: { type: "string" } },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingInterface:
        "Service '{{service}}' is missing {{interface}} interface (expected: {{expectedPath}})",
      missingInterfaces:
        "Service '{{service}}' is missing interfaces: {{interfaces}}",
    },
  },

  create(context) {
    const options = context.options[0] || {}
    const services = options.services || {}

    return {
      Program(node) {
        const currentFile = context.filename || context.getFilename()

        // Skip non-TS/JS files
        if (!/\.(ts|js|tsx|jsx)$/.test(currentFile)) return

        // Skip test files
        if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(currentFile)) return
        if (
          currentFile.includes("__tests__") ||
          currentFile.includes("/test/")
        )
          return

        for (const [serviceName, config] of Object.entries(services)) {
          const required = config.required || []
          if (required.length === 0) continue

          // Check if the current file is one of this service's interface files
          const isRelatedFile = ["cli", "mcp", "api", "sdk"].some((iface) => {
            const paths = Array.isArray(config[iface])
              ? config[iface]
              : config[iface]
                ? [config[iface]]
                : []
            return paths.some(
              (p) => currentFile.endsWith(p) || currentFile.includes(p)
            )
          })

          if (!isRelatedFile) continue

          // Check all required interfaces
          const missing = []
          for (const iface of required) {
            const paths = Array.isArray(config[iface])
              ? config[iface]
              : config[iface]
                ? [config[iface]]
                : []
            if (paths.length === 0) {
              missing.push(iface)
              continue
            }

            // Check if any of the specified paths exist
            const exists = paths.some((p) => {
              const fullPath = path.resolve(process.cwd(), p)
              return fs.existsSync(fullPath)
            })

            if (!exists) {
              missing.push(iface)
            }
          }

          if (missing.length > 0) {
            context.report({
              node,
              messageId: "missingInterfaces",
              data: {
                service: serviceName,
                interfaces: missing.join(", "),
              },
            })
          }
        }
      },
    }
  },
}
