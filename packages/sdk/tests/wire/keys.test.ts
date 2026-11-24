/**
 * Where a studio's secret key may be sent: one rule, read by `vbz publish`
 * and by `/server`'s client, so neither is looser than the other.
 */

import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import * as publish from "../../src/cli/publish.js"
import { keyOriginOf, SECRET_KEY_PREFIX } from "../../src/wire/keys.js"

const SRC = join(import.meta.dir, "..", "..", "src")

describe("a key's origin", () => {
  test("is https, or http to this machine, and the origin alone", () => {
    expect(keyOriginOf("https://api.vbz.gg/")).toEqual({
      ok: true,
      origin: "https://api.vbz.gg",
    })
    expect(keyOriginOf("http://localhost:3000")).toEqual({
      ok: true,
      origin: "http://localhost:3000",
    })
    for (const raw of [
      "http://api.vbz.gg",
      "https://api.vbz.gg/v1",
      "https://api.vbz.gg?x=1",
      "https://api.vbz.gg#x",
      "nothing",
    ]) {
      expect({ raw, ok: keyOriginOf(raw).ok }).toEqual({ raw, ok: false })
    }
  })

  test("is the rule vbz publish holds its origin to", () => {
    expect(publish.SECRET_KEY_PREFIX).toBe(SECRET_KEY_PREFIX)
    expect(() =>
      publish.publishSettings(
        { dir: ".", game: "g", api: "http://api.vbz.gg" },
        { VBZ_STUDIO_KEY: `${SECRET_KEY_PREFIX}x` },
      ),
    ).toThrow("must be https, or http to this machine")
  })

  test("imports nothing at run time", async () => {
    const text = await readFile(join(SRC, "wire", "keys.ts"), "utf8")
    const scanned = new Bun.Transpiler({ loader: "ts" }).scanImports(text)
    expect(scanned).toEqual([])
  })
})
