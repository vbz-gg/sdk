/**
 * `vbz build`: a game's source to what an upload carries: the rules code,
 * the page module, the manifest, and the files folder with its listing.
 *
 * The version is read as a release before anything is written, through the
 * same `parseReleaseVersion` the platform runs on an upload, so a version no
 * release line can hold is refused here rather than after an upload.
 *
 * The page module is written unrewritten, with its `cw2:sim` and
 * `cw2:files/` specifiers intact. The platform rewrites them to the rules
 * code's and the folder's content addresses on the way in, so a page module
 * that arrived already pointing somewhere would be one naming code nobody
 * checked.
 */

import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { DIST_DIR, DIST_FILES, DIST_FILES_DIR } from "../build/dist.js"
import { refuse } from "../build/errors.js"
import {
  assertPacksListed,
  buildGameArtifacts,
  canonicalListing,
  type GameSource,
  type ListedFolder,
  listingSha256,
} from "../build/index.js"
import { parseReleaseVersion, releaseLine } from "../build/version.js"
import { readManifestFromSim } from "./manifest.js"

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
 * rules code, and holds the manifest's data packs to the folder.
 */
export async function buildGame(source: GameSource): Promise<BuiltGame> {
  const { sim, present, files } = await buildGameArtifacts(source)
  const manifest = await readManifestFromSim(sim)
  const release = releaseOf(manifest)
  assertPacksListed(packsOf(manifest), files.listing)
  return { sim, present, manifest, ...release, files }
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
