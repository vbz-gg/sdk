/**
 * A game's page module: what `vbz build` bundles from a game's page entry,
 * with the game's own engine, and what a page loads and plays.
 *
 * A value subpath, bundled into every page module. It reads nothing from the
 * browser when it loads, contains no dynamic import, and imports nothing of
 * `/host`, `/platform` or the CLI: a page module may import exactly one
 * module by name, its rules code, and this has to fit inside that.
 */

export {
  type ContractOneMountOptions,
  type ContractOnePageModule,
  DRIVEN_CONTRACTS,
  MOUNT_ERROR,
  type MountError,
  type MountErrorCode,
  type MountedCheckpoint,
  type MountedEnd,
  type MountedFrame,
  type MountHandle,
  type MountHandlers,
  type MountMode,
  type MountOptions,
  PAGE_MODULE_CONTRACT,
  PAGE_MODULE_PROBLEM,
  type PageModule,
  type PageModuleProblem,
  type PageModuleProblemCode,
  type PlayMount,
  type PreparedGame,
  type PrepareOptions,
  type RunMount,
  type WatchMount,
} from "./contract.js"
export {
  definePageModule,
  mountErrorOf,
  type PageModuleParts,
} from "./define.js"
export {
  FILE_PATH_PATTERN,
  type GameFiles,
  gameFiles,
  isFilePath,
  MAX_FILE_PATH_LENGTH,
} from "./files.js"
