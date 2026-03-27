import { describe, expect, it } from "vitest";
import rule from "../rules/require-cli-help-coverage.js";

function createContext(filename, options = []) {
  const messages = [];
  return {
    filename,
    cwd: "/project",
    options,
    sourceCode: {
      getText: () => "",
    },
    report: (info) => messages.push(info),
    _messages: messages,
  };
}

function property(command, value) {
  return {
    type: "Property",
    computed: false,
    key: { type: "Identifier", name: command },
    value,
  };
}

function identifier(name) {
  return {
    type: "Identifier",
    name,
  };
}

function callExpression(name) {
  return {
    type: "CallExpression",
    callee: identifier(name),
    arguments: [],
  };
}

function commandsProgram(properties) {
  return {
    type: "Program",
    body: [
      {
        type: "VariableDeclaration",
        declarations: [
          {
            type: "VariableDeclarator",
            id: identifier("commands"),
            init: {
              type: "ObjectExpression",
              properties,
            },
          },
        ],
      },
    ],
  };
}

const baseOptions = [{
  enforcePaths: ["apps/cli/src/cli.ts"],
  helpFile: "apps/cli/src/help.ts",
  helpSourceText: `
export const commandHelp: Record<string, string> = {
  init: \`tx init\`,
  ready: \`tx ready\`,
  schema: \`tx schema\`,
}
`,
  ignoreCommands: ["help"],
}];

describe("require-cli-help-coverage rule", () => {
  it("enforces the actual CLI entrypoint path", () => {
    const context = createContext("/project/apps/cli/src/cli.ts", baseOptions);
    const visitor = rule.create(context);
    expect(typeof visitor.Program).toBe("function");
  });

  it("skips files outside configured enforcement paths", () => {
    const context = createContext("/project/apps/cli/src/commands/task.ts", baseOptions);
    const visitor = rule.create(context);
    expect(Object.keys(visitor)).toHaveLength(0);
  });

  it("flags a registered command without a matching help entry", () => {
    const context = createContext("/project/apps/cli/src/cli.ts", baseOptions);
    const visitor = rule.create(context);

    visitor.Program(commandsProgram([
      property("ready", identifier("ready")),
      property("newCommand", identifier("newCommand")),
    ]));

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].messageId).toBe("missingHelp");
    expect(context._messages[0].data.command).toBe("newCommand");
  });

  it("ignores deprecated aliases and explicit ignoreCommands", () => {
    const context = createContext("/project/apps/cli/src/cli.ts", baseOptions);
    const visitor = rule.create(context);

    visitor.Program(commandsProgram([
      property("help", identifier("help")),
      property("block", callExpression("deprecatedAlias")),
      property("ack:all", callExpression("deprecatedAlias")),
      property("ready", identifier("ready")),
    ]));

    expect(context._messages).toHaveLength(0);
  });

  it("reports unreadable help sources when helpFile cannot be loaded", () => {
    const context = createContext("/project/apps/cli/src/cli.ts", [{
      enforcePaths: ["apps/cli/src/cli.ts"],
      helpFile: "apps/cli/src/does-not-exist.ts",
    }]);

    const visitor = rule.create(context);
    visitor.Program({ type: "Program", body: [] });

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].messageId).toBe("helpFileUnreadable");
  });
});
