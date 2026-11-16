/**
 * Where a game's two modules are served, given the game and a digest.
 *
 * Every path names the game, so a studio's Content-Security-Policy can name
 * its own game's path and no other studio's file loads into its page. The
 * platform's public bucket, its development `bundles` role and the harness
 * all serve these same paths, so a page meets one layout everywhere.
 *
 * Plain patterns and string building, with nothing that needs bun, because
 * `/serve` reads them as well as `/build`.
 */

/** A game id as the platform issues it: a UUID, written lowercase. */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

/** A lowercase hex SHA-256. */
const DIGEST = "[0-9a-f]{64}"

export const GAME_ID = new RegExp(`^${UUID}$`)

export const SHA256 = new RegExp(`^${DIGEST}$`)

/** The two kinds of module a version stores, as each path names them. */
export const ARTIFACT_KINDS = ["sim", "present"] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

/**
 * What a rewritten sim import must look like: built from a game id and a
 * hash, never taken from a submission.
 *
 * Root-relative rather than absolute, so the page module's bytes carry no
 * domain. A root-relative specifier resolves against the importing module's
 * own URL, so the page module and its rules code are fetched from one origin
 * and moving that origin later is configuration with nothing to re-publish.
 */
export const SIM_PATH = new RegExp(`^/g/${UUID}/sim/${DIGEST}\\.js$`)

export const PRESENT_PATH = new RegExp(`^/g/${UUID}/present/${DIGEST}\\.js$`)

/** Either module's path, which is everything a bundle server answers. */
export const ARTIFACT_PATH = new RegExp(
  `^/g/${UUID}/(?:${ARTIFACT_KINDS.join("|")})/${DIGEST}\\.js$`,
)

/** Where a module of this kind, game and hash is served. */
export function artifactPathFor(
  kind: ArtifactKind,
  gameId: string,
  sha256: string,
): string {
  return `/g/${gameId}/${kind}/${sha256}.js`
}

/** Where a simulation of this game and hash is served. */
export function simPathFor(gameId: string, sha256: string): string {
  return artifactPathFor("sim", gameId, sha256)
}

/** Where a page module of this game and hash is served. */
export function presentPathFor(gameId: string, sha256: string): string {
  return artifactPathFor("present", gameId, sha256)
}
