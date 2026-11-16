/**
 * `vbz build`: a game's source to the three files an upload carries.
 *
 * The version is read as a release before anything is written, through the
 * same `parseReleaseVersion` the platform runs on an upload, so a version no
 * release line can hold is refused here rather than after an upload.
 *
 * The page module is written unrewritten, with its `cw2:sim` specifier
 * intact. The platform rewrites it to the rules code's content address on the
 * way in, so a page module that arrived already pointing somewhere would be
 * one naming a module nobody checked.
 */

import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { DIST_DIR, DIST_FILES } from "../build/dist.js"
import { refuse } from "../build/errors.js"
import { buildGameArtifacts, type GameSource } from "../build/index.js"
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

/** Builds both modules and reads the manifest out of the rules code. */
export async function buildGame(source: GameSource): Promise<BuiltGame> {
  const { sim, present } = await buildGameArtifacts(source)
  const manifest = await readManifestFromSim(sim)
  return { sim, present, manifest, ...releaseOf(manifest) }
}

/** Replaces `dist/` with the three files. */
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
}

/** What `vbz build` prints. */
export function buildLines(built: BuiltGame): string[] {
  return [
    `version ${built.version}, release line ${built.line}`,
    `rules code ${built.sim.byteLength} bytes, page module ${built.present.byteLength} bytes`,
  ]
}
