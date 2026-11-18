/**
 * Putting a game on a page, any page: loading its page module, and a local
 * run that asks nothing of anybody. For ranked play on vbz.gg, a platform run
 * through it, a settled run replayed, and the two widgets such a page needs.
 *
 * Plain modules with no DOM at load time, like `/platform`, so a page may
 * import this while rendering on a server. It holds no engine: a game's page
 * module carries its own, and this reaches it through the module's `mount`.
 */

export {
  alteredBuiltins,
  type GameAddress,
  type GameMountOptions,
  type LoadedGame,
  type LoadOptions,
  loadGame,
  type PagePrepareOptions,
  SIMULATION_BUILTINS,
} from "./load.js"
export {
  LOCAL_SEED_PREFIX,
  type LocalBuild,
  type LocalEnd,
  type LocalError,
  type LocalPlayOptions,
  type LocalRecording,
  type LocalRun,
  localAddress,
  localSeed,
  playLocal,
} from "./local.js"
export {
  type PlayedRun,
  type PlayOptions,
  playRun,
  type RunLocks,
  runLockName,
} from "./play.js"
export { type WatchedGame, type WatchOptions, watchRun } from "./watch.js"
export {
  type BoardWidgetOptions,
  type MountedBoard,
  type MountedSignIn,
  type MountedWidget,
  mountBoard,
  mountSignIn,
  type SignInOptions,
} from "./widgets.js"
