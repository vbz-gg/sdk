/**
 * A game, built and addressed the way the platform stores it.
 *
 * Builds the two artifacts, hashes each, rewrites the page module's `cw2:sim`
 * import to the simulation's content address under the game's path, and
 * hashes the page module after that rewrite rather than before. The order is
 * the point: a stored page module's hash is taken over bytes that already
 * name one game and one simulation, so it can name exactly one sim, forever.
 *
 * This is the same sequence the platform performs on an upload, which is why
 * the harness serves what production would serve rather than something that
 * resembles it.
 */

import {
  buildGameArtifacts,
  decodeArtifact,
  type GameSource,
  presentPathFor,
  rewriteSimImport,
  sha256Hex,
  simPathFor,
} from "../build/index.js"

export interface BuiltGame {
  /** The game id the paths are built under. */
  readonly gameId: string
  readonly sim: Uint8Array
  readonly simSha256: string
  /** The page module as stored: its sim import already points at `simSha256`. */
  readonly present: Uint8Array
  readonly presentSha256: string
  /** The page module as the build produced it, before the rewrite. */
  readonly presentSourceSha256: string
}

export async function buildAndAddress(
  source: GameSource,
  gameId: string,
): Promise<BuiltGame> {
  const { sim, present } = await buildGameArtifacts(source)

  const simSha256 = sha256Hex(sim)
  const presentSourceSha256 = sha256Hex(present)

  const rewritten = new TextEncoder().encode(
    rewriteSimImport(decodeArtifact(present, "page module"), gameId, simSha256),
  )

  return {
    gameId,
    sim,
    simSha256,
    present: rewritten,
    presentSha256: sha256Hex(rewritten),
    presentSourceSha256,
  }
}

/** Where each module is served from, without the leading slash. */
export function blobKeys(built: BuiltGame): {
  readonly sim: string
  readonly present: string
} {
  return {
    sim: simPathFor(built.gameId, built.simSha256).slice(1),
    present: presentPathFor(built.gameId, built.presentSha256).slice(1),
  }
}
