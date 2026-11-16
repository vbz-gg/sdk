/**
 * `vbz build`: a version a release line cannot hold is refused before a file
 * is written, through the function the platform runs on an upload, and what
 * is written is what an upload carries.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BuildRefusal } from "../../src/build/errors"
import {
  buildGame,
  buildLines,
  releaseOf,
  writeBuild,
} from "../../src/cli/build"
import { failureLine } from "../../src/cli/failure"

const SOURCE = {
  simEntry: "src/sim/index.ts",
  presentEntry: "src/present.ts",
  captureEntry: "src/capture.ts",
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sdk-build-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A game of two files that needs no engine, at the version given. */
async function writeGame(manifest: Record<string, unknown>): Promise<void> {
  await mkdir(join(root, "src", "sim"), { recursive: true })
  await writeFile(
    join(root, "src", "sim", "index.ts"),
    `export const MANIFEST = ${JSON.stringify(manifest)}\n`,
  )
  await writeFile(
    join(root, "src", "present.ts"),
    `import { MANIFEST } from "cw2:sim"\nexport default { name: MANIFEST.id }\n`,
  )
}

function codeOf(work: () => unknown): string {
  try {
    work()
  } catch (error) {
    if (error instanceof BuildRefusal) return error.code
    throw error
  }
  throw new Error("expected a refusal")
}

describe("the version, read as a release", () => {
  test("a release version names its line", () => {
    expect(releaseOf({ version: "1.2.3" })).toEqual({
      version: "1.2.3",
      line: "1.2",
    })
  })

  test("a manifest with no version, or one that is not text, is refused", () => {
    for (const manifest of [{}, { version: 1 }, null, "1.0.0"]) {
      expect(codeOf(() => releaseOf(manifest))).toBe("E_VERSION_INVALID")
    }
  })

  test("a version the platform refuses is refused here first", () => {
    for (const version of ["1.0.0-beta.1", "1.02.0", "1.0", "2147483648.0.0"]) {
      expect(codeOf(() => releaseOf({ version }))).toBe("E_VERSION_INVALID")
    }
  })

  test("the refusal is printed with its code in front", () => {
    let thrown: unknown
    try {
      releaseOf({ version: "1.0.0-rc.1" })
    } catch (error) {
      thrown = error
    }
    expect(failureLine(thrown)).toMatch(
      /^E_VERSION_INVALID: version "1\.0\.0-rc\.1"/,
    )
    expect(failureLine(new Error("plain"))).toBe("plain")
    expect(failureLine("thrown text")).toBe("thrown text")
  })
})

/** A value a game's code would have only by reading the command's environment. */
const PLANTED = "vbz_sk_not_for_a_game"

describe("the game's own code", () => {
  /**
   * A build evaluates a game's code twice: the bundler runs the macros its
   * source imports, and the manifest is read by importing the rules code.
   * `vbz build` runs where a studio keeps its secret key and its cloud
   * credentials, so each happens in a process given none of that: the
   * bundler only `NODE_ENV`, which it builds for, and the import nothing.
   */
  test("runs with none of the command's environment", async () => {
    await mkdir(join(root, "src", "sim"), { recursive: true })
    await writeFile(
      join(root, "src", "sim", "macro.ts"),
      "export function bundledWith(): string { return JSON.stringify(process.env) }\n",
    )
    await writeFile(
      join(root, "src", "sim", "index.ts"),
      `import { bundledWith } from "./macro.ts" with { type: "macro" }\n` +
        "const env = (globalThis as { process?: { env?: object } }).process?.env\n" +
        `export const MANIFEST = { id: "leak", version: "1.0.0", bundledWith: bundledWith(), importedWith: JSON.stringify(env) }\n`,
    )
    await writeFile(
      join(root, "src", "present.ts"),
      `import { MANIFEST } from "cw2:sim"\nexport default { name: MANIFEST.id }\n`,
    )
    process.env.VBZ_STUDIO_KEY = PLANTED
    try {
      const built = await buildGame({ root, ...SOURCE })
      expect(built.manifest).toMatchObject({
        bundledWith: JSON.stringify({ NODE_ENV: "production" }),
        importedWith: "{}",
      })
      expect(new TextDecoder().decode(built.sim)).not.toContain(PLANTED)
    } finally {
      delete process.env.VBZ_STUDIO_KEY
    }
  })
})

describe("building", () => {
  test("a game builds to its two modules, its manifest and its line", async () => {
    await writeGame({ id: "probe", version: "2.5.1" })
    const built = await buildGame({ root, ...SOURCE })
    expect(built.version).toBe("2.5.1")
    expect(built.line).toBe("2.5")
    expect(built.manifest).toEqual({ id: "probe", version: "2.5.1" })
    expect(new TextDecoder().decode(built.present)).toContain("cw2:sim")
    expect(buildLines(built)).toEqual([
      "version 2.5.1, release line 2.5",
      `rules code ${built.sim.byteLength} bytes, page module ${built.present.byteLength} bytes`,
    ])
  })

  test("a version no line can hold writes nothing", async () => {
    await writeGame({ id: "probe", version: "1.0.0-beta" })
    await expect(buildGame({ root, ...SOURCE })).rejects.toThrow(
      /not MAJOR\.MINOR\.PATCH/,
    )
  })

  test("what is written is the three files, replacing an old build", async () => {
    await writeGame({ id: "probe", version: "1.0.0" })
    await mkdir(join(root, "dist"), { recursive: true })
    await writeFile(join(root, "dist", "frame.js"), "stale")
    const built = await buildGame({ root, ...SOURCE })
    await writeBuild(root, built)
    expect(await readFile(join(root, "dist", "sim.js"))).toEqual(
      Buffer.from(built.sim),
    )
    expect(await readFile(join(root, "dist", "present.js"))).toEqual(
      Buffer.from(built.present),
    )
    expect(
      JSON.parse(await readFile(join(root, "dist", "manifest.json"), "utf8")),
    ).toEqual(built.manifest)
    await expect(readFile(join(root, "dist", "frame.js"))).rejects.toThrow()
  })
})
