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
 * Minified code puts a postfix `++` or `--` straight before a division.
 * Read as a `+` and another `+`, the `/` after it opened a pattern that ran
 * to the next `/`, and everything between was skipped: a load hidden there
 * was missed, and a quote it swallowed hid the rest of the text, or showed a
 * load that was data.
 */
describe("a division after a postfix operator", () => {
  test("divides, so a load after it is found", () => {
    expect(kinds(`a++/2;new Worker(u);b=c/2`)).toEqual(["new Worker"])
    expect(kinds(`a--/2;import(x);b=c/2`)).toEqual(["import()"])
    expect(kinds(`a[i]++/n,import(x),m/2`)).toEqual(["import()"])
    expect(kinds(`f(a)--/n;import(x);m/2`)).toEqual(["import()"])
    expect(kinds(`x.y++ /2;importScripts(u);z/2`)).toEqual(["importScripts"])
  })

  test("divides, so a quote after it is not taken for code", () => {
    // Read as a pattern from `/2;` to the `/` in the first string, its
    // closing quote would open a string that ends at the next, and the
    // import inside the second string would be read as code.
    expect(kinds(`i++/2;s="a/";t="import(x)"`)).toEqual([])
  })

  test("a prefix operator before its operand still allows a pattern after a binary +", () => {
    expect(kinds(`a = ++b + /x/.source; import(y)`)).toEqual(["import()"])
    expect(kinds(`return --n, /import(/.test(s)`)).toEqual([])
    expect(kinds(`a + +/import(x)/.source.length`)).toEqual([])
  })

  /** A line between an operand and `++` makes it the next expression's prefix. */
  test("a ++ on the line after its operand is a prefix", () => {
    expect(kinds(`a\n++b/2;import(x)`)).toEqual(["import()"])
  })
})

/**
 * A `)` ends an expression, so a `/` after it divides, except after a
 * control keyword's head, where a statement starts and a `/` opens a
 * pattern.
 */
describe("a pattern after a control keyword's head", () => {
  test("is stepped over, so what it spells is no load", () => {
    expect(kinds(`if(a)/import\\(x/.test(b)`)).toEqual([])
    expect(kinds(`while (f(a)) /new Worker\\(/g.exec(s)`)).toEqual([])
    expect(kinds(`for(;;)/importScripts\\(/.test(s)`)).toEqual([])
    expect(kinds(`do{}while(a)/import\\(/.test(s)`)).toEqual([])
  })

  test("a head's own parentheses inside it do not end it", () => {
    expect(kinds(`if((a)&&(b))/import\\(/.test(c);import(d)`)).toEqual([
      "import()",
    ])
    expect(kinds(`if(a)b/2;import(c)`)).toEqual(["import()"])
    expect(kinds(`x.if(a)/2;import(c);d/2`)).toEqual(["import()"])
  })
})

/**
 * What every page module bundles: the engine's host and this package's
 * `/game`. The frozen modules are real ones, built by earlier trees, so
 * finding nothing in them says the reader passes real output.
 */
test("a real page module loads nothing at run time", async () => {
  for (const contract of ["contract-1", "contract-2"]) {
    const frozen = join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "..",
      "e2e",
      "frozen",
      contract,
      "present.js",
    )
    expect(runtimeLoads(await readFile(frozen, "utf8"))).toEqual([])
  }
})
