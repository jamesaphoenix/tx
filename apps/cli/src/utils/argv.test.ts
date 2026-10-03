import {describe, expect, it} from "vitest"
import {parseArgs} from "./argv.js"
const parse = (...args:string[]) => parseArgs(["bun", "tx", ...args])
describe("CLI argument parsing", () => {
  it("keeps global boolean flags separate from command words", () => {
    expect(parse("--json", "task", "--human", "add", "A task")).toEqual({command:"task", positional:["add","A task"],flags:{json:true,human:true}})
  })
  it("keeps empty, dash-prefixed and equals-containing option values", () => {
    expect(parse("task","update","tx-task","--description=","--title=--A=B").flags).toEqual({description:"",title:"--A=B"})
  })
  it("supports a literal separator for dash-prefixed titles", () => {
    expect(parse("task","add","--","--A title").positional).toEqual(["add","--A title"])
  })
  it("accepts negative numeric values and comma-accumulates repeated options", () => {
    expect(parse("task","add","A task","--score","-12","--label","bug","--label","docs").flags).toEqual({score:"-12",label:"bug,docs"})
  })
  it("uses the documented value for batch result formats", () => {
    expect(parse("spec","batch","--from","vitest","--json")).toEqual({command:"spec",positional:["batch"],flags:{from:"vitest",json:true}})
  })
  it.each(["--score","--description","--db","--content-root"])("rejects a missing value for %s",option => {
    expect(() => parse("task","add","A task",option)).toThrow(`${option} requires a value`)
    expect(() => parse("task","add","A task",option,"--json")).toThrow(`${option} requires a value`)
  })
})
