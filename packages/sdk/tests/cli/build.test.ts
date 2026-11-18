/**
 * `vbz build`: a version a release line cannot hold is refused before a file
 * is written, through the function the platform runs on an upload, and what
 * is written is what an upload carries. With `--addressed`, the build at its
 * content addresses too, as the harness serves it, for the root of an origin.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hashCanonical, type PlainValue } from "@clockwork2/engine"
import { $ } from "bun"
import { blobKeys, buildAndAddress, gameIdOf } from "../../src/build/address"
import { BuildRefusal } from "../../src/build/errors"
import { canonicalListing, listingSha256 } from "../../src/build/files"
import { MAX_MANIFEST_BYTES } from "../../src/build/limits"
import {
  addressBuild,
  addressedLines,
  addressingOf,
  buildGame,
  buildLines,
  releaseOf,
  writeAddressed,
  writeBuild,
} from "../../src/cli/build"
import { failureLine } from "../../src/cli/failure"
import { OWN_ROOT } from "../../src/cli/guides"
import { pageCsp } from "../../src/harness/csp"
import type { AddressedBuild } from "../../src/harness/index"
import { startBundleServer } from "../../src/harness/servers"
import { localAddress } from "../../src/host/local"
import { createBlobServer, isServedPath } from "../../src/serve/blobs"

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

  /**
   * A renderer such as pixi.js 8 starts its workers from blobs of its own
   * code, so a page module may start one. A page's policy admits it only
   * with worker-src, so the game has to say it needs workers, or the build
   * stops, before a studio's page meets a worker it refuses.
   */
  test("a page module that starts a worker builds only when the game says it needs workers", async () => {
    await writeGame({ id: "probe", version: "1.0.0" })
    await writeFile(
      join(root, "src", "present.ts"),
      `import { MANIFEST } from "cw2:sim"\nconst code = "postMessage(1)"\nexport const start = () => new Worker(URL.createObjectURL(new Blob([code])))\nexport default { name: MANIFEST.id }\n`,
    )
    await expect(buildGame({ root, ...SOURCE })).rejects.toThrow(
      `the page module starts a worker with new Worker once, which a page's policy admits only with worker-src blob: and the game's path; say the game needs workers in its package.json, as "vbz": { "needs": { "workers": true } }`,
    )
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ vbz: { needs: { workers: true } } }),
    )
    const built = await buildGame({ root, ...SOURCE })
    expect(built.needs).toEqual({ workers: true })
  })

  /**
   * The platform refuses a manifest over `MAX_MANIFEST_BYTES` as JSON with
   * no white space, so `vbz build` refuses it first, measured the same way,
   * and a build that passes passes the upload. Held at the byte.
   */
  test("a manifest at its cap builds, and one a byte over is refused with the platform's code and words", async () => {
    const padded = (bytes: number): Record<string, unknown> => {
      const base = { id: "probe", version: "1.0.0", pad: "" }
      return { ...base, pad: "x".repeat(bytes - JSON.stringify(base).length) }
    }
    await writeGame(padded(MAX_MANIFEST_BYTES))
    const built = await buildGame({ root, ...SOURCE })
    expect(JSON.stringify(built.manifest)).toHaveLength(MAX_MANIFEST_BYTES)

    await writeGame(padded(MAX_MANIFEST_BYTES + 1))
    let thrown: unknown
    try {
      await buildGame({ root, ...SOURCE })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(BuildRefusal)
    expect(failureLine(thrown)).toBe(
      `E_MANIFEST_INVALID: the manifest is ${MAX_MANIFEST_BYTES + 1} bytes as JSON, over the ${MAX_MANIFEST_BYTES} a manifest may hold`,
    )
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

describe("a game with a files folder", () => {
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
    // A start pack is fetched from the folder before tick 0, so the page's
    // policy needs the game's path in connect-src, and nobody had to say so.
    expect(built.needs).toEqual({ files: true })
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

/** A game with a files folder whose rules code reads a data pack from it. */
function packed(id = "probe"): Record<string, unknown> {
  return {
    id,
    version: "1.0.0",
    name: "Probe",
    assets: [
      {
        path: "packs/one.json",
        sha256: packSha,
        bytes: PACK.byteLength,
        requiredForSim: true,
        license: "CC0",
      },
    ],
  }
}

/** A game id of the author's own, as `--game` names one. */
const NAMED_GAME = "11111111-2222-4333-8444-555555555555"

/** Every file under `dir`, by its path from there, `/` between segments. */
async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = []
  for await (const path of new Bun.Glob("**/*").scan({
    cwd: dir,
    onlyFiles: true,
  })) {
    found.push(path.split("\\").join("/"))
  }
  return found.sort()
}

/** Every file under `dir`, by its path from there, with its bytes. */
async function bytesUnder(dir: string): Promise<Record<string, Uint8Array>> {
  const bytes: Record<string, Uint8Array> = {}
  for (const path of await filesUnder(dir)) {
    bytes[path] = new Uint8Array(await readFile(join(dir, path)))
  }
  return bytes
}

/** `dist/addressed/` in the game under test. */
const addressedDir = () => join(root, "dist", "addressed")

describe("the build at its content addresses", () => {
  /**
   * The folder is what a host puts at the root of an origin, so every file
   * in it has to be at the path `createBlobServer` answers for it, and hold
   * what the harness, which `vbz dev` serves a game with, serves there for
   * the same build: no file missing, none more, and the same bytes.
   */
  test("every file is where createBlobServer answers it, byte for byte what the harness serves", async () => {
    await writeFilesGame(packed())
    const built = await buildGame(withFiles())
    const addressed = addressBuild(built, null)
    await writeBuild(root, built)
    await writeAddressed(root, addressed)
    const written = await filesUnder(addressedDir())

    const harness = await buildAndAddress(withFiles(), addressed.page.gameId)
    const keys = blobKeys(harness)
    expect(written).toEqual(
      [
        keys.sim,
        keys.present,
        `${keys.files}engine/entry.js`,
        `${keys.files}packs/one.json`,
      ].sort(),
    )

    const fromFolder = createBlobServer(async (key) =>
      existsSync(join(addressedDir(), key))
        ? new Uint8Array(await readFile(join(addressedDir(), key)))
        : undefined,
    )
    const server = startBundleServer({ port: 0, built: harness })
    try {
      for (const key of written) {
        expect(isServedPath(`/${key}`)).toBe(true)
        const ours = await fromFolder(new Request(`http://host.invalid/${key}`))
        const theirs = await fetch(`${server.origin}/${key}`)
        expect({ key, ours: ours.status, theirs: theirs.status }).toEqual({
          key,
          ours: 200,
          theirs: 200,
        })
        expect(new Uint8Array(await ours.arrayBuffer())).toEqual(
          new Uint8Array(await theirs.arrayBuffer()),
        )
      }
    } finally {
      await server.stop()
    }
    // The data pack is the folder's own bytes, which its manifest pins.
    expect(
      new Uint8Array(
        await readFile(join(addressedDir(), `${keys.files}packs/one.json`)),
      ),
    ).toEqual(PACK)
  })

  /**
   * Served from the root of an origin, the page module's imports resolve
   * against its own URL there, so each has to be root-relative, under the
   * game's path, and a file the folder holds.
   */
  test("the page module names only root-relative /g/<id>/ paths, each one the folder holds", async () => {
    await writeFilesGame(packed())
    const addressed = addressBuild(await buildGame(withFiles()), null)
    await writeAddressed(root, addressed)
    const present = await readFile(
      join(addressedDir(), addressed.page.present),
      "utf8",
    )
    const imports = new Bun.Transpiler({ loader: "js" })
      .scanImports(present)
      .map((found) => found.path)
    expect(imports.sort()).toEqual(
      [addressed.page.sim, `${addressed.page.files}engine/entry.js`].sort(),
    )
    for (const path of imports) {
      expect(path).toStartWith(`/g/${addressed.page.gameId}/`)
      expect(existsSync(join(addressedDir(), path))).toBe(true)
    }
    expect(present).not.toContain("cw2:")
  })

  test("--game names the id in every path and in addressed.json, and without it the manifest's id makes one", async () => {
    await writeFilesGame(packed("probe"))
    const built = await buildGame(withFiles())
    const made = addressBuild(built, null)
    expect(made.page.gameId).toBe(gameIdOf({ id: "probe" }))

    const named = addressBuild(built, NAMED_GAME)
    await writeAddressed(root, named)
    const written = await filesUnder(addressedDir())
    expect(written).toHaveLength(4)
    for (const key of written) expect(key).toStartWith(`g/${NAMED_GAME}/`)
    const keys = blobKeys(named.game)
    expect(
      JSON.parse(
        await readFile(join(root, "dist", "addressed.json"), "utf8"),
      ) as unknown,
    ).toEqual({
      name: "Probe",
      gameId: NAMED_GAME,
      present: `/${keys.present}`,
      sim: `/${keys.sim}`,
      files: `/${keys.files}`,
      manifestHash: hashCanonical(built.manifest as PlainValue),
      needs: { files: true },
    })

    // Written again under the made id, the folder holds that one alone.
    await writeAddressed(root, made)
    for (const key of await filesUnder(addressedDir())) {
      expect(key).toStartWith(`g/${made.page.gameId}/`)
    }
  })

  /**
   * Content addressing: an unchanged game builds to the same bytes, so a
   * host that already holds a path never needs it again, and a page naming
   * one keeps working after the next build.
   */
  test("a second build of an unchanged game writes the same paths and bytes", async () => {
    await writeFilesGame(packed())
    const first = addressBuild(await buildGame(withFiles()), null)
    await writeAddressed(root, first)
    const before = await bytesUnder(addressedDir())
    const second = addressBuild(await buildGame(withFiles()), null)
    await writeAddressed(root, second)
    expect(Object.keys(before)).toHaveLength(4)
    expect(await bytesUnder(addressedDir())).toEqual(before)
    expect(second.page).toEqual(first.page)
  })

  /**
   * Each path is from the root of the origin serving the folder, so the
   * address `loadGame` takes is that origin and the path, whatever page the
   * origin is named from, and `pageCsp` takes the id and the needs as they
   * are.
   */
  test("addressed.json is what loadGame and pageCsp take, with the origin serving the folder", async () => {
    await writeGame({ id: "probe", version: "1.0.0", name: "Probe" })
    const built = await buildGame({ root, ...SOURCE })
    const { page } = addressBuild(built, null)
    const origin = "https://files.example"
    expect(new URL(page.present, `${origin}/a/page/`).href).toBe(
      `${origin}${page.present}`,
    )
    expect(page.files).toEndWith("/")
    expect(page.needs).toEqual({})
    expect(page.manifestHash).toBe(hashCanonical(built.manifest as PlainValue))
    expect(
      pageCsp({
        bundlesOrigin: origin,
        gameId: page.gameId,
        needs: page.needs,
        signInOrigin: null,
      }),
    ).toContain(`script-src 'self' ${origin}/g/${page.gameId}/;`)
  })

  /**
   * A page author reads the file through the type `/harness` exports for it,
   * beside `pageCsp`, which the same page calls. Imported from the subpath's
   * own entry, so the typecheck fails if it stops exporting it, and held
   * here to name every field the written file holds and no other.
   */
  test("addressed.json is the AddressedBuild /harness exports, field for field", async () => {
    await writeGame({ id: "probe", version: "1.0.0", name: "Probe" })
    const addressed = addressBuild(await buildGame({ root, ...SOURCE }), null)
    await writeAddressed(root, addressed)
    const read = JSON.parse(
      await readFile(join(root, "dist", "addressed.json"), "utf8"),
    ) as AddressedBuild
    const fields: Record<keyof AddressedBuild, true> = {
      name: true,
      gameId: true,
      present: true,
      sim: true,
      files: true,
      manifestHash: true,
      needs: true,
    }
    expect(Object.keys(read).sort()).toEqual(Object.keys(fields).sort())
    expect(read).toEqual(addressed.page)
  })

  test("says where the folder is, under which id, and what a page loads", async () => {
    await writeFilesGame(packed())
    const withFolder = addressBuild(await buildGame(withFiles()), null)
    expect(addressedLines(withFolder)).toEqual([
      `dist/addressed/ for the root of an origin, under game id ${withFolder.page.gameId}`,
      `page module ${withFolder.page.present}`,
      `files folder ${withFolder.page.files}`,
      `manifest hash ${withFolder.page.manifestHash}`,
      "needs files",
      "dist/addressed.json says the same, for a page",
    ])
    await writeGame({ id: "probe", version: "1.0.0" })
    const plain = addressBuild(await buildGame({ root, ...SOURCE }), null)
    expect(addressedLines(plain)[4]).toBe(
      "needs nothing beyond its two modules",
    )
  })
})

describe("what --addressed and --game ask of vbz build", () => {
  test("nothing without --addressed, and the made id or the named one with it", () => {
    expect(addressingOf({ addressed: false, game: undefined })).toBeNull()
    expect(addressingOf({ addressed: true, game: undefined })).toEqual({
      gameId: null,
    })
    expect(addressingOf({ addressed: true, game: NAMED_GAME })).toEqual({
      gameId: NAMED_GAME,
    })
  })

  test("a --game that names nothing the build writes, or is not a game id, is refused", () => {
    expect(() => addressingOf({ addressed: false, game: NAMED_GAME })).toThrow(
      "add --addressed, or leave --game out",
    )
    for (const game of [
      "lane-runner",
      gameIdOf({ id: "probe" }).toUpperCase(),
      "",
    ]) {
      expect(() => addressingOf({ addressed: true, game })).toThrow(
        `--game takes a game id, a UUID written lowercase`,
      )
    }
  })

  /**
   * The command works out the addressed build before it writes anything, so
   * a game id it cannot make leaves the last build where it was.
   */
  test("a game id that cannot be made writes nothing, and the last build stays", async () => {
    const cli = join(OWN_ROOT, "src", "cli", "index.ts")
    await writeGame({ id: "probe", version: "1.0.0" })
    const first = await $`bun ${cli} build ${root} --addressed`
      .quiet()
      .nothrow()
    expect(first.exitCode).toBe(0)
    expect(first.stdout.toString()).toContain(
      `under game id ${gameIdOf({ id: "probe" })}`,
    )
    const before = await bytesUnder(join(root, "dist"))

    await writeGame({ version: "1.0.1" })
    const second = await $`bun ${cli} build ${root} --addressed`
      .quiet()
      .nothrow()
    expect(second.exitCode).toBe(1)
    expect(second.stderr.toString()).toStartWith("E_MANIFEST_INVALID: ")
    expect(await bytesUnder(join(root, "dist"))).toEqual(before)
  })
})
