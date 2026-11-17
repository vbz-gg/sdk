/**
 * Building a game into the two artifacts an upload carries, and reading its
 * version as a release.
 *
 * The artifact half runs under bun and reaches its bundler, so it is a
 * separate subpath from anything a page imports: a browser bundle must not
 * drag any of this in. The platform imports this subpath, so an upload is
 * checked with the code an author builds with.
 */

export {
  buildGameArtifacts,
  type GameArtifacts,
  type GameSource,
} from "./build.js"
export {
  assertPresentImportsOnlySim,
  assertRewritten,
  assertSimSelfContained,
  assertSize,
  countQuoted,
  decodeArtifact,
  MAX_PRESENT_BYTES,
  MAX_SIM_BYTES,
  rewriteSimImport,
  SIM_SPECIFIER,
} from "./contract.js"
export { sha256Hex } from "./digest.js"
export {
  BUILD_REFUSAL,
  BuildRefusal,
  type BuildRefusalCode,
} from "./errors.js"
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
export {
  ARTIFACT_KINDS,
  ARTIFACT_PATH,
  type ArtifactKind,
  artifactPathFor,
  GAME_ID,
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
