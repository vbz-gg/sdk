/**
 * A game, built and addressed the way a host serving it to a page on
 * another origin holds it: the one implementation of that layout, which the
 * harness serves and `vbz build --addressed` writes.
 *
 * Builds the two artifacts and lists the files folder, hashes each module,
 * rewrites the page module's `cw2:sim` import to the simulation's content
 * address and its `cw2:files/` imports to the folder's, both under the game's
 * path, and hashes the page module after that rewrite rather than before.
 * The order is the point: a stored page module's hash is taken over bytes
 * that already name one game, one simulation and one folder, so it can name
 * exactly those, forever.
 *
 * This is the same sequence vbz.gg performs on an upload, which is why the
 * harness serves what a host would serve rather than something that
 * resembles it.
 */

import {
  buildGameArtifacts,
  type GameArtifacts,
  type GameSource,
} from "./build.js"
import { decodeArtifact, rewritePresentImports } from "./contract.js"
import { sha256Hex } from "./digest.js"
import { refuse } from "./errors.js"
import { type FilesListing, type ListedFolder, listingSha256 } from "./files.js"
import { manifestField } from "./manifest.js"
import { filesBaseFor, GAME_ID, presentPathFor, simPathFor } from "./paths.js"

/** A game's two modules and its folder at their content addresses. */
export interface AddressedGame {
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
}

/** An addressed game, and how many times its page module starts a worker. */
export interface BuiltGame extends AddressedGame {
  /** How many times the page module starts a worker with `new Worker`. */
  readonly workers: number
}

/**
 * Two modules and a listed folder, already built, at their content
 * addresses under `gameId`. The page module is rewritten by
 * `rewritePresentImports`, which refuses a game id that is not one.
 */
export function addressGame(
  built: {
    readonly sim: Uint8Array
    readonly present: Uint8Array
    readonly files: ListedFolder
  },
  gameId: string,
): AddressedGame {
  const simSha256 = sha256Hex(built.sim)
  const rewritten = new TextEncoder().encode(
    rewritePresentImports(
      decodeArtifact(built.present, "page module"),
      gameId,
      simSha256,
      built.files.listing,
    ),
  )
  return {
    gameId,
    sim: built.sim,
    simSha256,
    present: rewritten,
    presentSha256: sha256Hex(rewritten),
    presentSourceSha256: sha256Hex(built.present),
    files: built.files.listing,
    filesSha256: listingSha256(built.files.listing),
    filesOnDisk: built.files.onDisk,
  }
}

/** A game's source, built and addressed under `gameId`. */
export async function buildAndAddress(
  source: GameSource,
  gameId: string,
): Promise<BuiltGame> {
  const built: GameArtifacts = await buildGameArtifacts(source)
  return { ...addressGame(built, gameId), workers: built.imports.workers }
}

/** Where each module and the files folder are served from, without the leading slash. */
export function blobKeys(built: AddressedGame): {
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

/** One file of the layout: its path without the leading slash, and its bytes. */
export interface LayoutEntry {
  readonly key: string
  /** The module's bytes, or the folder's file read from disk as listed. */
  read(): Promise<Uint8Array>
}

/**
 * Every file a host holds for the game, at the path it is served from: the
 * rules code, the page module as rewritten, and each file of the folder.
 * Nothing else: no listing and no manifest, which no page asks a host for.
 */
export function layoutOf(built: AddressedGame): readonly LayoutEntry[] {
  const keys = blobKeys(built)
  return [
    { key: keys.sim, read: async () => built.sim },
    { key: keys.present, read: async () => built.present },
    ...built.files.files.map((file) => ({
      key: `${keys.files}${file.path}`,
      read: async () =>
        await Bun.file(built.filesOnDisk.get(file.path) as string).bytes(),
    })),
  ]
}

/**
 * The namespace every game id made from a manifest's id is made in: a
 * version 5 UUID is the SHA-1 of a namespace and a name, so the same name
 * in another namespace is another id.
 */
export const GAME_ID_NAMESPACE = "2c3af53a-bda6-40bc-8dd2-08ea95d792cd"

/**
 * The version 5 UUID of `name` in `namespace`, RFC 9562's name-based UUID,
 * written lowercase: the same name always makes the same id, and anybody
 * with a UUID library can make it again.
 */
export function nameBasedUuid(namespace: string, name: string): string {
  if (!GAME_ID.test(namespace)) {
    throw new Error(`${JSON.stringify(namespace)} is not a lowercase UUID`)
  }
  const space = Uint8Array.from(
    namespace
      .replaceAll("-", "")
      .match(/../g)
      ?.map((pair) => Number.parseInt(pair, 16)) ?? [],
  )
  const digest = new Uint8Array(
    new Bun.CryptoHasher("sha1")
      .update(space)
      .update(new TextEncoder().encode(name))
      .digest(),
  ).slice(0, 16)
  digest[6] = ((digest[6] as number) & 0x0f) | 0x50
  digest[8] = ((digest[8] as number) & 0x3f) | 0x80
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0"))
  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10, 16),
  ]
    .map((part) => part.join(""))
    .join("-")
}

/**
 * The game id a layout's paths name when nobody names one: made from the
 * manifest's `id`, which a game keeps for every version, so every version
 * of a game is served under one path and a page's policy names it once.
 * A manifest naming no id is `E_MANIFEST_INVALID`.
 */
export function gameIdOf(manifest: unknown): string {
  const id = manifestField(manifest, "id")
  if (typeof id !== "string" || id === "") {
    refuse(
      "E_MANIFEST_INVALID",
      "the manifest names no id, which the game id its paths name is made from; give it one, or name a game id with --game",
    )
  }
  return nameBasedUuid(GAME_ID_NAMESPACE, id)
}
