/**
 * Building a game into the two artifacts an upload carries and the files
 * folder beside them, every limit the platform holds them to, and reading
 * its version as a release.
 *
 * The artifact half runs under bun and reaches its bundler, so it is a
 * separate subpath from anything a page imports: a browser bundle must not
 * drag any of this in. The platform imports this subpath, so an upload is
 * checked with the code an author builds with.
 */

export {
  FILE_PATH_PATTERN,
  isFilePath,
  MAX_FILE_PATH_LENGTH,
} from "../game/files.js"
export {
  buildGameArtifacts,
  type GameArtifacts,
  type GameSource,
} from "./build.js"
export {
  assertPresentImports,
  assertRewritten,
  assertSimSelfContained,
  assertSize,
  countQuoted,
  decodeArtifact,
  FILES_SPECIFIER,
  type PresentImports,
  rewritePresentImports,
  SIM_SPECIFIER,
} from "./contract.js"
export { sha256Hex } from "./digest.js"
export {
  BUILD_REFUSAL,
  BuildRefusal,
  type BuildRefusalCode,
} from "./errors.js"
export {
  assertFileBytes,
  assertFilesHeld,
  assertListing,
  assertPacksListed,
  canonicalListing,
  EMPTY_LISTING,
  type FileEntry,
  type FilesListing,
  type ListedFolder,
  listedFile,
  listFolder,
  listingSha256,
  missingFiles,
} from "./files.js"
export {
  CHECKS_CONTAINER_WAIT_MS,
  MAX_CHUNK_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_FILES_BYTES,
  MAX_LISTING_BYTES,
  MAX_PACK_BYTES,
  MAX_PACKS_BYTES,
  MAX_PRESENT_BYTES,
  MAX_RUN_BYTES,
  MAX_SIM_BYTES,
  PATCH_SCORE_RUNS,
  REPLAY_ANSWER_MARGIN_MS,
  REPLAY_CPU_BUDGET_MS,
  REPLAY_MEMORY_MB,
  REPLAY_WALL_BUDGET_MS,
} from "./limits.js"
export {
  CAPABILITY_RULES,
  contractSha256,
  LINE_RULES,
  type LineContract,
  type LineRule,
  type LineRules,
  lineChanges,
  lineContract,
} from "./line.js"
export { type RuntimeLoad, runtimeLoads } from "./loads.js"
export {
  ARTIFACT_KINDS,
  ARTIFACT_PATH,
  type ArtifactKind,
  artifactPathFor,
  filePathFor,
  filesBaseFor,
  GAME_ID,
  isFilePathname,
  PRESENT_PATH,
  presentPathFor,
  SHA256,
  SIM_PATH,
  simPathFor,
} from "./paths.js"
export {
  MAX_VERSION_PART,
  parseReleaseVersion,
  type ReleaseVersion,
  releaseLine,
} from "./version.js"
