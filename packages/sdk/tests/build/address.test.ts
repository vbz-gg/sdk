/**
 * The one layout of a game at its content addresses, which the harness
 * serves and `vbz build --addressed` writes, and the game id its paths name
 * when nobody names one.
 */

import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import {
  GAME_ID_NAMESPACE,
  gameIdOf,
  nameBasedUuid,
} from "../../src/build/address"
import { BuildRefusal } from "../../src/build/errors"
import { GAME_ID } from "../../src/build/paths"

const SRC = join(import.meta.dir, "..", "..", "src")

type Scanned = { kind: string; path: string }

async function importsOf(path: string): Promise<string[]> {
  // An entry point's `#!` line is not TypeScript, and the scanner refuses it.
  const text = (await readFile(path, "utf8")).replace(/^#!.*/, "")
  const scanned = new Bun.Transpiler({ loader: "ts" }).scanImports(
    text,
  ) as Scanned[]
  return scanned.map((one) => one.path)
}

/** Every source file `entry` loads, followed through each relative import. */
async function reachedFrom(entry: string): Promise<string[]> {
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
  return [...seen].map((file) => relative(SRC, file))
}

/** Every TypeScript file under `src/`, as a path inside it. */
async function sources(): Promise<string[]> {
  const entries = await readdir(SRC, { recursive: true })
  return entries.filter((path) => path.endsWith(".ts")).sort()
}

describe("the game id a layout's paths name", () => {
  /**
   * A version 5 UUID anybody can make again with a UUID library, so the
   * first vector is RFC 9562's own example and the second is Python's
   * `uuid.uuid5` of the template's id in this namespace: neither is this
   * implementation checked against itself.
   */
  test("is RFC 9562's name-based UUID, as another implementation makes it", () => {
    expect(
      nameBasedUuid("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com"),
    ).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2")
    expect(nameBasedUuid(GAME_ID_NAMESPACE, "lane-runner")).toBe(
      "0b123291-582d-52f5-a2d5-877342fd8596",
    )
  })

  test("is made from the manifest's id alone, so every version is under one path", () => {
    const first = gameIdOf({ id: "lane-runner", version: "1.0.0" })
    expect(first).toMatch(GAME_ID)
    expect(
      gameIdOf({ id: "lane-runner", version: "2.3.4", name: "Other" }),
    ).toBe(first)
    expect(gameIdOf({ id: "lane-runner-2", version: "1.0.0" })).not.toBe(first)
  })

  test("a manifest naming no id has none to make, and says how to name one", () => {
    for (const manifest of [
      { version: "1.0.0" },
      { id: "" },
      { id: 7 },
      null,
    ]) {
      let thrown: unknown
      try {
        gameIdOf(manifest)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(BuildRefusal)
      expect((thrown as BuildRefusal).code).toBe("E_MANIFEST_INVALID")
      expect((thrown as BuildRefusal).message).toContain("--game")
    }
  })

  test("a namespace that is not a lowercase UUID is refused rather than hashed", () => {
    expect(() => nameBasedUuid("not-a-uuid", "lane-runner")).toThrow(
      "is not a lowercase UUID",
    )
    expect(() =>
      nameBasedUuid(GAME_ID_NAMESPACE.toUpperCase(), "lane-runner"),
    ).toThrow("is not a lowercase UUID")
  })
})

describe("the layout's one home", () => {
  /**
   * The harness and `vbz build` both import it, so it sits in `/build`,
   * which reaches nothing of the page's half, the harness or the CLI: a
   * layout module that did would drag a server or a page into every build.
   */
  test("reaches nothing of /harness, /host, /platform, /serve or the CLI", async () => {
    const reached = await reachedFrom(join(SRC, "build", "address.ts"))
    expect(reached).toContain(join("build", "contract.ts"))
    expect(reached).toContain(join("build", "paths.ts"))
    for (const half of ["harness", "host", "platform", "serve", "cli"]) {
      expect({
        half,
        reached: reached.filter((f) => f.startsWith(half)),
      }).toEqual({ half, reached: [] })
    }
  })

  /**
   * One implementation: the page module is rewritten in one place, which the
   * harness serves from and the command writes from. A second call site is a
   * second layout, however alike the two look today.
   */
  test("is the only module that rewrites a page module, and both the harness and the CLI read it", async () => {
    const rewriting: string[] = []
    const reading: string[] = []
    for (const file of await sources()) {
      const text = await readFile(join(SRC, file), "utf8")
      if (/\brewritePresentImports\(/.test(text)) rewriting.push(file)
      if ((await importsOf(join(SRC, file))).includes("../build/address.js")) {
        reading.push(file)
      }
    }
    // The definition, and its one caller.
    expect(rewriting).toEqual([
      join("build", "address.ts"),
      join("build", "contract.ts"),
    ])
    expect(reading).toEqual(
      expect.arrayContaining([
        join("cli", "build.ts"),
        join("harness", "servers.ts"),
        join("harness", "index.ts"),
      ]),
    )
  })
})
