/**
 * The platform's route shapes, as this package publishes them.
 *
 * The subpath is types only: a studio's page imports it for its types, and a
 * value in it would land in that page's bundle. So the module has to load
 * with nothing in it, both as source and as built.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type {
  PageGame,
  PublicRefusalCode,
  RefusalDetails,
} from "../src/api/index.js"

const PACKAGE = join(import.meta.dir, "..")

describe("@vbz-gg/sdk/api", () => {
  test("loads as a module that exports no value", async () => {
    const api = await import("../src/api/index.js")
    expect(Object.keys(api)).toEqual([])
  })

  test("is named in the exports map, beside the other halves", () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE, "package.json"), "utf8"),
    ) as { exports: Record<string, Record<string, string>> }
    expect(manifest.exports["./api"]).toEqual({
      development: "./src/api/index.ts",
      types: "./dist/api/index.d.ts",
      default: "./dist/api/index.js",
    })
  })
})

/**
 * Compile-time holds, run as tests so a reader finds them: each fails to
 * compile rather than to pass.
 */
describe("the shapes a page reads", () => {
  test("every refusal with a declared detail is a code a route answers", () => {
    type Stray = Exclude<keyof RefusalDetails, PublicRefusalCode>
    const none: [Stray] extends [never] ? true : Stray = true
    expect(none).toBe(true)
  })

  /**
   * A paused day has no ranked version and still names its line, so a page
   * can say ranked play is paused and offer practice.
   */
  test("a paused day is a round with no ranked version", () => {
    const paused: PageGame["today"] = {
      seedCommit: null,
      line: "1.2",
      ranked: "paused",
      version: null,
    }
    expect(paused?.version).toBeNull()
  })
})
