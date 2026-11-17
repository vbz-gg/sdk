/**
 * Finding where a page module would load code at run time, in its text: a
 * load in code is found, and the same words in data are not.
 */

import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { runtimeLoads } from "../../src/build/loads"

function kinds(text: string): string[] {
  return runtimeLoads(text).map((load) => load.kind)
}

/** Module text holding a template literal, with `{{` for its `${`. */
function template(text: string): string {
  return text.replaceAll("{{", "$" + "{")
}

describe("a load in code", () => {
  test("import() with any argument", () => {
    expect(kinds(`import(name)`)).toEqual(["import()"])
    expect(kinds(`a=await import ( "./x.js" )`)).toEqual(["import()"])
    expect(kinds(`import/* why */(name)`)).toEqual(["import()"])
    expect(kinds(template("f(import(`./{{n}.js`))"))).toEqual(["import()"])
  })

  test("a worker, however it is reached", () => {
    expect(kinds(`new Worker(u)`)).toEqual(["new Worker"])
    expect(kinds(`new self.Worker(u,{type:"module"})`)).toEqual(["new Worker"])
    expect(kinds(`new globalThis . SharedWorker(u)`)).toEqual([
      "new SharedWorker",
    ])
    expect(kinds(`importScripts(u)`)).toEqual(["importScripts"])
    expect(kinds(`self.importScripts(u)`)).toEqual(["importScripts"])
    expect(kinds(`self.importScripts?.(u)`)).toEqual(["importScripts"])
  })

  test("inside a template's expression", () => {
    expect(kinds(template("`a {{import(x)} b`"))).toEqual(["import()"])
    expect(kinds(template("`a {{`b {{new Worker(u)}`}`"))).toEqual([
      "new Worker",
    ])
    expect(kinds(template("`{{ {a:1}.a }` + import(x)"))).toEqual(["import()"])
  })
})

describe("the same words that are not a load", () => {
  test("in strings, templates and comments", () => {
    expect(
      kinds(
        [
          `"import(x)"`,
          `'new Worker(u)'`,
          "`importScripts(u)`",
          "// import(x)",
          "/* new Worker(u) */",
          `"it said \\"import(x)\\""`,
        ].join(";"),
      ),
    ).toEqual([])
  })

  test("in a regular expression", () => {
    expect(kinds(`x=/import\\(|new Worker\\(/.test(s)`)).toEqual([])
    expect(kinds(`return /[/]import(/g`)).toEqual([])
  })

  test("as a property, or a name that only begins the same", () => {
    expect(
      kinds(
        `a.import(x);import.meta.url;new Workers(1);new WorkerPool();x.new(Worker);importScriptsLater(u)`,
      ),
    ).toEqual([])
  })

  test("a division is not taken for a regular expression", () => {
    // Were `/ 2 /` a pattern, the quote after it would open a string and
    // hide the import.
    expect(kinds(`a = b / 2 / c; import(x); d = "/"`)).toEqual(["import()"])
    expect(kinds(`f(a) / 2; import(x)`)).toEqual(["import()"])
  })
})

/**
 * What every page module bundles: the engine's host and this package's
 * `/game`. The frozen contract-1 module is a real one, built by an earlier
 * release, so finding nothing in it says the reader passes real output.
 */
test("a real page module loads nothing at run time", async () => {
  const frozen = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "..",
    "e2e",
    "frozen",
    "contract-1",
    "present.js",
  )
  expect(runtimeLoads(await readFile(frozen, "utf8"))).toEqual([])
})
