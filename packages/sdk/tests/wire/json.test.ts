/**
 * The one measure of what a value takes as JSON, which a page holds a run's
 * chunks and recording to and `vbz build` a manifest. Two copies would let
 * the page and the build count one value two ways, and `/build` reaching
 * into `/platform` for it would put the page's client in every build.
 */

import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { byteLengthOf as measuredByPlatform } from "../../src/platform/index.js"
import { byteLengthOf } from "../../src/wire/json.js"

const SRC = join(import.meta.dir, "..", "..", "src")

type Scanned = { kind: string; path: string }

async function importsOf(path: string): Promise<string[]> {
  const scanned = new Bun.Transpiler({ loader: "ts" }).scanImports(
    await readFile(path, "utf8"),
  ) as Scanned[]
  return scanned.map((one) => one.path)
}

describe("a value's bytes as JSON", () => {
  test("are the UTF-8 bytes of its JSON with no white space", () => {
    // `{"a":"é"}` is nine characters, and é is two bytes.
    expect(JSON.stringify({ a: "é" })).toHaveLength(9)
    expect(byteLengthOf({ a: "é" })).toBe(10)
    expect(byteLengthOf({ list: [1, 2] })).toBe(`{"list":[1,2]}`.length)
  })

  test("are measured by one module, which /platform exports and imports nothing", async () => {
    expect(measuredByPlatform).toBe(byteLengthOf)
    expect(await importsOf(join(SRC, "wire", "json.ts"))).toEqual([])
  })

  /**
   * Every module `/build` loads, followed from its entry through each
   * relative import, so a module that reaches `/platform` through another
   * directory is caught as well as one that imports it directly.
   */
  test("/build reaches none of /platform for it", async () => {
    const entry = join(SRC, "build", "index.ts")
    const seen = new Set<string>([entry])
    const queue = [entry]
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      for (const path of await importsOf(next)) {
        if (!path.startsWith(".")) continue
        const file = join(dirname(next), path).replace(/\.js$/, ".ts")
        if (seen.has(file)) continue
        seen.add(file)
        queue.push(file)
      }
    }
    const loaded = [...seen].map((file) => relative(SRC, file))
    expect(loaded).toContain(join("build", "manifest.ts"))
    expect(loaded).toContain(join("wire", "json.ts"))
    expect(loaded.filter((file) => file.startsWith("platform"))).toEqual([])
  })
})
