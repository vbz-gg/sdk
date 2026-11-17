/**
 * Where `vbz build` puts what a game uploads, and what it calls each part.
 *
 * One home, because three places read them: the build writes them, the
 * harness reads the manifest beside the artifacts, and `vbz publish` uploads
 * them. A name that moved in one and not the others would build cleanly and
 * then upload a stale file, or report a build as missing right after it was
 * made.
 */

/** The directory, inside a game's root, that the build writes. */
export const DIST_DIR = "dist"

/** The files in it. */
export const DIST_FILES = {
  manifest: "manifest.json",
  sim: "sim.js",
  present: "present.js",
  /** The files folder's listing, as the text its name is the SHA-256 of. */
  listing: "files.json",
  /**
   * What a page needs to load the build from a plain static host, `dist/`
   * served as it is: `LocalBuild` in `/host`.
   */
  game: "game.json",
} as const

/** The copy of the game's files folder inside `dist/`, by its listed paths. */
export const DIST_FILES_DIR = "files"
