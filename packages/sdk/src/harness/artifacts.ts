/**
 * A game, built and addressed the way the platform stores it.
 *
 * Builds the two artifacts and lists the files folder, hashes each module,
 * rewrites the page module's `cw2:sim` import to the simulation's content
 * address and its `cw2:files/` imports to the folder's, both under the game's
 * path, and hashes the page module after that rewrite rather than before.
 * The order is the point: a stored page module's hash is taken over bytes
 * that already name one game, one simulation and one folder, so it can name
 * exactly those, forever.
 *
 * This is the same sequence the platform performs on an upload, which is why
 * the harness serves what production would serve rather than something that
 * resembles it.
 */

import {
  buildGameArtifacts,
  decodeArtifact,
  type FilesListing,
  filesBaseFor,
  type GameSource,
  listingSha256,
  presentPathFor,
  rewritePresentImports,
  sha256Hex,
  simPathFor,
} from "../build/index.js"

export interface BuiltGame {
  /** The game id the paths are built under. */
  readonly gameId: string
  readonly sim: Uint8Array
  readonly simSha256: string
  /** The page module as stored: its imports already point at `simSha256` and the folder. */
  readonly present: Uint8Array
  readonly presentSha256: string
  /** The page module as the build produced it, before the rewrite. */
  readonly presentSourceSha256: string
  /** The files folder's listing, and its name: the listing's SHA-256. */
  readonly files: FilesListing
  readonly filesSha256: string
  /** Where each listed file is on disk, by its path in the folder. */
  readonly filesOnDisk: ReadonlyMap<string, string>
  /** How many times the page module starts a worker with `new Worker`. */
  readonly workers: number
}

export async function buildAndAddress(
  source: GameSource,
  gameId: string,
): Promise<BuiltGame> {
  const { sim, present, imports, files } = await buildGameArtifacts(source)

  const simSha256 = sha256Hex(sim)
  const presentSourceSha256 = sha256Hex(present)

  const rewritten = new TextEncoder().encode(
    rewritePresentImports(
      decodeArtifact(present, "page module"),
      gameId,
      simSha256,
      files.listing,
    ),
  )

  return {
    gameId,
    sim,
    simSha256,
    present: rewritten,
    presentSha256: sha256Hex(rewritten),
    presentSourceSha256,
    files: files.listing,
    filesSha256: listingSha256(files.listing),
    filesOnDisk: files.onDisk,
    workers: imports.workers,
  }
}

/** Where each module and the files folder are served from, without the leading slash. */
export function blobKeys(built: BuiltGame): {
  readonly sim: string
  readonly present: string
  /** The folder's base, ending in `/`: a file's key is this and its path. */
  readonly files: string
} {
  return {
    sim: simPathFor(built.gameId, built.simSha256).slice(1),
    present: presentPathFor(built.gameId, built.presentSha256).slice(1),
    files: filesBaseFor(built.gameId, built.filesSha256).slice(1),
  }
}
