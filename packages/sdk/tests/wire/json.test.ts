/**
 * The one measure of what a value takes as JSON, which a page holds a run's
 * chunks and recording to and `vbz build` a manifest. Two copies would let
 * the page and the build count one value two ways, and `/build` reaching
 * into `/platform` for it would put the page's client in every build.
 */

import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
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

  test("/build reaches none of /platform for it", async () => {
    const files = (await readdir(join(SRC, "build"))).filter((name) =>
      name.endsWith(".ts"),
    )
    expect(files).toContain("manifest.ts")
    for (const file of files) {
      const reaching = (await importsOf(join(SRC, "build", file))).filter(
        (path) => path.includes("/platform/"),
      )
      expect({ file, reaching }).toEqual({ file, reaching: [] })
    }
  })
})
