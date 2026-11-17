/**
 * `vbz build`: a version a release line cannot hold is refused before a file
 * is written, through the function the platform runs on an upload, and what
 * is written is what an upload carries.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hashCanonical, type PlainValue } from "@clockwork2/engine"
import { BuildRefusal } from "../../src/build/errors"
import { canonicalListing, listingSha256 } from "../../src/build/files"
import {
  buildGame,
  buildLines,
  releaseOf,
  writeBuild,
} from "../../src/cli/build"
import { failureLine } from "../../src/cli/failure"
import { localAddress } from "../../src/host/local"

const SOURCE = {
  simEntry: "src/sim/index.ts",
  presentEntry: "src/present.ts",
  captureEntry: "src/capture.ts",
  filesDir: null,
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
      `files 0 in 0 bytes, named ${listingSha256({ files: [] })}`,
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
    expect(await readFile(join(root, "dist", "files.json"), "utf8")).toBe(
      `{"files":[]}`,
    )
    await expect(readFile(join(root, "dist", "frame.js"))).rejects.toThrow()
  })

  /**
   * What a page playing the game locally needs to load it from a static host
   * serving `dist/` as it is: where each part is, the manifest's hash, which
   * the page module has to report, and the folder's name.
   */
  test("game.json says where each part is, beside it, and what they hash to", async () => {
    await writeGame({ id: "probe", version: "1.0.0", name: "Probe" })
    const built = await buildGame({ root, ...SOURCE })
    await writeBuild(root, built)
    const game = JSON.parse(
      await readFile(join(root, "dist", "game.json"), "utf8"),
    ) as Record<string, string>
    expect(game).toEqual({
      name: "Probe",
      present: "present.js",
      sim: "sim.js",
      manifest: "manifest.json",
      manifestHash: hashCanonical(built.manifest as PlainValue),
      files: "files/",
      listing: "files.json",
      filesSha256: listingSha256({ files: [] }),
    })
    // Every part it names is there.
    for (const part of ["present", "sim", "manifest", "listing"] as const) {
      await readFile(join(root, "dist", game[part] as string))
    }
    expect(localAddress(game, "https://a-game.example/game/game.json")).toEqual(
      {
        presentUrl: "https://a-game.example/game/present.js",
        manifestHash: hashCanonical(built.manifest as PlainValue),
        filesUrl: "https://a-game.example/game/files/",
      },
    )
  })
})

describe("a game with a files folder", () => {
  const PACK = new TextEncoder().encode(`{"level":1}`)
  const packSha = new Bun.CryptoHasher("sha256").update(PACK).digest("hex")

  /** A game whose page module imports its engine from the folder. */
  async function writeFilesGame(manifest: Record<string, unknown>) {
    await writeGame(manifest)
    await writeFile(
      join(root, "src", "present.ts"),
      `import { MANIFEST } from "cw2:sim"\nimport { engine } from "cw2:files/engine/entry.js"\nexport default { name: MANIFEST.id, engine }\n`,
    )
    await mkdir(join(root, "files", "engine"), { recursive: true })
    await mkdir(join(root, "files", "packs"), { recursive: true })
    await writeFile(
      join(root, "files", "engine", "entry.js"),
      "export const engine = 1\n",
    )
    await writeFile(join(root, "files", "packs", "one.json"), PACK)
  }

  const withFiles = () => ({
    root,
    ...SOURCE,
    filesDir: join(root, "files"),
  })

  test("lists the folder, and dist/ carries it and its listing", async () => {
    await writeFilesGame({
      id: "probe",
      version: "1.0.0",
      assets: [
        {
          path: "packs/one.json",
          sha256: packSha,
          bytes: PACK.byteLength,
          requiredForSim: true,
          license: "CC0",
        },
      ],
    })
    const built = await buildGame(withFiles())
    expect(built.files.listing.files.map((file) => file.path).sort()).toEqual([
      "engine/entry.js",
      "packs/one.json",
    ])
    // The page module keeps its import as written, for the upload to rewrite.
    expect(new TextDecoder().decode(built.present)).toContain(
      "cw2:files/engine/entry.js",
    )
    await writeBuild(root, built)
    const listing = await readFile(join(root, "dist", "files.json"), "utf8")
    expect(listing).toBe(canonicalListing(built.files.listing))
    expect(
      new Uint8Array(
        await readFile(join(root, "dist", "files", "packs", "one.json")),
      ),
    ).toEqual(PACK)
    expect(buildLines(built)[2]).toBe(
      `files 2 in ${PACK.byteLength + 24} bytes, named ${listingSha256(built.files.listing)}`,
    )
  })

  test("a data pack the folder does not hold is refused", async () => {
    await writeFilesGame({
      id: "probe",
      version: "1.0.0",
      assets: [
        {
          path: "packs/two.json",
          sha256: packSha,
          bytes: PACK.byteLength,
          requiredForSim: true,
          license: "CC0",
        },
      ],
    })
    let thrown: unknown
    try {
      await buildGame(withFiles())
    } catch (error) {
      thrown = error
    }
    expect((thrown as BuildRefusal).code).toBe("E_PACK_UNLISTED")
  })

  test("a page module importing a file the folder does not hold is refused", async () => {
    await writeFilesGame({ id: "probe", version: "1.0.0" })
    await rm(join(root, "files", "engine", "entry.js"))
    let thrown: unknown
    try {
      await buildGame(withFiles())
    } catch (error) {
      thrown = error
    }
    expect((thrown as BuildRefusal).code).toBe("E_FILE_UNLISTED")
  })
})
