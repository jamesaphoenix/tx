/**
 * @fileoverview Regression tests for import policy coverage in eslint.config.js
 */

import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, "../..")
const eslintConfigPath = path.join(projectRoot, "eslint.config.js")
const eslintConfig = fs.readFileSync(eslintConfigPath, "utf-8")

describe("eslint import policy coverage", () => {
  it("blocks bare fs imports and requires", () => {
    expect(eslintConfig).toContain("'no-restricted-imports': RESTRICTED_IMPORTS_RULE")
    expect(eslintConfig).toContain("'no-restricted-modules': RESTRICTED_MODULES_RULE")
  })

  it("blocks dynamic import() bypass for fs modules", () => {
    expect(eslintConfig).toContain("ImportExpression[source.type='Literal'][source.value='fs']")
    expect(eslintConfig).toContain("ImportExpression[source.type='Literal'][source.value='fs/promises']")
    expect(eslintConfig).toContain("ImportExpression[source.type='TemplateLiteral'][source.expressions.length=0][source.quasis.length=1][source.quasis.0.value.cooked='fs']")
    expect(eslintConfig).toContain("ImportExpression[source.type='TemplateLiteral'][source.expressions.length=0][source.quasis.length=1][source.quasis.0.value.cooked='fs/promises']")
    expect(eslintConfig).toContain("ImportExpression[source.type='TemplateLiteral'][source.expressions.length>0]")
    expect(eslintConfig).toContain("ImportExpression[source.type!='Literal'][source.type!='TemplateLiteral']")
    expect(eslintConfig).toContain("ImportExpression[source.type='Literal'][source.value='node:module']")
    expect(eslintConfig).toContain("ImportExpression[source.type='Literal'][source.value='module']")
  })

  it("blocks deep tx-core src imports including root src path", () => {
    expect(eslintConfig).toContain("'@jamesaphoenix/tx-core/src'")
    expect(eslintConfig).toContain("'@jamesaphoenix/tx-core/src/**'")
    expect(eslintConfig).toContain("'**/packages/core/src'")
    expect(eslintConfig).toContain("'**/packages/core/src/**'")
    expect(eslintConfig).toContain("source.value=/^@jamesaphoenix\\\\/tx-core\\\\/src(?:\\\\/|$)/")
  })

  it("blocks require aliasing to prevent restricted module bypass", () => {
    expect(eslintConfig).toContain("VariableDeclarator[init.type='Identifier'][init.name='require']")
    expect(eslintConfig).toContain("VariableDeclarator[init.type='Identifier'][init.name='module']")
    expect(eslintConfig).toContain("AssignmentExpression[right.type='Identifier'][right.name='require']")
    expect(eslintConfig).toContain("AssignmentExpression[right.type='Identifier'][right.name='module']")
    expect(eslintConfig).toContain("VariableDeclarator[init.type='MemberExpression'][init.object.type='Identifier'][init.object.name='module'][init.property.type='Identifier'][init.property.name='require']")
    expect(eslintConfig).toContain("VariableDeclarator[init.type='MemberExpression'][init.object.type='Identifier'][init.object.name='module'][init.computed=true][init.property.type='Literal'][init.property.value='require']")
    expect(eslintConfig).toContain("AssignmentExpression[right.type='MemberExpression'][right.object.type='Identifier'][right.object.name='module'][right.property.type='Identifier'][right.property.name='require']")
    expect(eslintConfig).toContain("AssignmentExpression[right.type='MemberExpression'][right.object.type='Identifier'][right.object.name='module'][right.computed=true][right.property.type='Literal'][right.property.value='require']")
    expect(eslintConfig).toContain("VariableDeclarator[id.type='ObjectPattern'][init.type='Identifier'][init.name='module']")
  })

  it("blocks module.require() bypasses for fs and deep tx-core src paths", () => {
    expect(eslintConfig).toContain("[callee.object.name='module']")
    expect(eslintConfig).toContain("[callee.property.name='require']")
    expect(eslintConfig).toContain('module.require("node:fs") instead of module.require("fs").')
    expect(eslintConfig).toContain('module.require("node:fs/promises") instead of module.require("fs/promises").')
    expect(eslintConfig).toContain('deep core/src module.require() paths')
    expect(eslintConfig).toContain('module["require"]("fs")')
    expect(eslintConfig).toContain("CallExpression[callee.type='SequenceExpression'][callee.expressions.length=2][callee.expressions.1.type='Identifier'][callee.expressions.1.name='require'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value='fs']")
    expect(eslintConfig).toContain("CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.property.type='Identifier'][callee.property.name='require'][arguments.length=1][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length>0]")
    expect(eslintConfig).toContain("CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='module'][callee.property.type='Identifier'][callee.property.name='require'][arguments.length=1][arguments.0.type!='Literal'][arguments.0.type!='TemplateLiteral']")
  })

  it("blocks createRequire() bypass vectors", () => {
    expect(eslintConfig).toContain("ImportSpecifier[imported.type='Identifier'][imported.name='createRequire']")
    expect(eslintConfig).toContain("ImportDeclaration[source.value='node:module'] > ImportNamespaceSpecifier")
    expect(eslintConfig).toContain("CallExpression[callee.type='Identifier'][callee.name='createRequire']")
    expect(eslintConfig).toContain("CallExpression[callee.type='MemberExpression'][callee.property.type='Identifier'][callee.property.name='createRequire']")
  })

  it("applies import restrictions to root tests and dashboard tsx block", () => {
    expect(eslintConfig).toContain("files: ['test/**/*.ts']")
    expect(eslintConfig).toContain("files: ['apps/dashboard/**/*.tsx', 'apps/dashboard/src/hooks/**/*.ts']")
  })
})
