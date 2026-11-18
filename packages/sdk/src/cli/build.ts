/**
 * `vbz build`: a game's source to what an upload carries: the rules code,
 * the page module, the manifest, and the files folder with its listing; and
 * `game.json`, which lets a plain static host serve `dist/` as it is to a
 * page playing the game locally.
 *
 * The version is read as a release before anything is written, through the
 * same `parseReleaseVersion` the platform runs on an upload, so a version no
 * release line can hold is refused here rather than after an upload. The
 * manifest is held to `MAX_MANIFEST_BYTES` the same way, measured as the
 * platform measures it.
 *
 * The page module is written unrewritten, with its `cw2:sim` and
 * `cw2:files/` specifiers intact. The platform rewrites them to the rules
 * code's and the folder's content addresses on the way in, so a page module
 * that arrived already pointing somewhere would be one naming code nobody
 * checked.
 *
 * `--addressed` also writes `dist/addressed/`: the build at its content
 * addresses, the layout the harness serves and `createBlobServer` answers,
 * with the page module rewritten to name them, for a host to serve from the
 * root of an origin a page on another origin loads it from; and beside it
 * `dist/addressed.json`, what that page needs to load it. Root of an origin
 * only: the rewritten imports are root-relative, so a host that serves under
 * a sub-path serves the build from the page's own origin instead.
 */

import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { hashCanonical, type PlainValue } from "@clockwork2/engine"
import {
  type AddressedGame,
  addressGame,
  blobKeys,
  gameIdOf,
  layoutOf,
} from "../build/address.js"
import {
  DIST_ADDRESSED_DIR,
  DIST_DIR,
  DIST_FILES,
  DIST_FILES_DIR,
} from "../build/dist.js"
import { refuse } from "../build/errors.js"
import {
  assertManifestBytes,
  assertPacksListed,
  buildGameArtifacts,
  canonicalListing,
  type GameSource,
  type ListedFolder,
  listingSha256,
} from "../build/index.js"
import { GAME_ID } from "../build/paths.js"
import { parseReleaseVersion, releaseLine } from "../build/version.js"
import { type GameNeeds, versionNeeds } from "../harness/csp.js"
import type { LocalBuild } from "../host/local.js"
import type { Options } from "./args.js"
import { readManifestFromSim } from "./manifest.js"
import { needsOf } from "./source.js"

/** A game built in memory, before anything is written. */
export interface BuiltGame {
  readonly sim: Uint8Array
  readonly present: Uint8Array
  /** What the rules code exports as `MANIFEST`. */
  readonly manifest: unknown
  readonly version: string
  /** The release line, `MAJOR.MINOR`. */
  readonly line: string
  /** The files folder, listed, and where each file is on disk. */
  readonly files: ListedFolder
  /** What the version needs of a page's policy, as the game says and the build holds it to. */
  readonly needs: GameNeeds
}

/**
 * The manifest's version, held to what a release line can hold. A manifest
 * naming none, or a version the platform would refuse, is `E_VERSION_INVALID`.
 */
export function releaseOf(manifest: unknown): {
  readonly version: string
  readonly line: string
} {
  const version =
    typeof manifest === "object" && manifest !== null
      ? (manifest as { readonly version?: unknown }).version
      : undefined
  if (typeof version !== "string") {
    refuse(
      "E_VERSION_INVALID",
      "the manifest names no version; give it one as MAJOR.MINOR.PATCH, such as 1.0.0",
    )
  }
  return { version, line: releaseLine(parseReleaseVersion(version)) }
}

/**
 * The data packs the manifest declares, each a file of the folder of the
 * size and hash it declares, and within the packs' limits.
 */
function packsOf(manifest: unknown): Parameters<typeof assertPacksListed>[0] {
  const assets =
    typeof manifest === "object" && manifest !== null
      ? (manifest as { readonly assets?: unknown }).assets
      : undefined
  return Array.isArray(assets)
    ? (assets as Parameters<typeof assertPacksListed>[0])
    : []
}

/**
 * Builds both modules, lists the files folder, reads the manifest out of the
 * rules code, holds it to its size, holds its data packs to the folder, and
 * holds what the game's `package.json` says it needs of a page's policy to
 * what the build does: a page module that starts a worker is refused unless
 * the game says it needs workers.
 */
export async function buildGame(source: GameSource): Promise<BuiltGame> {
  const { sim, present, imports, files } = await buildGameArtifacts(source)
  const needs = versionNeeds(await needsOf(source.root), {
    workers: imports.workers,
    files: files.listing,
  })
  const manifest = await readManifestFromSim(sim)
  assertManifestBytes(manifest)
  const release = releaseOf(manifest)
  assertPacksListed(packsOf(manifest), files.listing)
  return { sim, present, manifest, ...release, files, needs }
}

/**
 * Replaces `dist/` with the build: the rules code, the page module, the
 * manifest, the folder's listing, and a copy of the folder by its listed
 * paths, so `dist/` is everything an upload carries.
 */
export async function writeBuild(
  root: string,
  built: BuiltGame,
): Promise<void> {
  const dist = join(root, DIST_DIR)
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
  await writeFile(join(dist, DIST_FILES.sim), built.sim)
  await writeFile(join(dist, DIST_FILES.present), built.present)
  await writeFile(
    join(dist, DIST_FILES.manifest),
    `${JSON.stringify(built.manifest, null, 2)}\n`,
  )
  await writeFile(
    join(dist, DIST_FILES.listing),
    canonicalListing(built.files.listing),
  )
  for (const file of built.files.listing.files) {
    const from = built.files.onDisk.get(file.path) as string
    const to = join(dist, DIST_FILES_DIR, ...file.path.split("/"))
    await mkdir(dirname(to), { recursive: true })
    await copyFile(from, to)
  }
  await writeFile(
    join(dist, DIST_FILES.game),
    `${JSON.stringify(localBuildOf(built), null, 2)}\n`,
  )
}

/** The game's name, from its manifest, or empty when it names none. */
function nameOf(built: BuiltGame): string {
  const name =
    typeof built.manifest === "object" && built.manifest !== null
      ? (built.manifest as { readonly name?: unknown }).name
      : undefined
  return typeof name === "string" ? name : ""
}

/** The engine's canonical hash of the manifest, which the page module must report. */
function manifestHashOf(built: BuiltGame): string {
  return hashCanonical(built.manifest as PlainValue)
}

/** `dist/game.json`: where each part of the build is, beside the file. */
export function localBuildOf(built: BuiltGame): LocalBuild {
  return {
    name: nameOf(built),
    present: DIST_FILES.present,
    sim: DIST_FILES.sim,
    manifest: DIST_FILES.manifest,
    manifestHash: manifestHashOf(built),
    files: `${DIST_FILES_DIR}/`,
    listing: DIST_FILES.listing,
    filesSha256: listingSha256(built.files.listing),
  }
}

/**
 * `dist/addressed.json`: what a page on another origin needs to load the
 * build from the root of the origin serving `dist/addressed/`. Each path is
 * from that root, so `new URL(path, origin)` is the address `loadGame`
 * takes; `gameId` and `needs` are what `pageCsp` takes with the origin.
 */
export interface AddressedBuild {
  /** The game's name, from its manifest. */
  readonly name: string
  /** The game id every path names, `/g/<game id>/`. */
  readonly gameId: string
  /** The page module, rewritten to import the two below. */
  readonly present: string
  /** The rules code, which the page module imports itself. */
  readonly sim: string
  /** The files folder, ending in `/`. */
  readonly files: string
  /** The engine's canonical hash of the manifest, which the page module must report. */
  readonly manifestHash: string
  /** What the version needs of the page's policy beyond its two modules. */
  readonly needs: GameNeeds
}

/** A build at its content addresses, and what a page needs to load it there. */
export interface Addressed {
  readonly game: AddressedGame
  readonly page: AddressedBuild
}

/**
 * What `vbz build` is asked to address: nothing without `--addressed`; with
 * it, the game id `--game` names, or null for the one made from the
 * manifest's id once the build has read it. A `--game` that is not a game
 * id, a UUID written lowercase, is refused before anything builds, and so is
 * one without `--addressed`, which would name nothing the build writes.
 */
export function addressingOf(
  options: Pick<Options, "addressed" | "game">,
): { readonly gameId: string | null } | null {
  if (!options.addressed) {
    if (options.game !== undefined) {
      throw new Error(
        "--game names the game id vbz build --addressed writes its paths under; add --addressed, or leave --game out",
      )
    }
    return null
  }
  if (options.game === undefined) return { gameId: null }
  if (!GAME_ID.test(options.game)) {
    throw new Error(
      `--game takes a game id, a UUID written lowercase such as 0b123291-582d-52f5-a2d5-877342fd8596, not ${JSON.stringify(options.game)}`,
    )
  }
  return { gameId: options.game }
}

/**
 * The build at its content addresses under `gameId`, or under the id made
 * from the manifest's own when it is null, and what a page needs to load it.
 */
export function addressBuild(
  built: BuiltGame,
  gameId: string | null,
): Addressed {
  const game = addressGame(built, gameId ?? gameIdOf(built.manifest))
  const keys = blobKeys(game)
  return {
    game,
    page: {
      name: nameOf(built),
      gameId: game.gameId,
      present: `/${keys.present}`,
      sim: `/${keys.sim}`,
      files: `/${keys.files}`,
      manifestHash: manifestHashOf(built),
      needs: built.needs,
    },
  }
}

/**
 * Replaces `dist/addressed/` with every file of the layout at the path a
 * host serves it from, and writes `dist/addressed.json` beside it.
 */
export async function writeAddressed(
  root: string,
  addressed: Addressed,
): Promise<void> {
  const dist = join(root, DIST_DIR)
  const folder = join(dist, DIST_ADDRESSED_DIR)
  await rm(folder, { recursive: true, force: true })
  for (const entry of layoutOf(addressed.game)) {
    const to = join(folder, ...entry.key.split("/"))
    await mkdir(dirname(to), { recursive: true })
    await writeFile(to, await entry.read())
  }
  await writeFile(
    join(dist, DIST_FILES.addressed),
    `${JSON.stringify(addressed.page, null, 2)}\n`,
  )
}

/** What `vbz build --addressed` prints after the build's own lines. */
export function addressedLines(addressed: Addressed): string[] {
  const { page } = addressed
  const needs = Object.entries(page.needs)
    .filter(([, needed]) => needed === true)
    .map(([need]) => need)
  return [
    `${DIST_DIR}/${DIST_ADDRESSED_DIR}/ for the root of an origin, under game id ${page.gameId}`,
    `page module ${page.present}`,
    `files folder ${page.files}`,
    `manifest hash ${page.manifestHash}`,
    `needs ${needs.length === 0 ? "nothing beyond its two modules" : needs.join(", ")}`,
    `${DIST_DIR}/${DIST_FILES.addressed} says the same, for a page`,
  ]
}

/** What `vbz build` prints. */
export function buildLines(built: BuiltGame): string[] {
  const { files } = built.files.listing
  const bytes = files.reduce((total, file) => total + file.bytes, 0)
  return [
    `version ${built.version}, release line ${built.line}`,
    `rules code ${built.sim.byteLength} bytes, page module ${built.present.byteLength} bytes`,
    `files ${files.length} in ${bytes} bytes, named ${listingSha256(built.files.listing)}`,
  ]
}
