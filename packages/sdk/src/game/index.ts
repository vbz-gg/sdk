/**
 * A game's page module: what `vbz build` bundles from a game's page entry,
 * with the game's own engine, and what a studio's page loads and plays.
 *
 * A value subpath, bundled into every page module. It reads nothing from the
 * browser when it loads, contains no dynamic import, and imports nothing of
 * `/host`, `/platform` or the CLI: a page module may import exactly one
 * module by name, its rules code, and this has to fit inside that.
 */

export {
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
} from "./contract.js"
export {
  definePageModule,
  mountErrorOf,
  type PageModuleParts,
} from "./define.js"
