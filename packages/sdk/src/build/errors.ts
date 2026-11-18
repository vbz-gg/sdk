/**
 * Why a build or an upload was refused.
 *
 * One code per refusal, so a deploy script can switch on it and a host can map
 * it to a status from a table rather than a chain of instanceof checks. The
 * platform reports the same codes for an upload it refuses, because it runs
 * these same checks on the bytes it was given.
 */

export const BUILD_REFUSAL = {
  /** An artifact is not valid UTF-8, so its bytes and its module disagree. */
  ARTIFACT_NOT_UTF8: "E_ARTIFACT_NOT_UTF8",
  ARTIFACT_TOO_LARGE: "E_ARTIFACT_TOO_LARGE",
  /** The sim imports something. It runs with no network and would fault. */
  SIM_NOT_SELF_CONTAINED: "E_SIM_NOT_SELF_CONTAINED",
  /** The page module has no sim import, so it carries its own copy. */
  PRESENT_IMPORT_MISSING: "E_PRESENT_IMPORT_MISSING",
  /** The page module imports something besides the sim. */
  PRESENT_IMPORT_UNEXPECTED: "E_PRESENT_IMPORT_UNEXPECTED",
  /**
   * An `import()`, literal or computed, would choose its module at runtime,
   * past the scan.
   */
  PRESENT_DYNAMIC_IMPORT: "E_PRESENT_DYNAMIC_IMPORT",
  /**
   * The page module calls `new SharedWorker` or `importScripts`, each of
   * which loads code by an address decided when it runs. It may call `new
   * Worker`, which `vbz build` holds to the game's declared `workers` need
   * instead, and the page's policy to where a worker may come from.
   */
  PRESENT_WORKER: "E_PRESENT_WORKER",
  /** The specifier also appears as data, so rewriting it would change it. */
  PRESENT_SPECIFIER_AMBIGUOUS: "E_PRESENT_SPECIFIER_AMBIGUOUS",
  /** The rewrite did not produce what it promised. */
  REWRITE_FAILED: "E_REWRITE_FAILED",
  /** The manifest's version is not one a release line can hold. */
  VERSION_INVALID: "E_VERSION_INVALID",
  /**
   * The manifest is over `MAX_MANIFEST_BYTES` as JSON. The platform answers
   * the same code for a manifest the engine's `assertManifest` refuses, and
   * for one whose settings its `servedConfig` cannot serve.
   */
  MANIFEST_INVALID: "E_MANIFEST_INVALID",
  /**
   * A files listing that is not a list of paths, sizes and hashes, or a file
   * uploaded under a name that is not a SHA-256.
   */
  FILES_INVALID: "E_FILES_INVALID",
  /** A path a version's folder may not hold, or one listed twice. */
  FILE_PATH_INVALID: "E_FILE_PATH_INVALID",
  /** One file over `MAX_FILE_BYTES`. */
  FILE_TOO_LARGE: "E_FILE_TOO_LARGE",
  /** The folder's files together over `MAX_FILES_BYTES`. */
  FILES_TOO_LARGE: "E_FILES_TOO_LARGE",
  /** More files than `MAX_FILES`. */
  FILES_TOO_MANY: "E_FILES_TOO_MANY",
  /** The page module imports `cw2:files/<path>` for a file the folder does not hold. */
  FILE_UNLISTED: "E_FILE_UNLISTED",
  /** A version's listing names a file the game's store does not hold. */
  FILES_MISSING: "E_FILES_MISSING",
  /** A file uploaded under a SHA-256 its bytes do not hash to. */
  FILE_HASH_MISMATCH: "E_FILE_HASH_MISMATCH",
  /** The manifest declares a data pack the folder does not hold. */
  PACK_UNLISTED: "E_PACK_UNLISTED",
  /** A data pack's size or hash in the folder is not the manifest's. */
  PACK_MISMATCH: "E_PACK_MISMATCH",
  /** One pack over `MAX_PACK_BYTES`, or all of them over `MAX_PACKS_BYTES`. */
  PACKS_TOO_LARGE: "E_PACKS_TOO_LARGE",
} as const

export type BuildRefusalCode =
  (typeof BUILD_REFUSAL)[keyof typeof BUILD_REFUSAL]

export class BuildRefusal extends Error {
  readonly code: BuildRefusalCode

  constructor(code: BuildRefusalCode, detail: string) {
    super(detail)
    this.name = "BuildRefusal"
    this.code = code
  }
}

export function refuse(code: BuildRefusalCode, detail: string): never {
  throw new BuildRefusal(code, detail)
}
