/**
 * `vbz check`: the engine's checks over the rules code as built, the input
 * mapping held to the manifest, and the release line with the hash of what
 * every patch of it keeps.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { contractSha256 } from "../../src/build/line"
import { captureProblems, checkGame, checkLines } from "../../src/cli/check"
import { TEMPLATE_DIR } from "../../src/cli/new"
import { MANIFEST } from "../../templates/game/src/sim/manifest"

const SOURCE = {
  simEntry: "src/sim/index.ts",
  presentEntry: "src/present.ts",
  captureEntry: "src/capture.ts",
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sdk-check-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** The template, copied where a test may break it, with its engine linked in. */
async function copyTemplate(): Promise<void> {
  await cp(TEMPLATE_DIR, root, {
    recursive: true,
    filter: (source) =>
      !source.includes("node_modules") && !source.includes("/dist"),
  })
  await symlink(resolve("node_modules"), join(root, "node_modules"))
}

describe("checking the template", () => {
  test("it passes, and names its line and the contract its patches keep", async () => {
    const checked = await checkGame({ root: TEMPLATE_DIR, ...SOURCE })
    expect(checked.ok).toBe(true)
    expect(checked.conformance.ok).toBe(true)
    // A suite that ran nothing would pass vacuously.
    expect(checked.conformance.outcomes.length).toBeGreaterThan(8)
    expect(checked.capture).toEqual([])
    expect(checked.version).toBe(MANIFEST.version)
    expect(checked.line).toBe(MANIFEST.version.split(".").slice(0, 2).join("."))
    expect(checked.contractSha256).toBe(contractSha256(MANIFEST))

    const printed = checkLines(checked, SOURCE.captureEntry).join("\n")
    expect(printed).toContain("all checks passed")
    expect(printed).toContain(
      "capture   src/capture.ts maps only inputs the manifest declares",
    )
    expect(printed).toContain(`release line ${checked.line}`)
    expect(printed).toContain(`contract  ${checked.contractSha256}`)
  }, 120_000)

  test("a mapping naming an input the manifest does not declare fails the check", async () => {
    await copyTemplate()
    await writeFile(
      join(root, "src", "capture.ts"),
      `export const capture = { keys: { Space: "jump" } }\n`,
    )
    const checked = await checkGame({ root, ...SOURCE })
    expect(checked.conformance.ok).toBe(true)
    expect(checked.ok).toBe(false)
    expect(checked.capture.length).toBe(1)
    expect(checked.capture[0]).toMatch(/^src\/capture\.ts: .*jump/)
    expect(checkLines(checked, SOURCE.captureEntry).join("\n")).toContain(
      "capture   src/capture.ts: ",
    )
  }, 120_000)
})

describe("reading the mapping", () => {
  async function problems(text: string | null): Promise<string[]> {
    if (text !== null) await writeFile(join(root, "capture.ts"), text)
    return await captureProblems(
      { root, ...SOURCE, captureEntry: "capture.ts" },
      MANIFEST,
    )
  }

  test("a file that is not there says it did not load", async () => {
    const [problem] = await problems(null)
    expect(problem).toMatch(/^capture\.ts did not load/)
  })

  test("a file that throws says it did not load, with what it threw", async () => {
    const [problem] = await problems(`throw new Error("no mapping today")\n`)
    expect(problem).toContain("no mapping today")
  })

  test("a file exporting no mapping says what to export", async () => {
    expect(await problems(`export const keys = {}\n`)).toEqual([
      "capture.ts exports no input mapping; export it as `capture`",
    ])
  })

  test("a mapping the engine cannot read is reported, not thrown", async () => {
    const [problem] = await problems(`export const capture = { pointers: 7 }\n`)
    expect(problem).toMatch(/^capture\.ts/)
  })

  test("a mapping of declared inputs has nothing wrong with it", async () => {
    expect(
      await problems(
        `export const capture = { keys: { ArrowLeft: "left" } }\n`,
      ),
    ).toEqual([])
  })
})
