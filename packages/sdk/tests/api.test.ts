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
import type { ERROR_CODES } from "@clockwork2/engine"
import type {
  PageGame,
  PublicRefusalCode,
  RefusalDetails,
  VersionCheckCode,
} from "../src/api/index.js"
import type { BuildRefusalCode } from "../src/build/errors.js"

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
   * The platform runs the build's checks again on an upload and answers
   * each refusal with the build's own code, so every one is a code a route
   * answers, by name.
   */
  test("every refusal the build makes is one an upload can answer", () => {
    type Unnamed = Exclude<BuildRefusalCode, PublicRefusalCode>
    const none: [Unnamed] extends [never] ? true : Unnamed = true
    expect(none).toBe(true)
  })

  /**
   * An upload refuses a manifest with no ranking under the code the engine's
   * ranked set reports for it, so `vbz check --ranked` and the platform name
   * one failure alike.
   */
  test("a manifest with no ranking is refused under the engine's own code", () => {
    "E_RANK_UNDECLARED" satisfies Extract<
      PublicRefusalCode,
      keyof typeof ERROR_CODES
    >
  })

  /**
   * A check's code reaches a build system as a version's `rejectedCode`,
   * after the upload was answered, so no route answers one as a refusal and
   * a page switching on `PublicRefusalCode` never meets one.
   */
  test("no code a version's checks end in is a refusal a route answers", () => {
    type Both = Extract<VersionCheckCode, PublicRefusalCode>
    const none: [Both] extends [never] ? true : Both = true
    expect(none).toBe(true)
  })

  /**
   * A check's code names what the platform's own checks found, and the
   * engine's codes what the engine's did, so `rejectedCode` says whose
   * check refused a version. A code in both would say neither.
   */
  test("no code a version's checks end in is one of the engine's", () => {
    type Both = Extract<VersionCheckCode, keyof typeof ERROR_CODES>
    const none: [Both] extends [never] ? true : Both = true
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
