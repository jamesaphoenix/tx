import { describe, it, expect } from "vitest";
import rule from "../rules/require-cli-user-errors.js";

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

const baseOptions = [{
  enforceRoots: ["apps/cli/src/commands/"],
  extraPaths: ["apps/cli/src/utils/parse.ts"],
  ignorePaths: ["apps/cli/src/commands/task.ts"],
}];

describe("require-cli-user-errors rule", () => {
  it("skips files outside configured roots and extra paths", () => {
    const context = createContext("/project/apps/cli/src/commands/task.ts", baseOptions);
    const visitor = rule.create(context);
    expect(Object.keys(visitor)).toHaveLength(0);
  });

  it("enforces automatically for new files under the command root", () => {
    const context = createContext("/project/apps/cli/src/commands/new-command.ts", baseOptions);
    const visitor = rule.create(context);
    expect(typeof visitor.CallExpression).toBe("function");
  });

  it("flags process.exit in enforced files", () => {
    const context = createContext("/project/apps/cli/src/commands/sync.ts", baseOptions);
    const visitor = rule.create(context);

    visitor.CallExpression({
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        computed: false,
        object: { type: "Identifier", name: "process" },
        property: { type: "Identifier", name: "exit" },
      },
      arguments: [{ type: "Literal", value: 1 }],
    });

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].messageId).toBe("noProcessExit");
  });

  it("flags console.error in enforced files", () => {
    const context = createContext("/project/apps/cli/src/commands/skills.ts", baseOptions);
    const visitor = rule.create(context);

    visitor.CallExpression({
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        computed: false,
        object: { type: "Identifier", name: "console" },
        property: { type: "Identifier", name: "error" },
      },
      arguments: [{ type: "Literal", value: "bad" }],
    });

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].messageId).toBe("noConsoleError");
  });

  it("flags throw new CliExitError", () => {
    const context = createContext("/project/apps/cli/src/utils/parse.ts", baseOptions);
    const visitor = rule.create(context);

    visitor.ThrowStatement({
      type: "ThrowStatement",
      argument: {
        type: "NewExpression",
        callee: { type: "Identifier", name: "CliExitError" },
        arguments: [{ type: "Literal", value: 1 }],
      },
    });

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].messageId).toBe("noBareCliExit");
  });

  it("flags Effect.fail(new CliExitError(...))", () => {
    const context = createContext("/project/apps/cli/src/commands/auto.ts", baseOptions);
    const visitor = rule.create(context);

    visitor.CallExpression({
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        computed: false,
        object: { type: "Identifier", name: "Effect" },
        property: { type: "Identifier", name: "fail" },
      },
      arguments: [
        {
          type: "NewExpression",
          callee: { type: "Identifier", name: "CliExitError" },
          arguments: [{ type: "Literal", value: 1 }],
        },
      ],
    });

    expect(context._messages).toHaveLength(1);
    expect(context._messages[0].messageId).toBe("noBareCliExit");
  });

  it("skips test files under the command root", () => {
    const context = createContext("/project/apps/cli/src/commands/dashboard.test.ts", baseOptions);
    const visitor = rule.create(context);
    expect(Object.keys(visitor)).toHaveLength(0);
  });

  it("allows process.exit in explicitly allowed files", () => {
    const context = createContext("/project/apps/cli/src/cli.ts", [{
      ...baseOptions[0],
      extraPaths: [...baseOptions[0].extraPaths, "apps/cli/src/cli.ts"],
      allowProcessExitPaths: ["apps/cli/src/cli.ts"],
    }]);
    const visitor = rule.create(context);

    visitor.CallExpression({
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        computed: false,
        object: { type: "Identifier", name: "process" },
        property: { type: "Identifier", name: "exit" },
      },
      arguments: [{ type: "Literal", value: 1 }],
    });

    expect(context._messages).toHaveLength(0);
  });
});
