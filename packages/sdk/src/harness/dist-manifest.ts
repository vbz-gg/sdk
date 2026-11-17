/**
 * The manifest, read from the game's built output rather than imported.
 *
 * Importing the rules code to reach its `MANIFEST` would run a stranger's
 * module in this process. `vbz build` writes the manifest beside the
 * artifacts for exactly this reason. A game with no build on disk reads as
 * an empty manifest, which no page module carries: the harness refuses to
 * start on it, and the stand-in for the platform serves nothing it could
 * play.
 */

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { assertPresentImports, type PresentImports } from "../build/contract.js"
import { DIST_DIR, DIST_FILES } from "../build/dist.js"
import { assertListing, type FilesListing } from "../build/files.js"

export async function readBuiltManifest(root: string): Promise<unknown> {
  try {
    return JSON.parse(
      await readFile(join(root, DIST_DIR, DIST_FILES.manifest), "utf8"),
    ) as unknown
  } catch {
    return {}
  }
}

/**
 * The page module and the folder's listing `vbz build` wrote, held to the
 * page module's contract once more, as a page playing locally serves them:
 * what the page module imports and how many workers it starts, and what
 * the folder lists. A page served the build needs what that build needs.
 */
export async function readBuiltPresent(root: string): Promise<{
  readonly imports: PresentImports
  readonly listing: FilesListing
}> {
  const dist = join(root, DIST_DIR)
  let present: string
  let listing: FilesListing
  try {
    present = await readFile(join(dist, DIST_FILES.present), "utf8")
    listing = assertListing(
      JSON.parse(await readFile(join(dist, DIST_FILES.listing), "utf8")),
    )
  } catch (error) {
    throw new Error(
      `a page playing locally plays the build vbz build wrote to ${DIST_DIR}/, and its ${DIST_FILES.present} and ${DIST_FILES.listing} could not be read: ${error instanceof Error ? error.message : String(error)}; run vbz build first`,
    )
  }
  return { imports: assertPresentImports(present, listing), listing }
}
