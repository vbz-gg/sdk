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
import { DIST_DIR, DIST_FILES } from "../build/dist.js"

export async function readBuiltManifest(root: string): Promise<unknown> {
  try {
    return JSON.parse(
      await readFile(join(root, DIST_DIR, DIST_FILES.manifest), "utf8"),
    ) as unknown
  } catch {
    return {}
  }
}
